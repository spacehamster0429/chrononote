import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";
import sanitizeHtml from "sanitize-html";
import sharp from "sharp";
import { buildMarkdown, normalizeTags, parseMarkdown } from "./frontmatter.js";

process.umask(0o077);

const execFileAsync = promisify(execFile);

export const DATA_ROOT = path.resolve(process.env.CHRONONOTE_DATA_DIR || path.join(process.cwd(), "server-data"));
export const DEFAULT_USER_ID = process.env.CHRONONOTE_USER_ID || "00000000-0000-4000-8000-000000000001";

const MEMO_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ACCOUNT_RECOVERY_MS = 48 * 60 * 60 * 1000;
export const TRASH_FOLDER_NAME = "휴지통";
const TRASH_FOLDER_ICON = "🗑";
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const TEXT_IMPORT_TOTAL_LIMIT_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_DIMENSION = 3200;
const FFMPEG_TIMEOUT_MS = 45_000;
export const MAX_USER_COUNT = positiveIntegerEnv("CHRONONOTE_MAX_USERS", 64);
export const WORKSPACE_QUOTA_BYTES = positiveIntegerEnv("CHRONONOTE_WORKSPACE_QUOTA_BYTES", 256 * 1024 * 1024);
export const MAX_MEMO_COUNT = positiveIntegerEnv("CHRONONOTE_MAX_MEMOS_PER_USER", 5000);
export const TERMS_VERSION = "2026-07-06";
export const PRIVACY_VERSION = "2026-07-06";
const WORKSPACE_USAGE_CACHE_TTL_MS = 30_000;
const WORKSPACE_USAGE_CACHE = new Map();
const WEAK_SECRET_VALUES = new Set([
  "",
  "chrononote-local-dev-secret",
  "change-me",
  "replace-with-a-long-random-secret"
]);

export function ensureWorkspace({ userId = DEFAULT_USER_ID, seed = true } = {}) {
  const root = DATA_ROOT;
  const globalDbDir = path.join(root, "global_db");
  const usersDir = path.join(root, "users");
  const userDir = path.join(usersDir, userId);

  for (const dir of [root, globalDbDir, usersDir, userDir]) ensurePrivateDirectory(dir);
  for (const dir of ["memos", "trash", ".autosaves", ".attachments"]) {
    ensurePrivateDirectory(path.join(userDir, dir));
  }

  initAuthDb(path.join(globalDbDir, "auth.sqlite"), userId);
  initUserDb(userDir);
  initGit(userDir);
  ensureGitignore(userDir);
  restrictExistingPermissionsOnce(globalDbDir);
  restrictExistingPermissionsOnce(userDir);

  if (seed) {
    const hasMemos = ["memos", "trash"].some((dirName) => {
      const dirPath = path.join(userDir, dirName);
      return fs.existsSync(dirPath) && fs.readdirSync(dirPath).some((name) => name.endsWith(".md"));
    });
    if (!hasMemos) {
      createMemo({
        userId,
        title: "ChronoNote 시작 가이드",
        tags: ["welcome", "guide", "local-first"],
        content: [
          "# ChronoNote 시작 가이드",
          "",
          "마크다운 파일이 원본이고, SQLite는 검색 인덱스입니다.",
          "",
          "처음이라면 작성창 위의 튜토리얼 시작하기 링크를 눌러 기능을 빠르게 둘러보세요.",
          "",
          "- 3초간 입력이 멈추면 자동 저장됩니다.",
          "- 저장 버튼 또는 Ctrl+S로 Git 커밋이 생성됩니다.",
          "- 오른쪽 히스토리에서 파일 단위 기록을 복원할 수 있습니다.",
          "- 폴더는 왼쪽 패널에서 만들고, 이모지 아이콘을 지정할 수 있습니다.",
          "- 폴더와 메모는 손잡이를 꾹 눌러 직접 끌어서 정렬할 수 있습니다.",
          "- 왼쪽 패널의 가져오기 버튼으로 여러 텍스트 파일을 한 번에 메모로 가져올 수 있습니다.",
          "- 이미지와 텍스트 파일은 에디터에 드래그 앤 드롭해도 삽입하거나 가져올 수 있습니다.",
          "- JPEG, PNG, WebP는 WebP로 최적화되고 GIF/APNG는 MP4 영상으로 변환됩니다.",
          "- HTML/CSS와 LaTeX 수식도 안전하게 미리보기에서 볼 수 있습니다. 예: $E = mc^2$",
          "- 태그 칩을 누르면 해당 태그가 달린 메모만 빠르게 볼 수 있습니다.",
          "- 계정 패널에서 GitHub 백업과 ZIP 내보내기를 사용할 수 있습니다.",
          "- 튜토리얼은 나중에 설정에서도 다시 열 수 있습니다.",
          "",
          "<section class=\"chrono-html-demo\" style=\"border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: var(--surface);\">",
          "  <strong>HTML/CSS 프리뷰</strong>",
          "  <p><code>style</code> 속성과 안전한 HTML 태그만으로도 라이트/다크 테마에 맞춰 보입니다.</p>",
          "  <span class=\"metric\" style=\"display: inline-grid; margin-top: 10px; padding: 7px 10px; border-radius: 999px; background: var(--teal); color: #fff; font-weight: 700;\">JS 없이 표현만 허용</span>",
          "</section>"
        ].join("\n")
      });
    } else {
      rebuildIndex(userId);
    }
  }

  return getWorkspace(userId);
}

export function getWorkspace(userId = DEFAULT_USER_ID) {
  assertSafeUserId(userId);
  const userDir = path.join(DATA_ROOT, "users", userId);
  return {
    userId,
    root: DATA_ROOT,
    userDir,
    authDb: path.join(DATA_ROOT, "global_db", "auth.sqlite"),
    userDb: path.join(userDir, "personal_index.sqlite"),
    memosDir: path.join(userDir, "memos"),
    trashDir: path.join(userDir, "trash"),
    autosavesDir: path.join(userDir, ".autosaves"),
    attachmentsDir: path.join(userDir, ".attachments")
  };
}

export function getWorkspaceStorage({ userId = DEFAULT_USER_ID, refresh = false } = {}) {
  const workspace = getWorkspace(userId);
  const usedBytes = workspaceUsageBytes(workspace, { refresh });
  return {
    used_bytes: usedBytes,
    quota_bytes: WORKSPACE_QUOTA_BYTES,
    remaining_bytes: Math.max(0, WORKSPACE_QUOTA_BYTES - usedBytes)
  };
}

export function getOrCreateLocalUser() {
  ensureWorkspace({ userId: DEFAULT_USER_ID, seed: true });
  return getUserById(DEFAULT_USER_ID);
}

export function getUserById(userId = DEFAULT_USER_ID) {
  assertSafeUserId(userId);
  purgeExpiredDeletedUsers();
  const workspace = getWorkspace(userId);
  const rows = querySql(workspace.authDb, `
    SELECT id, email, google_id, password_hash, is_autosave_enabled, github_sync_token, github_sync_repo, theme_preference,
           deletion_requested_at, session_version, terms_version, privacy_version, age_confirmed_at
    FROM users
    WHERE id = ${sqlString(userId)}
    LIMIT 1;
  `);

  if (!rows[0]) return null;
  return serializeUser(rows[0]);
}

export function findOrCreateGoogleUser({ email, googleId, allowCreate = false, consent } = {}) {
  purgeExpiredDeletedUsers();
  const authDb = path.join(DATA_ROOT, "global_db", "auth.sqlite");
  fs.mkdirSync(path.dirname(authDb), { recursive: true });
  initAuthDb(authDb, DEFAULT_USER_ID);

  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanGoogleId = String(googleId || "").trim();
  if (!cleanEmail || !cleanGoogleId) {
    throw httpError(400, "Google profile did not include an email or id.");
  }

  const googleUser = querySql(authDb, `
    SELECT id, deletion_requested_at
    FROM users
    WHERE google_id = ${sqlString(cleanGoogleId)}
    LIMIT 1;
  `)[0];
  if (googleUser) {
    if (googleUser.deletion_requested_at) recoverDeletedUser(authDb, googleUser.id);
    ensureWorkspace({ userId: googleUser.id, seed: true });
    return getUserById(googleUser.id);
  }

  const emailUser = querySql(authDb, `
    SELECT id, deletion_requested_at
    FROM users
    WHERE email = ${sqlString(cleanEmail)}
    LIMIT 1;
  `)[0];
  if (emailUser) {
    throw httpError(
      409,
      "같은 이메일의 계정이 이미 있습니다. 이메일로 로그인한 뒤 계정 설정에서 Google을 연동해주세요."
    );
  }

  if (!allowCreate) {
    throw httpError(404, "가입된 Google 계정이 없습니다. 회원가입 화면에서 약관에 동의한 뒤 진행해주세요.");
  }

  const accepted = normalizeRegistrationConsent(consent);
  assertUserCapacity(authDb);
  const id = randomUUID();
  execSql(authDb, `
    INSERT INTO users (
      id, email, google_id, is_autosave_enabled,
      terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, age_confirmed_at
    ) VALUES (
      ${sqlString(id)}, ${sqlString(cleanEmail)}, ${sqlString(cleanGoogleId)}, 1,
      ${sqlString(accepted.acceptedAt)}, ${sqlString(TERMS_VERSION)},
      ${sqlString(accepted.acceptedAt)}, ${sqlString(PRIVACY_VERSION)}, ${sqlString(accepted.acceptedAt)}
    );
  `);

  ensureWorkspace({ userId: id, seed: true });
  return getUserById(id);
}

export function linkGoogleUser({ userId = DEFAULT_USER_ID, email, googleId } = {}) {
  purgeExpiredDeletedUsers();
  const workspace = getWorkspace(userId);
  const current = getRawUserById(workspace.authDb, userId);
  if (!current) throw httpError(404, "User not found.");
  if (current.deletion_requested_at) throw httpError(409, "탈퇴 대기 중인 계정입니다.");

  const cleanEmail = normalizeEmail(email);
  const cleanGoogleId = String(googleId || "").trim();
  if (!cleanGoogleId) throw httpError(400, "Google profile did not include an id.");

  const linkedGoogle = querySql(workspace.authDb, `
    SELECT id
    FROM users
    WHERE google_id = ${sqlString(cleanGoogleId)}
      AND id <> ${sqlString(userId)}
    LIMIT 1;
  `)[0];
  if (linkedGoogle) {
    throw httpError(409, "이 Google 계정은 이미 다른 작업공간에 연동되어 있습니다.");
  }

  const emailOwner = querySql(workspace.authDb, `
    SELECT id
    FROM users
    WHERE email = ${sqlString(cleanEmail)}
      AND id <> ${sqlString(userId)}
    LIMIT 1;
  `)[0];
  if (emailOwner) {
    throw httpError(409, "Google 이메일이 이미 다른 계정에 사용 중입니다.");
  }

  execSql(workspace.authDb, `
    UPDATE users
    SET google_id = ${sqlString(cleanGoogleId)}
    WHERE id = ${sqlString(userId)};
  `);

  return getUserById(userId);
}

