import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  assertRuntimeSecrets,
  clearSessionCookie,
  createSessionToken,
  csrfTokenForSession,
  exchangeGoogleCode,
  googleAuthUrl,
  googleOAuthAvailable,
  readSessionToken,
  sessionCookie,
  verifyCsrfToken,
  verifySessionToken
} from "./auth.js";
import {
  DEFAULT_USER_ID,
  authenticatePasswordUser,
  autosaveMemo,
  compactWorkspace,
  commitMemo,
  createMemo,
  createPasswordUser,
  deleteFolder,
  deleteMemo,
  deleteMemoHistory,
  discardAutosave,
  ensureWorkspace,
  exportArchive,
  findOrCreateGoogleUser,
  getEmailAvailability,
  getAttachmentPath,
  getWorkspaceStorage,
  getUserById,
  httpError,
  importTextFiles,
  isAutosaveEnabled,
  linkGoogleUser,
  createFolder,
  listFolders,
  listMemos,
  listTags,
  memoHistory,
  moveFolder,
  purgeExpiredDeletedUsers,
  purgeExpiredTrashedMemos,
  readMemo,
  rebuildIndex,
  readMemoHistoryVersion,
  requestAccountDeletion,
  revokeUserSessions,
  reorderFolders,
  reorderMemos,
  restoreMemo,
  restoreTrashedMemo,
  setAccountPassword,
  syncGithub,
  updateFolderIcon,
  updateMemoPin,
  updateUserSettings,
  uploadAttachment
} from "./storage.js";

const PORT = Number(process.env.PORT || 3030);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(process.cwd(), "public");
const TEXT_IMPORT_READ_LIMIT_BYTES = 24 * 1024 * 1024;
const WORKSPACE_COMPACT_DELAY_MS = Number(process.env.CHRONONOTE_COMPACT_DELAY_MS || 30_000);
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATES = new Map();
const COMPACTION_TIMERS = new Map();
const RATE_LIMITS = new Map();
const USER_JOBS = new Set();

assertRuntimeSecrets({ host: HOST, nodeEnv: process.env.NODE_ENV || "" });
ensureWorkspace({ userId: process.env.CHRONONOTE_USER_ID || DEFAULT_USER_ID });
purgeExpiredDeletedUsers();
purgeExpiredTrashedMemos({ userId: process.env.CHRONONOTE_USER_ID || DEFAULT_USER_ID });

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const method = request.method || "GET";

    if (url.pathname.startsWith("/api/")) {
      await routeApi(request, response, url);
      return;
    }

    if (!["GET", "HEAD"].includes(method)) {
      const error = httpError(405, "지원하지 않는 HTTP 메서드입니다.");
      error.headers = { Allow: "GET, HEAD" };
      throw error;
    }

    if (url.pathname.startsWith("/attachments/")) {
      serveAttachment(request, response, decodeURIComponent(url.pathname.slice("/attachments/".length)));
      return;
    }

    serveStatic(request, response, url.pathname);
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ChronoNote is running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  if (HOST === "0.0.0.0") {
    for (const url of lanUrls(PORT)) console.log(`LAN access: ${url}`);
  }
});

function lanUrls(port) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => `http://${entry.address}:${port}`);
}

function requiresCsrf(method, pathname) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  return ![
    "/api/auth/login",
    "/api/auth/register"
  ].includes(pathname);
}

function enforceCsrf(request) {
  const token = readSessionToken(request);
  if (!verifySessionToken(token)) throw httpError(401, "로그인이 필요합니다.");
  if (!verifyCsrfToken(token, request.headers["x-csrf-token"] || "")) {
    throw httpError(403, "요청 보안 토큰이 유효하지 않습니다. 새로고침 후 다시 시도해주세요.");
  }
}

function rateLimit(request, bucket, { limit, windowMs, key } = {}) {
  const now = Date.now();
  const cleanKey = `${bucket}:${key || clientIp(request)}`;
  const current = RATE_LIMITS.get(cleanKey) || { count: 0, resetAt: now + windowMs };
  if (current.resetAt <= now) {
    current.count = 0;
    current.resetAt = now + windowMs;
  }
  current.count += 1;
  RATE_LIMITS.set(cleanKey, current);

  if (current.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    const error = httpError(429, `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해주세요.`);
    error.headers = { "Retry-After": String(retryAfter) };
    throw error;
  }

  if (RATE_LIMITS.size > 1000) {
    for (const [entryKey, value] of RATE_LIMITS) {
      if (value.resetAt <= now) RATE_LIMITS.delete(entryKey);
    }
  }
}