export function createPasswordUser({ email, password, consent } = {}) {
  purgeExpiredDeletedUsers();
  const authDb = path.join(DATA_ROOT, "global_db", "auth.sqlite");
  fs.mkdirSync(path.dirname(authDb), { recursive: true });
  initAuthDb(authDb, DEFAULT_USER_ID);

  const cleanEmail = normalizeEmail(email);
  const cleanPassword = normalizePassword(password);
  const existing = querySql(authDb, `
    SELECT id, deletion_requested_at
    FROM users
    WHERE email = ${sqlString(cleanEmail)}
    LIMIT 1;
  `)[0];
  if (existing?.deletion_requested_at) {
    throw httpError(409, "탈퇴 대기 중인 계정입니다. 48시간 안에는 로그인하면 복구됩니다.");
  }
  if (existing) throw httpError(409, "이미 가입된 이메일입니다.");

  const accepted = normalizeRegistrationConsent(consent);
  assertUserCapacity(authDb);
  const id = randomUUID();
  execSql(authDb, `
    INSERT INTO users (
      id, email, password_hash, is_autosave_enabled,
      terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, age_confirmed_at
    ) VALUES (
      ${sqlString(id)}, ${sqlString(cleanEmail)}, ${sqlString(hashPassword(cleanPassword))}, 1,
      ${sqlString(accepted.acceptedAt)}, ${sqlString(TERMS_VERSION)},
      ${sqlString(accepted.acceptedAt)}, ${sqlString(PRIVACY_VERSION)}, ${sqlString(accepted.acceptedAt)}
    );
  `);

  ensureWorkspace({ userId: id, seed: true });
  return getUserById(id);
}

export function getEmailAvailability(email) {
  purgeExpiredDeletedUsers();
  const authDb = path.join(DATA_ROOT, "global_db", "auth.sqlite");
  fs.mkdirSync(path.dirname(authDb), { recursive: true });
  initAuthDb(authDb, DEFAULT_USER_ID);

  const cleanEmail = normalizeEmail(email);
  const existing = querySql(authDb, `
    SELECT id, deletion_requested_at
    FROM users
    WHERE email = ${sqlString(cleanEmail)}
    LIMIT 1;
  `)[0];

  return {
    email: cleanEmail,
    available: !existing,
    pending_deletion: Boolean(existing?.deletion_requested_at)
  };
}

export function authenticatePasswordUser({ email, password } = {}) {
  purgeExpiredDeletedUsers();
  const authDb = path.join(DATA_ROOT, "global_db", "auth.sqlite");
  fs.mkdirSync(path.dirname(authDb), { recursive: true });
  initAuthDb(authDb, DEFAULT_USER_ID);

  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || "");
  const existing = querySql(authDb, `
    SELECT id, password_hash, deletion_requested_at
    FROM users
    WHERE email = ${sqlString(cleanEmail)}
    LIMIT 1;
  `)[0];

  if (!existing?.password_hash || !verifyPassword(cleanPassword, existing.password_hash)) {
    throw httpError(401, "이메일 또는 비밀번호가 올바르지 않습니다.");
  }

  if (existing.deletion_requested_at) {
    recoverDeletedUser(authDb, existing.id);
  }

  ensureWorkspace({ userId: existing.id, seed: true });
  return getUserById(existing.id);
}

export function setAccountPassword({ userId = DEFAULT_USER_ID, password } = {}) {
  purgeExpiredDeletedUsers();
  const workspace = getWorkspace(userId);
  const current = getRawUserById(workspace.authDb, userId);
  if (!current) throw httpError(404, "User not found.");
  if (current.deletion_requested_at) throw httpError(409, "탈퇴 대기 중인 계정입니다.");
  if (current.password_hash) {
    throw httpError(409, "이미 비밀번호가 등록된 계정입니다.");
  }

  execSql(workspace.authDb, `
    UPDATE users
    SET password_hash = ${sqlString(hashPassword(normalizePassword(password)))}
    WHERE id = ${sqlString(userId)};
  `);

  return getUserById(userId);
}

export function requestAccountDeletion({ userId = DEFAULT_USER_ID, email, password } = {}) {
  purgeExpiredDeletedUsers();
  const workspace = getWorkspace(userId);
  const current = getRawUserById(workspace.authDb, userId);
  if (!current) throw httpError(404, "User not found.");
  if (current.deletion_requested_at) throw httpError(409, "이미 탈퇴 대기 중인 계정입니다.");
  if (current.id === DEFAULT_USER_ID && current.email === "local@chrononote.dev") {
    throw httpError(400, "로컬 개발 계정은 탈퇴할 수 없습니다.");
  }

  const cleanEmail = normalizeEmail(email);
  if (cleanEmail !== current.email) {
    throw httpError(400, "이메일이 현재 계정과 일치하지 않습니다.");
  }
  if (!current.password_hash || !verifyPassword(String(password || ""), current.password_hash)) {
    throw httpError(401, "비밀번호가 올바르지 않습니다.");
  }

  const requestedAt = new Date().toISOString();
  execSql(workspace.authDb, `
    UPDATE users
    SET deletion_requested_at = ${sqlString(requestedAt)},
        session_version = session_version + 1
    WHERE id = ${sqlString(userId)};
  `);

  return {
    ok: true,
    deletion_requested_at: requestedAt,
    recover_until: new Date(Date.parse(requestedAt) + ACCOUNT_RECOVERY_MS).toISOString()
  };
}

export function revokeUserSessions(userId = DEFAULT_USER_ID) {
  const workspace = getWorkspace(userId);
  const current = getRawUserById(workspace.authDb, userId);
  if (!current) return false;
  execSql(workspace.authDb, `
    UPDATE users
    SET session_version = session_version + 1
    WHERE id = ${sqlString(userId)};
  `);
  return true;
}

export function updateUserSettings({
  userId = DEFAULT_USER_ID,
  is_autosave_enabled,
  github_sync_repo,
  github_sync_token,
  theme_preference
} = {}) {
  const workspace = getWorkspace(userId);
  const current = getRawUserById(workspace.authDb, userId);
  if (!current) throw httpError(404, "User not found.");

  const nextAutosave = is_autosave_enabled === undefined
    ? Number(current.is_autosave_enabled)
    : (is_autosave_enabled ? 1 : 0);
  const nextRepo = github_sync_repo === undefined
    ? current.github_sync_repo
    : normalizeRepo(github_sync_repo);
  const nextToken = github_sync_token === undefined
    ? current.github_sync_token
    : (String(github_sync_token || "").trim() ? encryptSecret(github_sync_token) : null);
  const nextTheme = theme_preference === undefined
    ? current.theme_preference
    : normalizeTheme(theme_preference);

  execSql(workspace.authDb, `
    UPDATE users
    SET
      is_autosave_enabled = ${Number(nextAutosave)},
      github_sync_repo = ${sqlString(nextRepo)},
      github_sync_token = ${sqlString(nextToken)},
      theme_preference = ${sqlString(nextTheme)}
    WHERE id = ${sqlString(userId)};
  `);

  return getUserById(userId);
}

export function isAutosaveEnabled(userId = DEFAULT_USER_ID) {
  return Boolean(getUserById(userId)?.is_autosave_enabled);
}

export function listMemos({ userId = DEFAULT_USER_ID, search = "", tag = "" } = {}) {
  const workspace = getWorkspace(userId);
  ensureFoldersFromMemos(workspace);
  const clauses = [];
  const term = String(search || "").trim();
  const tagName = String(tag || "").trim();

  if (term) {
    const like = sqlString(`%${escapeLike(term)}%`);
    clauses.push(`(
      m.title LIKE ${like} ESCAPE '\\'
      OR m.content LIKE ${like} ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM memo_tags mt_search
        JOIN tags t_search ON t_search.id = mt_search.tag_id
        WHERE mt_search.memo_id = m.id AND t_search.name LIKE ${like} ESCAPE '\\'
      )
    )`);
  }

  if (tagName) {
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM memo_tags mt_filter
        JOIN tags t_filter ON t_filter.id = mt_filter.tag_id
        WHERE mt_filter.memo_id = m.id AND t_filter.name = ${sqlString(tagName)}
      )
    `);
  }

  const rows = querySql(workspace.userDb, `
    SELECT
      m.id,
      m.file_path,
      m.folder,
      m.pinned,
      m.position,
      m.trashed_at,
      m.original_folder,
      m.title,
      substr(m.content, 1, 220) AS excerpt,
      m.created_at,
      m.updated_at,
      COALESCE(group_concat(t.name, '||'), '') AS tags
    FROM memos m
    LEFT JOIN memo_tags mt ON mt.memo_id = m.id
    LEFT JOIN tags t ON t.id = mt.tag_id
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    GROUP BY m.id
    ORDER BY m.position ASC, m.pinned DESC, datetime(m.updated_at) DESC, m.title COLLATE NOCASE ASC;
  `);

  return rows.map((row) => ({
    ...row,
    pinned: Boolean(row.pinned),
    tags: row.tags ? String(row.tags).split("||").filter(Boolean) : []
  }));
}

export function listTags({ userId = DEFAULT_USER_ID } = {}) {
  const workspace = getWorkspace(userId);
  const rows = querySql(workspace.userDb, `
    SELECT
      t.name,
      COUNT(mt.memo_id) AS memo_count
    FROM tags t
    JOIN memo_tags mt ON mt.tag_id = t.id
    JOIN memos m ON m.id = mt.memo_id
    WHERE m.trashed_at IS NULL
      AND COALESCE(m.folder, '') <> ${sqlString(TRASH_FOLDER_NAME)}
    GROUP BY t.name
    ORDER BY memo_count DESC, t.name COLLATE NOCASE ASC;
  `);

  return rows.map((row) => ({
    name: row.name,
    memo_count: Number(row.memo_count || 0)
  }));
}

export function listFolders({ userId = DEFAULT_USER_ID } = {}) {
  const workspace = getWorkspace(userId);
  ensureFoldersFromMemos(workspace);

  const rows = querySql(workspace.userDb, `
    SELECT
      f.name,
      f.icon,
      f.position,
      f.created_at,
      COUNT(m.id) AS memo_count
    FROM folders f
    LEFT JOIN memos m ON COALESCE(m.folder, '') = f.name
    GROUP BY f.name
    ORDER BY f.position ASC, f.name COLLATE NOCASE ASC;
  `);

  return rows.map(serializeFolder);
}

export function createFolder({ userId = DEFAULT_USER_ID, name, icon } = {}) {
  const workspace = getWorkspace(userId);
  const cleanName = normalizeFolderName(name);
  ensureFolder(workspace, cleanName, icon);
  return {
    folder: listFolders({ userId }).find((folder) => folder.name === cleanName),
    folders: listFolders({ userId })
  };
}

export function updateFolderIcon({ userId = DEFAULT_USER_ID, name = "", icon = "" } = {}) {
  const workspace = getWorkspace(userId);
  const cleanName = normalizeFolderName(name, { allowDefault: true });
  const cleanIcon = normalizeFolderIcon(icon);
  ensureFolder(workspace, cleanName);

  execSql(workspace.userDb, `
    UPDATE folders
    SET icon = ${sqlString(cleanIcon)}
    WHERE name = ${sqlString(cleanName)};
  `);

  return {
    folder: listFolders({ userId }).find((folder) => folder.name === cleanName),
    folders: listFolders({ userId })
  };
}

export function deleteFolder({ userId = DEFAULT_USER_ID, name = "" } = {}) {
  const workspace = getWorkspace(userId);
  const cleanName = normalizeFolderName(name, { allowDefault: true });
  if (!cleanName) throw httpError(400, "기본 폴더는 삭제할 수 없습니다.");
  if (cleanName === TRASH_FOLDER_NAME) throw httpError(400, "휴지통은 삭제할 수 없습니다.");

  ensureFoldersFromMemos(workspace);
  const existing = querySql(workspace.userDb, `
    SELECT name
    FROM folders
    WHERE name = ${sqlString(cleanName)}
    LIMIT 1;
  `)[0];
  if (!existing) throw httpError(404, "Folder not found.");

  const memoRows = querySql(workspace.userDb, `
    SELECT id
    FROM memos
    WHERE COALESCE(folder, '') = ${sqlString(cleanName)}
    ORDER BY position ASC, updated_at DESC, title COLLATE NOCASE ASC;
  `);
  const changedRelPaths = new Set();
  let position = nextMemoPosition(workspace, "");

  for (const row of memoRows) {
    const id = row.id;
    assertSafeMemoId(id);
    const originalPath = memoPath(workspace, id);
    if (!fs.existsSync(originalPath)) continue;

    const current = readMemo({ userId, id });
    const nextOriginal = buildMarkdown({
      ...current,
      id,
      folder: "",
      position: position++
    });
    fs.writeFileSync(originalPath, nextOriginal);

    let indexedMarkdown = nextOriginal;
    const autosavePath = autosaveMemoPath(workspace, id);
    if (fs.existsSync(autosavePath)) {
      const autosave = parseMarkdown(fs.readFileSync(autosavePath, "utf8"), current);
      const nextAutosave = buildMarkdown({
        ...autosave,
        id,
        folder: "",
        position: position - 1
      });
      fs.writeFileSync(autosavePath, nextAutosave);
      indexedMarkdown = nextAutosave;
    }

    syncMemoFromMarkdown(workspace, id, indexedMarkdown);
    changedRelPaths.add(memoRelPath(id));
  }

  execSql(workspace.userDb, `
    DELETE FROM folders
    WHERE name = ${sqlString(cleanName)};
  `);

  for (const relPath of changedRelPaths) {
    runGit(workspace.userDir, ["add", "--", relPath]);
  }
  const commit = changedRelPaths.size
    ? commitRaw(workspace.userDir, `delete folder: ${cleanName}`, [...changedRelPaths], { allowEmpty: false })
    : { committed: false, hash: null };

  return {
    ok: true,
    folder: cleanName,
    moved_count: memoRows.length,
    folders: listFolders({ userId }),
    memos: listMemos({ userId }),
    commit
  };
}

export function reorderFolders({ userId = DEFAULT_USER_ID, names = [] } = {}) {
  const workspace = getWorkspace(userId);
  ensureFoldersFromMemos(workspace);
  const cleanNames = [...new Set(names.map((name) => normalizeFolderName(name, { allowDefault: true })))];
  const existing = querySql(workspace.userDb, "SELECT name FROM folders;").map((folder) => folder.name || "");

  if (cleanNames.length !== existing.length || existing.some((name) => !cleanNames.includes(name))) {
    throw httpError(400, "Folder order did not include every folder.");
  }

  const updates = cleanNames.map((name, index) => `
    UPDATE folders
    SET position = ${index}
    WHERE name = ${sqlString(name)};
  `).join("\n");
  execSql(workspace.userDb, `BEGIN; ${updates} COMMIT;`);

  return { folders: listFolders({ userId }) };
}

export function moveFolder({ userId = DEFAULT_USER_ID, name = "", direction = "up" } = {}) {
  const workspace = getWorkspace(userId);
  ensureFoldersFromMemos(workspace);

  const folders = querySql(workspace.userDb, `
    SELECT name, position
    FROM folders
    ORDER BY position ASC, name COLLATE NOCASE ASC;
  `);
  const index = folders.findIndex((folder) => folder.name === normalizeFolderName(name, { allowDefault: true }));
  if (index === -1) throw httpError(404, "Folder not found.");

  const offset = direction === "down" ? 1 : -1;
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= folders.length) {
    return { folders: listFolders({ userId }) };
  }

  const current = folders[index];
  const target = folders[targetIndex];
  execSql(workspace.userDb, `
    BEGIN;
    UPDATE folders SET position = ${Number(target.position)} WHERE name = ${sqlString(current.name)};
    UPDATE folders SET position = ${Number(current.position)} WHERE name = ${sqlString(target.name)};
    COMMIT;
  `);

  return { folders: listFolders({ userId }) };
}

export function createMemo({ userId = DEFAULT_USER_ID, title = "Untitled", tags = [], content = "", folder = "" } = {}) {
  const workspace = getWorkspace(userId);
  const count = Number(querySql(workspace.userDb, "SELECT COUNT(*) AS count FROM memos;")[0]?.count || 0);
  if (count >= MAX_MEMO_COUNT) {
    throw httpError(413, `메모는 계정당 최대 ${MAX_MEMO_COUNT}개까지 만들 수 있습니다.`);
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const cleanFolder = normalizeFolderName(folder, { allowDefault: true });
  ensureFolder(workspace, cleanFolder);
  const position = nextMemoPosition(workspace, cleanFolder);
  const markdown = buildMarkdown({
    id,
    title,
    tags,
    folder: cleanFolder,
    pinned: false,
    position,
    created_at: now,
    updated_at: now,
    content
  });

  const targetPath = memoPath(workspace, id);
  reserveWorkspaceWrite(workspace, targetPath, markdown, { historyCopy: true });
  fs.writeFileSync(targetPath, markdown);
  syncMemoFromMarkdown(workspace, id, markdown);
  commitMemoFile(workspace, id, `create: ${title || id}`);
  return readMemo({ userId, id });
}

export function importTextFiles({ userId = DEFAULT_USER_ID, files = [], folder = "" } = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw httpError(400, "가져올 텍스트 파일이 없습니다.");
  }
  if (files.length > 100) {
    throw httpError(400, "한 번에 가져올 수 있는 파일은 100개까지입니다.");
  }

  const workspace = getWorkspace(userId);
  const existingCount = Number(querySql(workspace.userDb, "SELECT COUNT(*) AS count FROM memos;")[0]?.count || 0);
  if (existingCount + files.length > MAX_MEMO_COUNT) {
    throw httpError(413, `가져온 뒤 메모가 계정당 한도(${MAX_MEMO_COUNT}개)를 넘습니다.`);
  }

  const requestedBytes = files.reduce((total, file) => {
    return total + Buffer.byteLength(String(file?.content ?? ""), "utf8");
  }, 0);
  if (requestedBytes > TEXT_IMPORT_TOTAL_LIMIT_BYTES) {
    throw httpError(413, "텍스트 파일은 한 번에 최대 20MB까지 가져올 수 있습니다.");
  }
  assertWorkspaceCapacity(workspace, requestedBytes * 2);

  let totalBytes = 0;
  const cleanFolder = normalizeFolderName(folder, { allowDefault: true });
  const imported = [];

  for (const file of files) {
    const name = String(file?.name || "memo.txt").trim() || "memo.txt";
    const content = String(file?.content ?? "");
    totalBytes += Buffer.byteLength(content, "utf8");
    if (totalBytes > TEXT_IMPORT_TOTAL_LIMIT_BYTES) {
      throw httpError(413, "텍스트 파일은 한 번에 최대 20MB까지 가져올 수 있습니다.");
    }

    const fallbackTitle = titleFromFileName(name);
    const parsed = parseMarkdown(content, {
      title: fallbackTitle,
      tags: [],
      folder: cleanFolder,
      content
    });
    imported.push(createMemo({
      userId,
      title: parsed.title || fallbackTitle,
      tags: parsed.tags || [],
      content: parsed.content ?? content,
      folder: parsed.folder || cleanFolder
    }));
  }

  return {
    memos: imported,
    count: imported.length,
    total_bytes: totalBytes
  };
}

export function readMemo({ userId = DEFAULT_USER_ID, id }) {
  const workspace = getWorkspace(userId);
  assertSafeMemoId(id);

  const originalPath = currentMemoPath(workspace, id);
  const autosavePath = autosaveMemoPath(workspace, id);
  const originalMarkdown = memoFileExists(workspace, id) && fs.existsSync(originalPath) ? fs.readFileSync(originalPath, "utf8") : "";
  const autosaveMarkdown = fs.existsSync(autosavePath) ? fs.readFileSync(autosavePath, "utf8") : "";
  const original = parseMarkdown(originalMarkdown, { id });
  const autosave = autosaveMarkdown ? parseMarkdown(autosaveMarkdown, original) : null;

  return {
    ...original,
    id,
    markdown: originalMarkdown || buildMarkdown({ ...original, id }),
    has_autosave: Boolean(autosaveMarkdown),
    autosave_markdown: autosaveMarkdown || null,
    autosave
  };
}

export function autosaveMemo({ userId = DEFAULT_USER_ID, id, markdown, title, tags, content, folder, pinned }) {
  const workspace = getWorkspace(userId);
  assertSafeMemoId(id);
  const current = readMemo({ userId, id });
  const next = coerceMarkdown({
    id,
    markdown,
    title,
    tags,
    folder,
    pinned,
    content,
    fallback: current,
    touchUpdatedAt: true
  });

  const targetPath = autosaveMemoPath(workspace, id);
  reserveWorkspaceWrite(workspace, targetPath, next);
  fs.writeFileSync(targetPath, next);
  syncMemoFromMarkdown(workspace, id, next);
  return readMemo({ userId, id });
}

export function commitMemo({ userId = DEFAULT_USER_ID, id, markdown, title, tags, content, folder, pinned, message }) {
  const workspace = getWorkspace(userId);
  assertSafeMemoId(id);
  const current = readMemo({ userId, id });
  const autosavePath = autosaveMemoPath(workspace, id);
  const fallbackMarkdown = fs.existsSync(autosavePath)
    ? fs.readFileSync(autosavePath, "utf8")
    : current.markdown;
  const fallback = parseMarkdown(fallbackMarkdown, current);
  const next = coerceMarkdown({
    id,
    markdown,
    title,
    tags,
    folder,
    pinned,
    content,
    fallback,
    touchUpdatedAt: true
  });

  const targetPath = currentMemoPath(workspace, id);
  reserveWorkspaceWrite(workspace, targetPath, next, { historyCopy: true });
  fs.writeFileSync(targetPath, next);
  if (fs.existsSync(autosavePath)) fs.unlinkSync(autosavePath);
  syncMemoFromMarkdown(workspace, id, next, { relPath: currentMemoRelPath(workspace, id) });
  const commitMsg = String(message || "").trim() || `update: ${id}`;
  const commit = commitMemoFile(workspace, id, commitMsg);
  return {
    memo: readMemo({ userId, id }),
    commit
  };
}

export function discardAutosave({ userId = DEFAULT_USER_ID, id }) {
  const workspace = getWorkspace(userId);
  assertSafeMemoId(id);
  const autosavePath = autosaveMemoPath(workspace, id);
  if (fs.existsSync(autosavePath)) fs.unlinkSync(autosavePath);

  const originalPath = currentMemoPath(workspace, id);
  if (memoFileExists(workspace, id) && fs.existsSync(originalPath)) {
    syncMemoFromMarkdown(workspace, id, fs.readFileSync(originalPath, "utf8"), { relPath: currentMemoRelPath(workspace, id) });
  } else {
    execSql(workspace.userDb, `
      DELETE FROM memo_tags WHERE memo_id = ${sqlString(id)};
      DELETE FROM memos WHERE id = ${sqlString(id)};
    `);
  }

  return readMemo({ userId, id });
}

export function deleteMemo({ userId = DEFAULT_USER_ID, id }) {
  const workspace = getWorkspace(userId);
  assertSafeMemoId(id);
  if (!memoFileExists(workspace, id)) throw httpError(404, "Memo not found.");

  const current = readMemo({ userId, id });
  if (current.trashed_at || fs.existsSync(trashMemoPath(workspace, id))) {
    return hardDeleteMemo(workspace, id, { commitMessage: `delete: ${id}` });
  }

  const autosavePath = autosaveMemoPath(workspace, id);
  if (fs.existsSync(autosavePath)) fs.unlinkSync(autosavePath);

  fs.mkdirSync(workspace.trashDir, { recursive: true });
  const now = new Date().toISOString();
  const originalFolder = current.folder === TRASH_FOLDER_NAME ? (current.original_folder || "") : (current.folder || "");
  const position = nextMemoPosition(workspace, TRASH_FOLDER_NAME);
  const markdown = buildMarkdown({
    ...current,
    id,
    folder: TRASH_FOLDER_NAME,
    original_folder: originalFolder,
    trashed_at: now,
    pinned: false,
    position,
    updated_at: now
  });
  const activePath = memoPath(workspace, id);
  const trashPath = trashMemoPath(workspace, id);
  fs.writeFileSync(trashPath, markdown);
  if (fs.existsSync(activePath)) fs.rmSync(activePath, { force: true });

  runGit(workspace.userDir, ["add", "-A", "--", memoRelPath(id), trashMemoRelPath(id)]);
  const commit = commitRaw(workspace.userDir, `trash: ${id}`, [memoRelPath(id), trashMemoRelPath(id)], { allowEmpty: false });
  syncMemoFromMarkdown(workspace, id, markdown, { relPath: trashMemoRelPath(id) });

  return {
    ok: true,
    trashed: true,
    hard_deleted: false,
    purge_at: new Date(Date.parse(now) + TRASH_RETENTION_MS).toISOString(),
    memo: readMemo({ userId, id }),
    commit
  };
}

export function restoreTrashedMemo({ userId = DEFAULT_USER_ID, id }) {
  const workspace = getWorkspace(userId);
  assertSafeMemoId(id);
  const trashPath = trashMemoPath(workspace, id);
  if (!fs.existsSync(trashPath)) throw httpError(404, "휴지통에서 메모를 찾을 수 없습니다.");

  const current = readMemo({ userId, id });
  const restoredFolder = normalizeFolderName(current.original_folder || "", { allowDefault: true });
  ensureFolder(workspace, restoredFolder);
  const now = new Date().toISOString();
  const markdown = buildMarkdown({
    ...current,
    id,
    folder: restoredFolder,
    original_folder: "",
    trashed_at: null,
    position: nextMemoPosition(workspace, restoredFolder),
    updated_at: now
  });
  const activePath = memoPath(workspace, id);
  fs.writeFileSync(activePath, markdown);
  fs.rmSync(trashPath, { force: true });

  runGit(workspace.userDir, ["add", "-A", "--", memoRelPath(id), trashMemoRelPath(id)]);
  const commit = commitRaw(workspace.userDir, `restore from trash: ${id}`, [memoRelPath(id), trashMemoRelPath(id)], { allowEmpty: false });
  syncMemoFromMarkdown(workspace, id, markdown, { relPath: memoRelPath(id) });

  return {
    ok: true,
    restored: true,
    memo: readMemo({ userId, id }),
    commit
  };
}

export function purgeExpiredTrashedMemos({ userId = DEFAULT_USER_ID, now = new Date() } = {}) {
  const workspace = getWorkspace(userId);
  if (!fs.existsSync(workspace.userDb)) return { purged: 0 };
  ensureMemosColumns(workspace.userDb);
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_MS).toISOString();
  const rows = querySql(workspace.userDb, `
    SELECT id
    FROM memos
    WHERE trashed_at IS NOT NULL
      AND trashed_at <= ${sqlString(cutoff)};
  `);

  let purged = 0;
  for (const row of rows) {
    if (!memoFileExists(workspace, row.id)) continue;
    hardDeleteMemo(workspace, row.id, { commitMessage: `purge trash: ${row.id}` });
    purged += 1;
  }

  return { purged };
}

function hardDeleteMemo(workspace, id, { commitMessage = `delete: ${id}` } = {}) {
  assertSafeMemoId(id);
  const autosavePath = autosaveMemoPath(workspace, id);
  if (fs.existsSync(autosavePath)) fs.unlinkSync(autosavePath);

  const relPaths = [memoRelPath(id), trashMemoRelPath(id)];
  fs.rmSync(memoPath(workspace, id), { force: true });
  fs.rmSync(trashMemoPath(workspace, id), { force: true });
  runGit(workspace.userDir, ["add", "-A", "--", "memos", "trash"]);
  const commit = commitRaw(workspace.userDir, commitMessage, ["memos", "trash"], { allowEmpty: false });

  execSql(workspace.userDb, `
    DELETE FROM memo_tags WHERE memo_id = ${sqlString(id)};
    DELETE FROM memos WHERE id = ${sqlString(id)};
  `);

  return {
    ok: true,
    trashed: false,
    hard_deleted: true,
    commit
  };
}

export function updateMemoPin({ userId = DEFAULT_USER_ID, id, pinned = false }) {
  const workspace = getWorkspace(userId);
  assertSafeMemoId(id);

  const originalPath = currentMemoPath(workspace, id);
  const autosavePath = autosaveMemoPath(workspace, id);
  if (!memoFileExists(workspace, id) || !fs.existsSync(originalPath)) throw httpError(404, "Memo not found.");
  if (fs.existsSync(trashMemoPath(workspace, id))) throw httpError(400, "휴지통의 메모는 고정할 수 없습니다.");

  const original = parseMarkdown(fs.readFileSync(originalPath, "utf8"), { id });
  const nextPinned = Boolean(pinned);
  const nextOriginal = buildMarkdown({
    ...original,
    id,
    pinned: nextPinned
  });
  fs.writeFileSync(originalPath, nextOriginal);

  let indexedMarkdown = nextOriginal;
  if (fs.existsSync(autosavePath)) {
    const autosave = parseMarkdown(fs.readFileSync(autosavePath, "utf8"), original);
    const nextAutosave = buildMarkdown({
      ...autosave,
      id,
      pinned: nextPinned
    });
    fs.writeFileSync(autosavePath, nextAutosave);
    indexedMarkdown = nextAutosave;
  }

  syncMemoFromMarkdown(workspace, id, indexedMarkdown, { relPath: currentMemoRelPath(workspace, id) });
  commitMemoFile(workspace, id, nextPinned ? `pin: ${id}` : `unpin: ${id}`);
  return readMemo({ userId, id });
}

export function reorderMemos({ userId = DEFAULT_USER_ID, groups = [] } = {}) {
  const workspace = getWorkspace(userId);
  if (!Array.isArray(groups) || !groups.length) {
    throw httpError(400, "Memo order is empty.");
  }

  const seen = new Set();
  const changedRelPaths = new Set();

  for (const group of groups) {
    const folder = normalizeFolderName(group?.folder || "", { allowDefault: true });
    const memoIds = Array.isArray(group?.memoIds) ? group.memoIds : [];
    ensureFolder(workspace, folder);
    if (folder === TRASH_FOLDER_NAME) ensureTrashFolder(workspace);

    memoIds.forEach((memoId, index) => {
      assertSafeMemoId(memoId);
      if (seen.has(memoId)) throw httpError(400, "Memo order includes duplicate ids.");
      seen.add(memoId);

      if (!memoFileExists(workspace, memoId)) throw httpError(404, "Memo not found.");

      const current = readMemo({ userId, id: memoId });
      const position = index + 1;
      const movingToTrash = folder === TRASH_FOLDER_NAME;
      const targetRelPath = movingToTrash ? trashMemoRelPath(memoId) : memoRelPath(memoId);
      const targetPath = movingToTrash ? trashMemoPath(workspace, memoId) : memoPath(workspace, memoId);
      const previousRelPath = currentMemoRelPath(workspace, memoId);
      const now = new Date().toISOString();
      const nextOriginal = buildMarkdown({
        ...current,
        id: memoId,
        folder,
        original_folder: movingToTrash
          ? (current.original_folder || (current.folder === TRASH_FOLDER_NAME ? "" : current.folder || ""))
          : "",
        trashed_at: movingToTrash ? (current.trashed_at || now) : null,
        pinned: movingToTrash ? false : current.pinned,
        position
      });
      fs.writeFileSync(targetPath, nextOriginal);
      if (targetRelPath !== previousRelPath) {
        fs.rmSync(targetRelPath === memoRelPath(memoId) ? trashMemoPath(workspace, memoId) : memoPath(workspace, memoId), { force: true });
      }

      let indexedMarkdown = nextOriginal;
      const autosavePath = autosaveMemoPath(workspace, memoId);
      if (fs.existsSync(autosavePath)) {
        const autosave = parseMarkdown(fs.readFileSync(autosavePath, "utf8"), current);
        const nextAutosave = buildMarkdown({
          ...autosave,
          id: memoId,
          folder,
          original_folder: movingToTrash
            ? (current.original_folder || (current.folder === TRASH_FOLDER_NAME ? "" : current.folder || ""))
            : "",
          trashed_at: movingToTrash ? (current.trashed_at || now) : null,
          pinned: movingToTrash ? false : autosave.pinned,
          position
        });
        fs.writeFileSync(autosavePath, nextAutosave);
        indexedMarkdown = nextAutosave;
      }

      syncMemoFromMarkdown(workspace, memoId, indexedMarkdown, { relPath: targetRelPath });
      changedRelPaths.add(targetRelPath);
      if (targetRelPath !== previousRelPath) changedRelPaths.add(previousRelPath);
    });
  }

  for (const relPath of changedRelPaths) {
    runGit(workspace.userDir, ["add", "--", relPath]);
  }

  const commit = changedRelPaths.size
    ? commitRaw(workspace.userDir, "reorder: memos", [...changedRelPaths], { allowEmpty: false })
    : { committed: false, hash: null };
  return {
    memos: listMemos({ userId }),
    commit
  };
}

export function memoHistory({ userId = DEFAULT_USER_ID, id }) {
  const workspace = getWorkspace(userId);
  assertSafeMemoId(id);
  const relPath = currentMemoRelPath(workspace, id);
  const output = runGit(workspace.userDir, [
    "log",
    "--follow",
    "--format=%H|%cd|%s",
    "--date=iso",
    "--",
    relPath
  ], { allowFail: true });

  const current = readMemo({ userId, id });
  const deletedCommits = new Set(current.deleted_commits || []);

  return output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...subject] = line.split("|");
      return { hash, date, subject: subject.join("|") };
    })
    .filter((item) => !deletedCommits.has(item.hash));
}

export function readMemoHistoryVersion({ userId = DEFAULT_USER_ID, id, commit }) {
  const workspace = getWorkspace(userId);
  assertSafeMemoId(id);
  const cleanCommit = String(commit || "").trim();
  if (!COMMIT_PATTERN.test(cleanCommit)) {
    throw httpError(400, "Invalid commit hash.");
  }

  const relPath = currentMemoRelPath(workspace, id);
  const fullHash = resolveCommit(workspace.userDir, cleanCommit);
  const memoCommits = new Set(runGit(workspace.userDir, [
    "log",
    "--follow",
    "--format=%H",
    "--",
    relPath
  ]).trim().split(/\r?\n/).filter(Boolean));
  if (!memoCommits.has(fullHash)) {
    throw httpError(404, "이 커밋은 현재 메모의 히스토리가 아닙니다.");
  }

  const commitRelPath = memoRelPathAtCommit(workspace, id, fullHash);
  const markdown = runGit(workspace.userDir, ["show", `${fullHash}:${commitRelPath}`]);
  const [hash, date, ...subject] = runGit(workspace.userDir, [
    "show",
    "-s",
    "--format=%H|%cd|%s",
    "--date=iso",
    fullHash
  ]).trim().split("|");

  return {
    commit: {
      hash,
      date,
      subject: subject.join("|")
    },
    markdown,
    memo: parseMarkdown(markdown, { id })
  };
}

export function deleteMemoHistory({ userId = DEFAULT_USER_ID, id, commit }) {
  const workspace = getWorkspace(userId);
  assertSafeMemoId(id);
  const cleanCommit = String(commit || "").trim();
  if (!COMMIT_PATTERN.test(cleanCommit)) {
    throw httpError(400, "Invalid commit hash.");
  }

  hardDeleteGitCommit(workspace, cleanCommit, [currentMemoRelPath(workspace, id), memoRelPath(id), trashMemoRelPath(id)]);
  rebuildIndex(userId);

  const originalPath = currentMemoPath(workspace, id);
  return {
    ok: true,
    deleted_commit: cleanCommit,
    memo: memoFileExists(workspace, id) && fs.existsSync(originalPath) ? readMemo({ userId, id }) : null,
    history: memoFileExists(workspace, id) && fs.existsSync(originalPath) ? memoHistory({ userId, id }) : []
  };
}

export function restoreMemo({ userId = DEFAULT_USER_ID, id, commit }) {
  const workspace = getWorkspace(userId);
  assertSafeMemoId(id);
  if (!COMMIT_PATTERN.test(String(commit || ""))) {
    throw httpError(400, "Invalid commit hash.");
  }

  const fullHash = resolveCommit(workspace.userDir, commit);
  const relPath = memoRelPathAtCommit(workspace, id, fullHash);
  const restoredMarkdown = runGit(workspace.userDir, ["show", `${fullHash}:${relPath}`]);
  const targetRelPath = currentMemoRelPath(workspace, id);
  const current = readMemo({ userId, id });
  const restored = parseMarkdown(restoredMarkdown, current);
  const markdown = buildMarkdown({
    ...restored,
    id,
    folder: current.trashed_at ? TRASH_FOLDER_NAME : (restored.folder || ""),
    original_folder: current.trashed_at ? (current.original_folder || restored.folder || "") : "",
    trashed_at: current.trashed_at || null
  });
  fs.writeFileSync(targetRelPath === trashMemoRelPath(id) ? trashMemoPath(workspace, id) : memoPath(workspace, id), markdown);

  const autosavePath = autosaveMemoPath(workspace, id);
  if (fs.existsSync(autosavePath)) fs.unlinkSync(autosavePath);

  syncMemoFromMarkdown(workspace, id, markdown, { relPath: targetRelPath });
  const saved = commitMemoFile(workspace, id, `restore: past version (${String(commit).slice(0, 7)})`);
  return {
    memo: readMemo({ userId, id }),
    commit: saved
  };
}

export async function uploadAttachment({ userId = DEFAULT_USER_ID, filename = "image.png", data = "" }) {
  const workspace = getWorkspace(userId);
  const parsed = parseDataUrl(data);
  if (parsed.buffer.length > ATTACHMENT_UPLOAD_LIMIT_BYTES) {
    throw httpError(413, "첨부파일은 한 번에 20MB까지만 업로드할 수 있습니다.");
  }

  const prepared = await prepareAttachment({
    buffer: parsed.buffer,
    filename,
    declaredMime: parsed.mime
  });
  const savedName = `media_${randomUUID()}${prepared.ext}`;
  const targetPath = path.join(workspace.attachmentsDir, savedName);
  reserveWorkspaceWrite(workspace, targetPath, prepared.buffer);
  fs.writeFileSync(targetPath, prepared.buffer);
  const markdownPath = `../.attachments/${savedName}`;
  return {
    filename: savedName,
    markdown_path: markdownPath,
    url: `/attachments/${savedName}`,
    media_type: prepared.mediaType,
    embed_markdown: embedMarkdown({ label: filename, path: markdownPath, mediaType: prepared.mediaType }),
    original_bytes: parsed.buffer.length,
    stored_bytes: prepared.buffer.length
  };
}

export function getAttachmentPath({ userId = DEFAULT_USER_ID, filename }) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(String(filename || ""))) {
    throw httpError(400, "Invalid attachment name.");
  }

  const workspace = getWorkspace(userId);
  const attachmentPath = path.join(workspace.attachmentsDir, filename);
  if (!fs.existsSync(attachmentPath)) throw httpError(404, "Attachment not found.");
  return attachmentPath;
}

export async function exportArchive({ userId = DEFAULT_USER_ID, includeHistory = false } = {}) {
  const workspace = getWorkspace(userId);
  const archivePath = path.join(os.tmpdir(), `chrononote-${userId}-${Date.now()}.zip`);
  const args = ["-r", archivePath, ".", "-x", ".autosaves/*", "personal_index.sqlite", "auth.sqlite", ".chrononote-permissions-v1"];
  if (!includeHistory) {
    args.push(".git/*");
  }
  try {
    await runAsync("zip", args, { cwd: workspace.userDir, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return archivePath;
  } catch (error) {
    fs.rmSync(archivePath, { force: true });
    throw error;
  }
}

export async function compactWorkspace({ userId = DEFAULT_USER_ID } = {}) {
  const workspace = getWorkspace(userId);
  const beforeBytes = directorySize(workspace.userDir);

  await runGitAsync(workspace.userDir, ["config", "core.compression", "9"]);
  await runGitAsync(workspace.userDir, ["config", "pack.windowMemory", "128m"]);
  await runGitAsync(workspace.userDir, ["repack", "-Ad", "-f", "--depth=250", "--window=250"], { timeout: 120_000 });
  await runGitAsync(workspace.userDir, ["prune", "--expire=now"]);
  await runGitAsync(workspace.userDir, ["gc", "--aggressive", "--prune=now"], { timeout: 120_000 });

  execSql(workspace.userDb, "VACUUM; PRAGMA optimize;");
  if (fs.existsSync(workspace.authDb)) {
    execSql(workspace.authDb, "VACUUM; PRAGMA optimize;");
  }

  const afterBytes = directorySize(workspace.userDir);
  WORKSPACE_USAGE_CACHE.set(workspace.userDir, { used_bytes: afterBytes, measured_at: Date.now() });
  return {
    ok: true,
    before_bytes: beforeBytes,
    after_bytes: afterBytes,
    saved_bytes: Math.max(0, beforeBytes - afterBytes)
  };
}

export async function syncGithub({ userId = DEFAULT_USER_ID } = {}) {
  const workspace = getWorkspace(userId);
  const rawUser = getRawUserById(workspace.authDb, userId);
  if (!rawUser) throw httpError(404, "User not found.");

  const repo = normalizeRepo(rawUser.github_sync_repo);
  if (!repo) throw httpError(400, "GitHub 저장소가 설정되지 않았습니다.");
  if (!rawUser.github_sync_token) throw httpError(400, "GitHub PAT가 설정되지 않았습니다.");

  const token = decryptSecret(rawUser.github_sync_token);
  const publicRemote = `https://github.com/${repo}.git`;

  let hasRemote = true;
  try {
    await runGitAsync(workspace.userDir, ["remote", "get-url", "origin"]);
  } catch {
    hasRemote = false;
  }
  await runGitAsync(workspace.userDir, ["remote", hasRemote ? "set-url" : "add", "origin", publicRemote]);

  const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
  const redactions = [token, auth];
  const output = await runGitAsync(workspace.userDir, [
    "-c",
    `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`,
    "push",
    "origin",
    "master"
  ], { redactions, timeout: 120_000 });

  return {
    ok: true,
    repo,
    remote: publicRemote,
    output: sanitizeGitOutput(output, redactions)
  };
}