function clientIp(request) {
  if (process.env.CHRONONOTE_TRUST_PROXY === "true") {
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return request.socket?.remoteAddress || "unknown";
}

async function withUserJob(userId, name, task) {
  const key = `${userId}:${name}`;
  if (USER_JOBS.has(key)) throw httpError(409, "이미 같은 작업이 실행 중입니다.");
  USER_JOBS.add(key);
  try {
    return await task();
  } finally {
    USER_JOBS.delete(key);
  }
}

function cleanupOAuthStates() {
  const now = Date.now();
  for (const [state, value] of OAUTH_STATES) {
    if (!value?.createdAt || value.createdAt + OAUTH_STATE_TTL_MS < now) {
      OAUTH_STATES.delete(state);
    }
  }
}

function scheduleWorkspaceCompaction(userId) {
  if (process.env.CHRONONOTE_AUTO_COMPACT === "0") return;
  clearTimeout(COMPACTION_TIMERS.get(userId));
  const timer = setTimeout(async () => {
    COMPACTION_TIMERS.delete(userId);
    try {
      const result = await compactWorkspace({ userId });
      if (result.saved_bytes > 0) {
        console.log(`Compacted workspace ${userId}: saved ${result.saved_bytes} bytes`);
      }
    } catch (error) {
      console.warn(`Workspace compaction failed for ${userId}: ${error.message}`);
    }
  }, WORKSPACE_COMPACT_DELAY_MS);
  timer.unref?.();
  COMPACTION_TIMERS.set(userId, timer);
}

async function routeApi(request, response, url) {
  const method = request.method || "GET";
  purgeExpiredDeletedUsers();
  cleanupOAuthStates();
  if (requiresCsrf(method, url.pathname)) enforceCsrf(request);

  if (method === "GET" && url.pathname === "/api/session") {
    const sessionToken = readSessionToken(request);
    const user = currentUserFromSessionToken(sessionToken);
    if (!user || user.deletion_requested_at) {
      if (user?.deletion_requested_at) response.setHeader("Set-Cookie", clearSessionCookie());
      sendJson(response, 200, {
        user: null,
        capabilities: capabilitiesPayload(),
        authenticated: false,
        csrf_token: null
      });
      return;
    }

    sendJson(response, 200, {
      user,
      capabilities: capabilitiesPayload(),
      authenticated: true,
      csrf_token: csrfTokenForSession(sessionToken)
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/auth/google/start") {
    rateLimit(request, "oauth-start", { limit: 20, windowMs: 10 * 60 * 1000 });
    const state = randomBytes(16).toString("hex");
    const location = googleAuthUrl(state);
    if (!location) throw httpError(501, "Google OAuth 환경변수가 설정되지 않았습니다.");
    const currentUser = currentUserFromSession(request);
    const requestedMode = url.searchParams.get("mode");
    const mode = requestedMode === "link" && currentUser
      ? "link"
      : (requestedMode === "register" ? "register" : "login");
    const consent = mode === "register"
      ? registrationConsentFromInput({
        termsAccepted: url.searchParams.get("terms_accepted") === "1",
        privacyAccepted: url.searchParams.get("privacy_accepted") === "1",
        ageConfirmed: url.searchParams.get("age_confirmed") === "1"
      })
      : null;
    OAUTH_STATES.set(state, {
      mode,
      userId: mode === "link" ? currentUser.id : null,
      consent,
      createdAt: Date.now()
    });
    writeHead(response, 302, { Location: location });
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/api/auth/google/callback") {
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const oauthState = OAUTH_STATES.get(state);
    if (!oauthState) throw httpError(400, "Invalid OAuth state.");
    OAUTH_STATES.delete(state);
    let user;
    try {
      const profile = await exchangeGoogleCode(code);
      user = oauthState.mode === "link"
        ? linkGoogleUser({ userId: oauthState.userId, ...profile })
        : findOrCreateGoogleUser({
          ...profile,
          allowCreate: oauthState.mode === "register",
          consent: oauthState.consent
        });
    } catch (error) {
      if (Number(error.status || 500) >= 500) throw error;
      const returnPath = oauthState.mode === "link" ? "/settings" : "/login";
      const message = String(error.message || "Google 로그인을 완료하지 못했습니다.").slice(0, 240);
      writeHead(response, 302, { Location: `${returnPath}?auth_error=${encodeURIComponent(message)}` });
      response.end();
      return;
    }
    response.setHeader("Set-Cookie", sessionCookie(createSessionToken(user.id, user.session_version)));
    writeHead(response, 302, { Location: "/" });
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/api/auth/email") {
    rateLimit(request, "auth-email", { limit: 40, windowMs: 10 * 60 * 1000 });
    sendJson(response, 200, getEmailAvailability(url.searchParams.get("email") || ""));
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/register") {
    rateLimit(request, "auth-register-ip", { limit: 5, windowMs: 60 * 60 * 1000 });
    const body = await readJson(request);
    rateLimit(request, "auth-register-email", {
      limit: 3,
      windowMs: 60 * 60 * 1000,
      key: String(body.email || "").trim().toLowerCase()
    });
    if (body.password !== body.password_confirm) {
      throw httpError(400, "비밀번호 확인이 일치하지 않습니다.");
    }
    const consent = registrationConsentFromInput({
      termsAccepted: body.terms_accepted === true,
      privacyAccepted: body.privacy_accepted === true,
      ageConfirmed: body.age_confirmed === true
    });
    const user = createPasswordUser({
      email: body.email,
      password: body.password,
      consent
    });
    const sessionToken = createSessionToken(user.id, user.session_version);
    response.setHeader("Set-Cookie", sessionCookie(sessionToken));
    sendJson(response, 201, { user, csrf_token: csrfTokenForSession(sessionToken) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/login") {
    rateLimit(request, "auth-login-ip", { limit: 60, windowMs: 10 * 60 * 1000 });
    const body = await readJson(request);
    rateLimit(request, "auth-login", {
      limit: 12,
      windowMs: 10 * 60 * 1000,
      key: `${clientIp(request)}:${String(body.email || "").toLowerCase()}`
    });
    const user = authenticatePasswordUser({
      email: body.email,
      password: body.password
    });
    const sessionToken = createSessionToken(user.id, user.session_version);
    response.setHeader("Set-Cookie", sessionCookie(sessionToken));
    sendJson(response, 200, { user, csrf_token: csrfTokenForSession(sessionToken) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/logout") {
    const currentUser = currentUserFromSession(request);
    if (currentUser) revokeUserSessions(currentUser.id);
    response.setHeader("Set-Cookie", clearSessionCookie());
    sendJson(response, 200, { ok: true });
    return;
  }

  const user = resolveUser(request);
  const userId = user.id;
  purgeExpiredTrashedMemos({ userId });

  if (method === "POST" && url.pathname === "/api/account/delete") {
    const body = await readJson(request);
    const result = requestAccountDeletion({
      userId,
      email: body.email,
      password: body.password
    });
    response.setHeader("Set-Cookie", clearSessionCookie());
    sendJson(response, 200, result);
    return;
  }

  if (method === "POST" && url.pathname === "/api/account/password") {
    const body = await readJson(request);
    if (body.password !== body.password_confirm) {
      throw httpError(400, "비밀번호 확인이 일치하지 않습니다.");
    }
    sendJson(response, 200, {
      user: setAccountPassword({
        userId,
        password: body.password
      })
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/settings") {
    sendJson(response, 200, { user, storage: getWorkspaceStorage({ userId, refresh: true }) });
    return;
  }

  if (method === "PATCH" && url.pathname === "/api/settings") {
    const body = await readJson(request);
    sendJson(response, 200, {
      user: updateUserSettings({ userId, ...body }),
      storage: getWorkspaceStorage({ userId, refresh: true })
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/sync/github") {
    rateLimit(request, "sync-github", { limit: 4, windowMs: 10 * 60 * 1000, key: userId });
    sendJson(response, 200, await withUserJob(userId, "sync", () => syncGithub({ userId })));
    return;
  }

  if (method === "POST" && url.pathname === "/api/index/rebuild") {
    rateLimit(request, "index-rebuild", { limit: 6, windowMs: 10 * 60 * 1000, key: userId });
    await withUserJob(userId, "rebuild", () => rebuildIndex(userId));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/workspace/compact") {
    rateLimit(request, "workspace-compact", { limit: 4, windowMs: 10 * 60 * 1000, key: userId });
    sendJson(response, 200, await withUserJob(userId, "compact", () => compactWorkspace({ userId })));
    return;
  }

  if (method === "GET" && url.pathname === "/api/folders") {
    sendJson(response, 200, {
      folders: listFolders({ userId })
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/folders") {
    const body = await readJson(request);
    sendJson(response, 201, createFolder({
      userId,
      name: body.name,
      icon: body.icon
    }));
    return;
  }

  if (method === "PATCH" && url.pathname === "/api/folders/order") {
    const body = await readJson(request);
    if (Array.isArray(body.names)) {
      sendJson(response, 200, reorderFolders({
        userId,
        names: body.names
      }));
      return;
    }
    sendJson(response, 200, moveFolder({
      userId,
      name: body.name || "",
      direction: body.direction
    }));
    return;
  }

  if (method === "PATCH" && url.pathname === "/api/folders/icon") {
    const body = await readJson(request);
    sendJson(response, 200, updateFolderIcon({
      userId,
      name: body.name || "",
      icon: body.icon
    }));
    return;
  }

  if (method === "DELETE" && url.pathname === "/api/folders") {
    const body = await readJson(request);
    const result = deleteFolder({
      userId,
      name: body.name || ""
    });
    scheduleWorkspaceCompaction(userId);
    sendJson(response, 200, result);
    return;
  }

  if (method === "PATCH" && url.pathname === "/api/memos/order") {
    const body = await readJson(request);
    const result = reorderMemos({
      userId,
      groups: body.groups
    });
    scheduleWorkspaceCompaction(userId);
    sendJson(response, 200, result);
    return;
  }

  if (method === "GET" && url.pathname === "/api/tags") {
    sendJson(response, 200, {
      tags: listTags({ userId })
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/memos") {
    sendJson(response, 200, {
      memos: listMemos({
        userId,
        search: url.searchParams.get("search") || "",
        tag: url.searchParams.get("tag") || ""
      })
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/memos") {
    const body = await readJson(request);
    const memo = createMemo({
      userId,
      title: body.title,
      tags: body.tags,
      content: body.content,
      folder: body.folder
    });
    scheduleWorkspaceCompaction(userId);
    sendJson(response, 201, {
      memo
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/import/text") {
    rateLimit(request, "import-text", { limit: 20, windowMs: 10 * 60 * 1000, key: userId });
    const body = await readJson(request, TEXT_IMPORT_READ_LIMIT_BYTES);
    const result = importTextFiles({
      userId,
      files: body.files,
      folder: body.folder || ""
    });
    scheduleWorkspaceCompaction(userId);
    sendJson(response, 201, result);
    return;
  }

  if (method === "POST" && url.pathname === "/api/attachments") {
    rateLimit(request, "attachments", { limit: 30, windowMs: 10 * 60 * 1000, key: userId });
    const body = await readJson(request, 25 * 1024 * 1024);
    sendJson(response, 201, await uploadAttachment({
      userId,
      filename: body.filename,
      data: body.data
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/api/export/archive") {
    rateLimit(request, "export-archive", { limit: 4, windowMs: 10 * 60 * 1000, key: userId });
    const archivePath = await withUserJob(userId, "export", () => exportArchive({
      userId,
      includeHistory: url.searchParams.get("include_history") === "1"
    }));
    writeHead(response, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="chrononote-${userId}.zip"`
    });
    fs.createReadStream(archivePath)
      .on("close", () => fs.rmSync(archivePath, { force: true }))
      .pipe(response);
    return;
  }

  const memoMatch = /^\/api\/memos\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(url.pathname);
  if (memoMatch) {
    const id = decodeURIComponent(memoMatch[1]);
    const action = memoMatch[2] || "";
    const param = memoMatch[3] || "";

    if (method === "GET" && !action) {
      sendJson(response, 200, { memo: readMemo({ userId, id }) });
      return;
    }

    if (method === "DELETE" && !action) {
      const result = deleteMemo({ userId, id });
      scheduleWorkspaceCompaction(userId);
      sendJson(response, 200, result);
      return;
    }

    if (method === "PATCH" && action === "pin") {
      const body = await readJson(request);
      const memo = updateMemoPin({ userId, id, pinned: body.pinned });
      scheduleWorkspaceCompaction(userId);
      sendJson(response, 200, {
        memo
      });
      return;
    }

    if (method === "PUT" && action === "autosave") {
      const body = await readJson(request);
      if (!isAutosaveEnabled(userId)) {
        sendJson(response, 200, {
          skipped: true,
          memo: readMemo({ userId, id })
        });
        return;
      }
      sendJson(response, 200, {
        memo: autosaveMemo({ userId, id, ...body })
      });
      return;
    }

    if (method === "DELETE" && action === "autosave") {
      sendJson(response, 200, {
        memo: discardAutosave({ userId, id })
      });
      return;
    }

    if (method === "POST" && action === "commit") {
      const body = await readJson(request);
      const result = commitMemo({ userId, id, ...body });
      scheduleWorkspaceCompaction(userId);
      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && action === "trash-restore") {
      const result = restoreTrashedMemo({ userId, id });
      scheduleWorkspaceCompaction(userId);
      sendJson(response, 200, result);
      return;
    }

    if (method === "GET" && action === "history" && param) {
      sendJson(response, 200, readMemoHistoryVersion({ userId, id, commit: param }));
      return;
    }

    if (method === "GET" && action === "history") {
      sendJson(response, 200, {
        history: memoHistory({ userId, id })
      });
      return;
    }

    if (method === "POST" && action === "restore") {
      const body = await readJson(request);
      const result = restoreMemo({ userId, id, commit: body.commit });
      scheduleWorkspaceCompaction(userId);
      sendJson(response, 200, result);
      return;
    }

    if (method === "DELETE" && action === "history" && param) {
      const result = deleteMemoHistory({ userId, id, commit: param });
      scheduleWorkspaceCompaction(userId);
      sendJson(response, 200, result);
      return;
    }
  }

  throw httpError(404, "Route not found.");
}

function registrationConsentFromInput({ termsAccepted, privacyAccepted, ageConfirmed }) {
  if (!termsAccepted || !privacyAccepted || !ageConfirmed) {
    throw httpError(400, "회원가입에는 이용약관·개인정보 수집 및 이용 동의와 만 14세 이상 확인이 필요합니다.");
  }
  return {
    termsAccepted: true,
    privacyAccepted: true,
    ageConfirmed: true,
    acceptedAt: new Date().toISOString()
  };
}

function capabilitiesPayload() {
  return {
    google_oauth: googleOAuthAvailable(),
    github_sync: true,
    zip_export: true
  };
}

function currentUserFromSession(request) {
  return currentUserFromSessionToken(readSessionToken(request));
}

function currentUserFromSessionToken(token) {
  const payload = verifySessionToken(token);
  if (payload?.sub) {
    const user = getUserById(payload.sub);
    if (user && Number(payload.ver || 0) === Number(user.session_version || 0)) {
      return user;
    }
  }
  return null;
}

function resolveUser(request) {
  const user = currentUserFromSession(request);
  if (!user || user.deletion_requested_at) {
    throw httpError(401, "로그인이 필요합니다.");
  }
  return user;
}

function serveStatic(request, response, pathname) {
  const cleanPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidate = path.resolve(PUBLIC_DIR, cleanPath);

  if (!isInsideDirectory(PUBLIC_DIR, candidate)) {
    throw httpError(403, "Forbidden.");
  }

  const directoryIndex = path.join(candidate, "index.html");
  const filePath = fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() && fs.existsSync(directoryIndex)
      ? directoryIndex
      : path.join(PUBLIC_DIR, "index.html"));

  const basename = path.basename(filePath);
  const headers = {
    "Content-Type": contentType(filePath),
    "Content-Length": String(fs.statSync(filePath).size)
  };
  if (basename === "sw.js") {
    headers["Cache-Control"] = "no-cache";
    headers["Service-Worker-Allowed"] = "/";
  } else if (basename === "manifest.webmanifest") {
    headers["Cache-Control"] = "no-cache";
  }

  writeHead(response, 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  fs.createReadStream(filePath).pipe(response);
}

function serveAttachment(request, response, filename) {
  const user = resolveUser(request);
  const filePath = getAttachmentPath({ userId: user.id, filename });
  writeHead(response, 200, {
    ...attachmentHeaders(filePath, filename),
    "Content-Length": String(fs.statSync(filePath).size)
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  fs.createReadStream(filePath).pipe(response);
}

async function readJson(request, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw httpError(413, "Request body is too large.");
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "JSON 요청 형식이 올바르지 않습니다.");
  }
}

function sendJson(response, status, payload) {
  writeHead(response, status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, error) {
  const status = Number(error.status || (error instanceof URIError ? 400 : 500));
  if (status >= 500) {
    console.error(error);
  }
  const payload = {
    error: status >= 500 ? "Unexpected server error." : (error.message || "요청을 처리할 수 없습니다.")
  };
  writeHead(response, status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(error.headers || {})
  });
  response.end(JSON.stringify(payload));
}

function writeHead(response, status, headers = {}) {
  response.writeHead(status, {
    ...securityHeaders(headers["Content-Type"] || ""),
    ...headers
  });
}

function securityHeaders(contentType = "") {
  const isSvg = String(contentType).startsWith("image/svg+xml");
  const csp = isSvg
    ? "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Frame-Options": "DENY"
  };
}

function attachmentHeaders(filePath, filename) {
  return {
    "Content-Type": contentType(filePath),
    "Content-Disposition": `inline; filename="${String(filename || "attachment").replace(/["\\]/g, "")}"`,
    "Cache-Control": "private, max-age=31536000, immutable"
  };
}

function isInsideDirectory(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf"
  };

  return types[ext] || "application/octet-stream";
}