export function rebuildIndex(userId = DEFAULT_USER_ID) {
  const workspace = getWorkspace(userId);
  if (!fs.existsSync(workspace.memosDir)) return;

  const seenIds = [];
  const sources = [
    { dir: workspace.memosDir, rel: memoRelPath },
    { dir: workspace.trashDir, rel: trashMemoRelPath }
  ];
  for (const source of sources) {
    if (!fs.existsSync(source.dir)) continue;
    for (const file of fs.readdirSync(source.dir)) {
      if (!file.endsWith(".md")) continue;
      const id = file.slice(0, -3);
      if (!MEMO_ID_PATTERN.test(id)) continue;
      seenIds.push(id);
      const filePath = path.join(source.dir, file);
      syncMemoFromMarkdown(workspace, id, fs.readFileSync(filePath, "utf8"), { relPath: source.rel(id) });
    }
  }

  const keepList = seenIds.map(sqlString).join(", ");
  execSql(workspace.userDb, `
    DELETE FROM memo_tags
    WHERE memo_id NOT IN (${keepList || "''"});

    DELETE FROM memos
    WHERE id NOT IN (${keepList || "''"});
  `);

  ensureFoldersFromMemos(workspace);
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function initAuthDb(authDb, userId) {
  execSql(authDb, `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      google_id TEXT UNIQUE,
      password_hash TEXT,
      is_autosave_enabled BOOLEAN DEFAULT 1,
      github_sync_token TEXT,
      github_sync_repo TEXT,
      theme_preference TEXT DEFAULT 'system',
      deletion_requested_at TEXT,
      session_version INTEGER NOT NULL DEFAULT 0,
      terms_accepted_at TEXT,
      terms_version TEXT,
      privacy_accepted_at TEXT,
      privacy_version TEXT,
      age_confirmed_at TEXT
    );
  `);

  ensureAuthColumns(authDb);

  execSql(authDb, `

    INSERT OR IGNORE INTO users (id, email, is_autosave_enabled)
    VALUES (${sqlString(userId)}, 'local@chrononote.dev', 1);
  `);
}

function getRawUserById(authDb, userId) {
  return querySql(authDb, `
    SELECT id, email, google_id, password_hash, is_autosave_enabled, github_sync_token, github_sync_repo, theme_preference,
           deletion_requested_at, session_version, terms_version, privacy_version, age_confirmed_at
    FROM users
    WHERE id = ${sqlString(userId)}
    LIMIT 1;
  `)[0] || null;
}

function serializeUser(row) {
  const isLocalDev = row.id === DEFAULT_USER_ID && row.email === "local@chrononote.dev";
  const deletionRequestedAt = row.deletion_requested_at || null;
  const hasGoogle = Boolean(row.google_id);
  const hasPassword = Boolean(row.password_hash);
  return {
    id: row.id,
    email: row.email,
    google_id: row.google_id || null,
    has_google: hasGoogle,
    has_password: hasPassword,
    auth_provider: hasGoogle && hasPassword ? "hybrid" : (hasGoogle ? "google" : (hasPassword ? "password" : "local")),
    is_local_dev: isLocalDev,
    is_autosave_enabled: Boolean(row.is_autosave_enabled),
    github_sync_repo: row.github_sync_repo || "",
    has_github_sync_token: Boolean(row.github_sync_token),
    theme_preference: normalizeTheme(row.theme_preference || "light"),
    deletion_requested_at: deletionRequestedAt,
    session_version: Number(row.session_version || 0),
    terms_version: row.terms_version || null,
    privacy_version: row.privacy_version || null,
    age_confirmed: Boolean(row.age_confirmed_at),
    recover_until: deletionRequestedAt
      ? new Date(Date.parse(deletionRequestedAt) + ACCOUNT_RECOVERY_MS).toISOString()
      : null
  };
}

function normalizeRepo(repo) {
  const value = String(repo || "").trim();
  if (!value) return "";
  if (!REPO_PATTERN.test(value)) {
    throw httpError(400, "GitHub 저장소는 owner/repo 형식이어야 합니다.");
  }
  return value;
}

function normalizeTheme(theme) {
  const value = String(theme || "system").trim();
  if (value === "system" || value === "dark" || value === "light") return value;
  throw httpError(400, "Theme must be system, light, or dark.");
}

function normalizeEmail(email) {
  const clean = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    throw httpError(400, "올바른 이메일을 입력하세요.");
  }
  return clean;
}

function normalizePassword(password) {
  const value = String(password || "");
  if (value.length < 8) {
    throw httpError(400, "비밀번호는 8자 이상이어야 합니다.");
  }
  if (value.length > 200) {
    throw httpError(400, "비밀번호가 너무 깁니다.");
  }
  return value;
}

function normalizeRegistrationConsent(consent) {
  if (!consent?.termsAccepted || !consent?.privacyAccepted || !consent?.ageConfirmed) {
    throw httpError(400, "회원가입에는 이용약관·개인정보 수집 및 이용 동의와 만 14세 이상 확인이 필요합니다.");
  }
  const acceptedAt = consent.acceptedAt ? new Date(consent.acceptedAt) : new Date();
  if (Number.isNaN(acceptedAt.getTime())) {
    throw httpError(400, "약관 동의 시각이 올바르지 않습니다.");
  }
  return { acceptedAt: acceptedAt.toISOString() };
}

function assertUserCapacity(authDb) {
  const row = querySql(authDb, "SELECT COUNT(*) AS count FROM users;")[0];
  if (Number(row?.count || 0) >= MAX_USER_COUNT) {
    throw httpError(503, "현재 신규 가입을 받을 수 없습니다. 운영자에게 문의해주세요.");
  }
}

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function ensurePrivateDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  fs.chmodSync(dirPath, 0o700);
}

function restrictExistingPermissions(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    fs.chmodSync(targetPath, 0o700);
    for (const entry of fs.readdirSync(targetPath)) {
      restrictExistingPermissions(path.join(targetPath, entry));
    }
    return;
  }
  if (stat.isFile()) fs.chmodSync(targetPath, 0o600);
}

function restrictExistingPermissionsOnce(targetPath) {
  const marker = path.join(targetPath, ".chrononote-permissions-v1");
  if (fs.existsSync(marker)) return;
  restrictExistingPermissions(targetPath);
  fs.writeFileSync(marker, "private permissions applied\n", { mode: 0o600 });
}

function ensureAuthColumns(authDb) {
  const columns = querySql(authDb, "PRAGMA table_info(users);").map((column) => column.name);
  if (!columns.includes("theme_preference")) {
    execSql(authDb, "ALTER TABLE users ADD COLUMN theme_preference TEXT DEFAULT 'system';");
  }
  if (!columns.includes("deletion_requested_at")) {
    execSql(authDb, "ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;");
  }
  if (!columns.includes("session_version")) {
    execSql(authDb, "ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;");
  }
  for (const column of [
    "terms_accepted_at", "terms_version", "privacy_accepted_at", "privacy_version", "age_confirmed_at"
  ]) {
    if (!columns.includes(column)) execSql(authDb, `ALTER TABLE users ADD COLUMN ${column} TEXT;`);
  }
}

export function purgeExpiredDeletedUsers({ now = new Date() } = {}) {
  const authDb = path.join(DATA_ROOT, "global_db", "auth.sqlite");
  if (!fs.existsSync(authDb)) return { purged: 0 };
  ensureAuthColumns(authDb);

  const cutoff = new Date(now.getTime() - ACCOUNT_RECOVERY_MS).toISOString();
  const rows = querySql(authDb, `
    SELECT id
    FROM users
    WHERE deletion_requested_at IS NOT NULL
      AND deletion_requested_at <= ${sqlString(cutoff)};
  `);

  for (const row of rows) {
    const userId = row.id;
    assertSafeUserId(userId);
    fs.rmSync(path.join(DATA_ROOT, "users", userId), { recursive: true, force: true });
    execSql(authDb, `DELETE FROM users WHERE id = ${sqlString(userId)};`);
  }

  return { purged: rows.length };
}

function recoverDeletedUser(authDb, userId) {
  execSql(authDb, `
    UPDATE users
    SET deletion_requested_at = NULL
    WHERE id = ${sqlString(userId)};
  `);
}

function initUserDb(userDir) {
  const userDb = path.join(userDir, "personal_index.sqlite");
  execSql(userDb, `
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS memos (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      folder TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0,
      position INTEGER DEFAULT 0,
      title TEXT NOT NULL,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS folders (
      name TEXT PRIMARY KEY,
      icon TEXT DEFAULT '📁',
      position INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memo_tags (
      memo_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY(memo_id, tag_id),
      FOREIGN KEY(memo_id) REFERENCES memos(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);

  ensureMemosColumns(userDb);
  ensureFoldersSchema(userDb);
  ensureFolder(workspaceFromUserDir(userDir), "");
  ensureTrashFolder(workspaceFromUserDir(userDir));
}

function ensureMemosColumns(userDb) {
  const columns = querySql(userDb, "PRAGMA table_info(memos);").map((column) => column.name);
  if (!columns.includes("folder")) {
    execSql(userDb, "ALTER TABLE memos ADD COLUMN folder TEXT DEFAULT '';");
  }
  if (!columns.includes("pinned")) {
    execSql(userDb, "ALTER TABLE memos ADD COLUMN pinned INTEGER DEFAULT 0;");
  }
  if (!columns.includes("position")) {
    execSql(userDb, "ALTER TABLE memos ADD COLUMN position INTEGER DEFAULT 0;");
  }
  if (!columns.includes("trashed_at")) {
    execSql(userDb, "ALTER TABLE memos ADD COLUMN trashed_at TEXT;");
  }
  if (!columns.includes("original_folder")) {
    execSql(userDb, "ALTER TABLE memos ADD COLUMN original_folder TEXT DEFAULT '';");
  }
}

function ensureFoldersSchema(userDb) {
  const columns = querySql(userDb, "PRAGMA table_info(folders);");
  const names = columns.map((column) => column.name);
  const needsMigration = names.includes("id") || names.includes("sort_order") || !names.includes("position") || !names.includes("created_at") || !names.includes("icon");
  if (!needsMigration) return;

  const orderColumn = names.includes("position")
    ? "position"
    : (names.includes("sort_order") ? "sort_order" : "0");
  const createdColumn = names.includes("created_at") ? "created_at" : "datetime('now')";
  const iconColumn = names.includes("icon") ? "icon" : "'📁'";
  const existing = names.includes("name")
    ? querySql(userDb, `
        SELECT
          COALESCE(name, '') AS name,
          MIN(COALESCE(${iconColumn}, '📁')) AS icon,
          MIN(COALESCE(${orderColumn}, 0)) AS position,
          MIN(${createdColumn}) AS created_at
        FROM folders
        GROUP BY COALESCE(name, '')
        ORDER BY position ASC, name COLLATE NOCASE ASC;
      `)
    : [];
  const backupName = `folders_legacy_${Date.now()}`;

  execSql(userDb, `
    ALTER TABLE folders RENAME TO ${backupName};

    CREATE TABLE folders (
      name TEXT PRIMARY KEY,
      icon TEXT DEFAULT '📁',
      position INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  for (const [index, row] of existing.entries()) {
    const name = normalizeFolderName(row.name || "", { allowDefault: true });
    const icon = normalizeFolderIcon(row.icon || "");
    execSql(userDb, `
      INSERT OR IGNORE INTO folders (name, icon, position, created_at)
      VALUES (${sqlString(name)}, ${sqlString(icon)}, ${Number(row.position ?? index)}, ${sqlString(row.created_at || new Date().toISOString())});
    `);
  }

  execSql(userDb, `DROP TABLE ${backupName};`);
}

function workspaceFromUserDir(userDir) {
  return {
    userDir,
    userDb: path.join(userDir, "personal_index.sqlite")
  };
}

function serializeFolder(row) {
  const name = String(row.name || "");
  return {
    name,
    label: name || "기본 폴더",
    icon: normalizeFolderIcon(row.icon || ""),
    position: Number(row.position || 0),
    memo_count: Number(row.memo_count || 0),
    is_default: name === "",
    created_at: row.created_at || null
  };
}

function normalizeFolderName(name, { allowDefault = false } = {}) {
  const clean = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!clean && !allowDefault) {
    throw httpError(400, "폴더 이름을 입력하세요.");
  }
  if (clean.length > 80) {
    throw httpError(400, "폴더 이름은 80자 이하로 입력하세요.");
  }
  if (/[\u0000-\u001f]/.test(clean)) {
    throw httpError(400, "폴더 이름에 제어 문자는 사용할 수 없습니다.");
  }
  return clean;
}

function titleFromFileName(filename) {
  const base = path.basename(String(filename || "memo.txt")).replace(/\.[^.]+$/, "");
  const clean = base.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, 80) || "가져온 메모";
}

function normalizeFolderIcon(icon) {
  const clean = String(icon || "").trim();
  if (!clean) return "📁";
  if (/[\u0000-\u001f]/.test(clean)) {
    throw httpError(400, "폴더 아이콘에 제어 문자는 사용할 수 없습니다.");
  }
  return [...clean][0] || "📁";
}

function ensureFolder(workspace, name, icon) {
  const cleanName = normalizeFolderName(name, { allowDefault: true });
  const cleanIcon = normalizeFolderIcon(icon || "");
  execSql(workspace.userDb, `
    INSERT OR IGNORE INTO folders (name, icon, position, created_at)
    VALUES (
      ${sqlString(cleanName)},
      ${sqlString(cleanIcon)},
      COALESCE((SELECT MAX(position) + 1 FROM folders), 0),
      ${sqlString(new Date().toISOString())}
    );
  `);
}

function ensureTrashFolder(workspace) {
  ensureFolder(workspace, TRASH_FOLDER_NAME, TRASH_FOLDER_ICON);
  execSql(workspace.userDb, `
    UPDATE folders
    SET icon = ${sqlString(TRASH_FOLDER_ICON)}
    WHERE name = ${sqlString(TRASH_FOLDER_NAME)}
      AND (icon IS NULL OR icon = '' OR icon = '📁');
  `);
}

function ensureFoldersFromMemos(workspace) {
  ensureFolder(workspace, "");
  ensureTrashFolder(workspace);
  const rows = querySql(workspace.userDb, `
    SELECT DISTINCT COALESCE(folder, '') AS name
    FROM memos;
  `);

  for (const row of rows) {
    ensureFolder(workspace, row.name || "");
  }
}

function nextMemoPosition(workspace, folder) {
  const cleanFolder = normalizeFolderName(folder, { allowDefault: true });
  const row = querySql(workspace.userDb, `
    SELECT COALESCE(MAX(position), 0) + 1 AS next_position
    FROM memos
    WHERE COALESCE(folder, '') = ${sqlString(cleanFolder)};
  `)[0];
  return Number(row?.next_position || 1);
}

function initGit(userDir) {
  if (fs.existsSync(path.join(userDir, ".git"))) return;

  run("git", ["init", "-b", "master"], { cwd: userDir, allowFail: false });
  runGit(userDir, ["config", "user.email", "local@chrononote.dev"]);
  runGit(userDir, ["config", "user.name", "ChronoNote Local"]);
}

function ensureGitignore(userDir) {
  const gitignorePath = path.join(userDir, ".gitignore");
  const content = [".autosaves/", ".attachments/", "personal_index.sqlite", ".chrononote-permissions-v1", ""].join("\n");

  if (!fs.existsSync(gitignorePath) || fs.readFileSync(gitignorePath, "utf8") !== content) {
    fs.writeFileSync(gitignorePath, content);
    runGit(userDir, ["add", "--", ".gitignore"]);
    commitRaw(userDir, "chore: initialize workspace", ".gitignore", { allowEmpty: false });
  }
}

function syncMemoFromMarkdown(workspace, id, markdown, { relPath } = {}) {
  assertSafeMemoId(id);
  const parsed = parseMarkdown(markdown, { id });
  const memoId = parsed.id || id;
  assertSafeMemoId(memoId);
  const tags = normalizeTags(parsed.tags);
  const trashedAt = parsed.trashed_at || null;
  const originalFolder = normalizeFolderName(parsed.original_folder || "", { allowDefault: true });
  const folder = trashedAt
    ? TRASH_FOLDER_NAME
    : normalizeFolderName(parsed.folder || "", { allowDefault: true });
  ensureFolder(workspace, folder);
  if (folder === TRASH_FOLDER_NAME) ensureTrashFolder(workspace);
  const filePath = relPath || (trashedAt ? trashMemoRelPath(memoId) : memoRelPath(memoId));

  execSql(workspace.userDb, `
    BEGIN;

    INSERT INTO memos (id, file_path, folder, pinned, position, trashed_at, original_folder, title, content, created_at, updated_at)
    VALUES (
      ${sqlString(memoId)},
      ${sqlString(`/${filePath}`)},
      ${sqlString(folder)},
      ${parsed.pinned ? 1 : 0},
      ${Number(parsed.position || 0)},
      ${sqlString(trashedAt)},
      ${sqlString(originalFolder)},
      ${sqlString(parsed.title)},
      ${sqlString(parsed.content)},
      ${sqlString(parsed.created_at)},
      ${sqlString(parsed.updated_at)}
    )
    ON CONFLICT(id) DO UPDATE SET
      file_path = excluded.file_path,
      folder = excluded.folder,
      pinned = excluded.pinned,
      position = excluded.position,
      trashed_at = excluded.trashed_at,
      original_folder = excluded.original_folder,
      title = excluded.title,
      content = excluded.content,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;

    DELETE FROM memo_tags WHERE memo_id = ${sqlString(memoId)};
    COMMIT;
  `);

  for (const tag of tags) {
    execSql(workspace.userDb, `
      INSERT OR IGNORE INTO tags (id, name)
      VALUES (${sqlString(randomUUID())}, ${sqlString(tag)});

      INSERT OR IGNORE INTO memo_tags (memo_id, tag_id)
      SELECT ${sqlString(memoId)}, id FROM tags WHERE name = ${sqlString(tag)};
    `);
  }
}

function coerceMarkdown({ id, markdown, title, tags, folder, pinned, content, fallback, touchUpdatedAt }) {
  if (markdown) {
    const parsed = parseMarkdown(markdown, fallback);
    const cleanFolder = normalizeFolderName(parsed.folder || "", { allowDefault: true });
    return buildMarkdown({
      ...parsed,
      id,
      folder: cleanFolder,
      trashed_at: parsed.trashed_at || null,
      original_folder: parsed.original_folder || "",
      updated_at: touchUpdatedAt ? new Date().toISOString() : parsed.updated_at
    });
  }

  const cleanFolder = normalizeFolderName(folder ?? fallback.folder, { allowDefault: true });
  const trashedAt = fallback.trashed_at || null;
  return buildMarkdown({
    id,
    title: title ?? fallback.title,
    tags: tags ?? fallback.tags,
    folder: trashedAt ? TRASH_FOLDER_NAME : cleanFolder,
    pinned: pinned ?? fallback.pinned,
    position: fallback.position,
    deleted_commits: fallback.deleted_commits,
    trashed_at: trashedAt,
    original_folder: fallback.original_folder || "",
    created_at: fallback.created_at,
    updated_at: touchUpdatedAt ? new Date().toISOString() : fallback.updated_at,
    content: content ?? fallback.content
  });
}

function commitMemoFile(workspace, id, message) {
  const relPath = currentMemoRelPath(workspace, id);
  runGit(workspace.userDir, ["add", "--", relPath]);
  return commitRaw(workspace.userDir, message, relPath, { allowEmpty: false });
}

function memoRelPathAtCommit(workspace, id, commit) {
  for (const relPath of [currentMemoRelPath(workspace, id), memoRelPath(id), trashMemoRelPath(id)]) {
    const result = spawnSync("git", ["cat-file", "-e", `${commit}:${relPath}`], {
      cwd: workspace.userDir,
      encoding: "utf8"
    });
    if (result.status === 0) return relPath;
  }
  throw httpError(404, "이 커밋에서 메모 파일을 찾을 수 없습니다.");
}

function hardDeleteGitCommit(workspace, commit, relPath) {
  const userDir = workspace.userDir;
  const fullHash = resolveCommit(userDir, commit);
  const relPaths = Array.isArray(relPath) ? relPath : [relPath];

  const touchedPaths = runGit(userDir, ["show", "--name-only", "--format=", fullHash])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (!relPaths.some((pathName) => touchedPaths.includes(pathName))) {
    throw httpError(404, "이 커밋은 현재 메모의 히스토리가 아닙니다.");
  }

  const status = runGit(userDir, ["status", "--porcelain"]).trim();
  if (status) {
    throw httpError(409, "저장되지 않은 Git 변경사항이 있어 커밋을 삭제할 수 없습니다.");
  }

  const branch = runGit(userDir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (!branch || branch === "HEAD") {
    throw httpError(409, "현재 브랜치 상태에서는 커밋을 삭제할 수 없습니다.");
  }

  const parents = runGit(userDir, ["rev-list", "--parents", "-n", "1", fullHash]).trim().split(/\s+/);
  if (parents.length < 2) {
    throw httpError(409, "첫 커밋은 하드 삭제할 수 없습니다.");
  }
  if (parents.length > 2) {
    throw httpError(409, "병합 커밋은 하드 삭제할 수 없습니다.");
  }

  const result = spawnSync("git", ["rebase", "--onto", parents[1], fullHash, branch], {
    cwd: userDir,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    spawnSync("git", ["rebase", "--abort"], {
      cwd: userDir,
      encoding: "utf8"
    });
    const message = `${result.stderr || ""}${result.stdout || ""}`.trim();
    throw httpError(409, message || "커밋 삭제 중 충돌이 발생했습니다.");
  }

  runGit(userDir, ["update-ref", "-d", "ORIG_HEAD"], { allowFail: true });
  runGit(userDir, ["reflog", "expire", "--expire=now", "--expire-unreachable=now", "--all"]);
  runGit(userDir, ["gc", "--prune=now"]);
}

function resolveCommit(userDir, commit) {
  const result = spawnSync("git", ["rev-parse", "--verify", `${commit}^{commit}`], {
    cwd: userDir,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw httpError(404, "Commit not found.");
  }
  return result.stdout.trim();
}

function commitRaw(userDir, message, relPath, { allowEmpty = false } = {}) {
  const relPaths = Array.isArray(relPath) ? relPath : (relPath ? [relPath] : []);
  const diffArgs = relPaths.length
    ? ["diff", "--cached", "--quiet", "--", ...relPaths]
    : ["diff", "--cached", "--quiet"];
  const diff = spawnSync("git", diffArgs, { cwd: userDir, encoding: "utf8" });

  if (diff.status === 0 && !allowEmpty) {
    return { committed: false, hash: null };
  }

  const commitArgs = ["commit", "-m", message];
  if (relPaths.length) commitArgs.push("--", ...relPaths);
  runGit(userDir, commitArgs);
  const hash = runGit(userDir, ["rev-parse", "HEAD"]).trim();
  return { committed: true, hash };
}

function memoRelPath(id) {
  assertSafeMemoId(id);
  return `memos/${id}.md`;
}

function trashMemoRelPath(id) {
  assertSafeMemoId(id);
  return `trash/${id}.md`;
}

function memoPath(workspace, id) {
  return path.join(workspace.memosDir, `${id}.md`);
}

function trashMemoPath(workspace, id) {
  return path.join(workspace.trashDir, `${id}.md`);
}

function currentMemoPath(workspace, id) {
  const activePath = memoPath(workspace, id);
  if (fs.existsSync(activePath)) return activePath;
  return trashMemoPath(workspace, id);
}

function currentMemoRelPath(workspace, id) {
  return fs.existsSync(memoPath(workspace, id)) ? memoRelPath(id) : trashMemoRelPath(id);
}

function memoFileExists(workspace, id) {
  return fs.existsSync(memoPath(workspace, id)) || fs.existsSync(trashMemoPath(workspace, id));
}

function autosaveMemoPath(workspace, id) {
  assertSafeMemoId(id);
  return path.join(workspace.autosavesDir, `${id}.md`);
}

function assertSafeUserId(userId) {
  if (!MEMO_ID_PATTERN.test(String(userId || ""))) {
    throw httpError(400, "Invalid user id.");
  }
}

function assertSafeMemoId(id) {
  if (!MEMO_ID_PATTERN.test(String(id || ""))) {
    throw httpError(400, "Invalid memo id.");
  }
}

function parseDataUrl(data) {
  const value = String(data || "");
  const match = /^data:([^;]+);base64,(.+)$/.exec(value);
  if (!match) {
    return {
      mime: "application/octet-stream",
      buffer: Buffer.from(value, "base64")
    };
  }

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

async function prepareAttachment({ buffer, filename, declaredMime }) {
  const detected = detectAttachment(buffer, filename, declaredMime);
  if (detected.kind === "svg") {
    return {
      ext: ".svg",
      mediaType: "image",
      buffer: Buffer.from(sanitizeSvg(buffer.toString("utf8")), "utf8")
    };
  }

  if (detected.animated) {
    return {
      ext: ".mp4",
      mediaType: "video",
      buffer: await convertAnimatedToMp4(buffer, detected.ext)
    };
  }

  if (detected.kind === "raster") {
    return {
      ext: ".webp",
      mediaType: "image",
      buffer: await convertRasterToWebp(buffer)
    };
  }

  throw httpError(415, "지원하지 않는 첨부파일 형식입니다.");
}

function detectAttachment(buffer, filename, declaredMime = "") {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw httpError(400, "첨부파일 데이터가 비어 있습니다.");
  }

  const ext = path.extname(String(filename || "")).toLowerCase();
  const mime = String(declaredMime || "").toLowerCase();
  const prefix = buffer.subarray(0, 32);

  if (isSvgBuffer(buffer) || mime === "image/svg+xml" || ext === ".svg") {
    if (!isSvgBuffer(buffer)) throw httpError(415, "SVG 파일 내용이 올바르지 않습니다.");
    return { kind: "svg", mime: "image/svg+xml", ext: ".svg", animated: false };
  }
  if (prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return { kind: "raster", mime: "image/jpeg", ext: ".jpg", animated: false };
  }
  if (prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: "raster", mime: "image/png", ext: ".png", animated: hasPngChunk(buffer, "acTL") };
  }
  if (prefix.subarray(0, 6).toString("ascii") === "GIF87a" || prefix.subarray(0, 6).toString("ascii") === "GIF89a") {
    return { kind: "raster", mime: "image/gif", ext: ".gif", animated: true };
  }
  if (prefix.subarray(0, 4).toString("ascii") === "RIFF" && prefix.subarray(8, 12).toString("ascii") === "WEBP") {
    return { kind: "raster", mime: "image/webp", ext: ".webp", animated: buffer.includes(Buffer.from("ANIM")) };
  }

  throw httpError(415, "지원하지 않는 첨부파일 형식입니다.");
}

function isSvgBuffer(buffer) {
  const text = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  return /^<\?xml[\s\S]*<svg[\s>]/i.test(text) || /^<svg[\s>]/i.test(text);
}

function hasPngChunk(buffer, chunkName) {
  const needle = Buffer.from(chunkName, "ascii");
  for (let offset = 8; offset + 8 < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    if (buffer.subarray(typeStart, typeStart + 4).equals(needle)) return true;
    offset += 12 + length;
  }
  return false;
}

async function convertRasterToWebp(buffer) {
  try {
    return await sharp(buffer, { animated: false, limitInputPixels: 90_000_000 })
      .rotate()
      .resize({
        width: IMAGE_MAX_DIMENSION,
        height: IMAGE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 88, effort: 5 })
      .toBuffer();
  } catch {
    throw httpError(415, "이미지 변환에 실패했습니다.");
  }
}

async function convertAnimatedToMp4(buffer, ext) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chrononote-media-"));
  const inputPath = path.join(tempDir, `input${ext}`);
  const outputPath = path.join(tempDir, "output.mp4");
  try {
    fs.writeFileSync(inputPath, buffer);
    await runAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-an",
      "-vf",
      `fps=30,scale=${IMAGE_MAX_DIMENSION}:${IMAGE_MAX_DIMENSION}:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p`,
      "-movflags",
      "+faststart",
      outputPath
    ], {
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    });
    if (!fs.existsSync(outputPath)) throw httpError(415, "움직이는 이미지 변환에 실패했습니다.");
    return fs.readFileSync(outputPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function sanitizeSvg(svg) {
  const clean = sanitizeHtml(String(svg || ""), {
    parser: {
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
      xmlMode: true
    },
    allowedTags: [
      "svg", "g", "defs", "symbol", "use", "title", "desc",
      "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
      "text", "tspan", "linearGradient", "radialGradient", "stop", "clipPath", "mask"
    ],
    allowedAttributes: {
      "*": [
        "id", "class", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry",
        "d", "points", "width", "height", "viewBox", "fill", "stroke", "stroke-width",
        "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity",
        "stroke-opacity", "transform", "gradientUnits", "offset", "stop-color", "stop-opacity",
        "clip-path", "mask", "font-size", "font-family", "font-weight", "text-anchor",
        "dominant-baseline", "xmlns"
      ],
      use: ["href", "xlink:href"]
    },
    allowedSchemes: [],
    allowedSchemesByTag: {},
    allowProtocolRelative: false,
    disallowedTagsMode: "discard"
  });
  return clean
    .replace(/\s(?:on[a-z]+|href|xlink:href)\s*=\s*(['"])\s*(?:javascript:|data:|https?:)[\s\S]*?\1/gi, "")
    .replace(/<\s*(?:script|foreignObject|iframe|object|embed)[\s\S]*?>[\s\S]*?<\s*\/\s*(?:script|foreignObject|iframe|object|embed)\s*>/gi, "");
}

function embedMarkdown({ label, path: markdownPath, mediaType }) {
  const safeLabel = String(label || "attachment").replace(/[\[\]\n\r]/g, " ").trim() || "attachment";
  if (mediaType === "video") {
    return `<video src="${markdownPath}" autoplay loop muted playsinline controls></video>`;
  }
  return `![${safeLabel}](${markdownPath})`;
}

function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptSecret(value) {
  const [version, iv, tag, encrypted] = String(value || "").split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw httpError(500, "Stored GitHub token is not decryptable.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function directorySize(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;

  return fs.readdirSync(target, { withFileTypes: true }).reduce((total, entry) => {
    return total + directorySize(path.join(target, entry.name));
  }, 0);
}

function workspaceUsageBytes(workspace, { refresh = false } = {}) {
  const cached = WORKSPACE_USAGE_CACHE.get(workspace.userDir);
  if (!refresh && cached && cached.measured_at + WORKSPACE_USAGE_CACHE_TTL_MS > Date.now()) {
    return cached.used_bytes;
  }
  const usedBytes = directorySize(workspace.userDir);
  WORKSPACE_USAGE_CACHE.set(workspace.userDir, {
    used_bytes: usedBytes,
    measured_at: Date.now()
  });
  return usedBytes;
}

function assertWorkspaceCapacity(workspace, additionalBytes = 0) {
  const incoming = Math.max(0, Number(additionalBytes || 0));
  const usedBytes = workspaceUsageBytes(workspace);
  if (usedBytes + incoming > WORKSPACE_QUOTA_BYTES) {
    throw httpError(413, `작업공간 용량 한도(${formatByteLimit(WORKSPACE_QUOTA_BYTES)})를 초과합니다.`);
  }
}

function reserveWorkspaceWrite(workspace, targetPath, value, { historyCopy = false } = {}) {
  const nextBytes = Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value ?? ""), "utf8");
  const currentBytes = fs.existsSync(targetPath) ? fs.statSync(targetPath).size : 0;
  const fileGrowth = Math.max(0, nextBytes - currentBytes);
  const historyGrowth = historyCopy ? nextBytes : 0;
  const additionalBytes = fileGrowth + historyGrowth;
  assertWorkspaceCapacity(workspace, additionalBytes);

  const cached = WORKSPACE_USAGE_CACHE.get(workspace.userDir);
  if (cached) cached.used_bytes += additionalBytes;
}

function formatByteLimit(bytes) {
  const mib = Math.round(Number(bytes || 0) / 1024 / 1024);
  return `${mib}MB`;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const derived = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:v1:${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, version, salt, derived] = String(storedHash || "").split(":");
  if (algorithm !== "scrypt" || version !== "v1" || !salt || !derived) return false;

  const expected = Buffer.from(derived, "base64url");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function encryptionKey() {
  return createHash("sha256")
    .update(process.env.CHRONONOTE_SECRET || "chrononote-local-dev-secret")
    .digest();
}

function sanitizeGitOutput(output, redactions = []) {
  return [redactions].flat().filter(Boolean).reduce((clean, secret) => {
    return clean.replaceAll(String(secret), "[redacted]");
  }, String(output || ""));
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function execSql(dbPath, sql) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(sql);
  } catch (error) {
    throw httpError(500, error.message);
  } finally {
    db.close();
  }
}

function querySql(dbPath, sql) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { readonly: false });
  try {
    return db.prepare(sql).all();
  } catch (error) {
    throw httpError(500, error.message);
  } finally {
    db.close();
  }
}

function runGit(cwd, args, options = {}) {
  return run("git", args, { cwd, ...options });
}

function runGitAsync(cwd, args, options = {}) {
  return runAsync("git", args, { cwd, ...options });
}

async function runAsync(command, args, {
  cwd = process.cwd(),
  timeout = 60_000,
  maxBuffer = 4 * 1024 * 1024,
  redactions = []
} = {}) {
  try {
    const { stdout = "", stderr = "" } = await execFileAsync(command, args, {
      cwd,
      encoding: "utf8",
      timeout,
      maxBuffer,
      windowsHide: true
    });
    return sanitizeGitOutput(`${stdout}${stderr}`, redactions);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw httpError(501, `${command} 실행 파일을 찾을 수 없습니다.`);
    }
    const message = error?.stderr || error?.stdout || error?.message || `${command} 실행에 실패했습니다.`;
    throw httpError(500, sanitizeGitOutput(String(message).trim(), redactions));
  }
}

function run(command, args, { cwd = process.cwd(), allowFail = false, redactions = [] } = {}) {
  try {
    return sanitizeGitOutput(execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }), redactions);
  } catch (error) {
    if (allowFail) {
      return sanitizeGitOutput(`${error.stdout || ""}${error.stderr || ""}`, redactions);
    }
    const message = error.stderr || error.stdout || error.message;
    throw httpError(500, sanitizeGitOutput(message.trim(), redactions));
  }
}
