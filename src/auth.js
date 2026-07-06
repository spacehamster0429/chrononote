import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DEFAULT_SECRET = "chrononote-local-dev-secret";
const PLACEHOLDER_SECRETS = new Set([
  "",
  DEFAULT_SECRET,
  "change-me",
  "replace-with-a-long-random-secret",
  "replace-with-a-long-random-jwt-secret"
]);
const JWT_SECRET = process.env.CHRONONOTE_JWT_SECRET || process.env.CHRONONOTE_SECRET || DEFAULT_SECRET;
const SESSION_COOKIE = "chrononote_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function createSessionToken(userId, sessionVersion = 0) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: userId,
    ver: Number(sessionVersion) || 0,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    nonce: randomBytes(8).toString("hex")
  });
}

export function readSessionToken(request) {
  const auth = request.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();

  const cookies = parseCookies(request.headers.cookie || "");
  return cookies[SESSION_COOKIE] || "";
}

export function verifySessionToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = sign(`${encodedHeader}.${encodedPayload}`);

  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return cookieParts(`${SESSION_COOKIE}=${token}`, SESSION_TTL_SECONDS).join("; ");
}

export function clearSessionCookie() {
  return cookieParts(`${SESSION_COOKIE}=`, 0).join("; ");
}

export function csrfTokenForSession(token) {
  if (!token) return "";
  return sign(`csrf:${token}`);
}

export function verifyCsrfToken(sessionToken, csrfToken) {
  const expected = csrfTokenForSession(sessionToken);
  return Boolean(csrfToken && safeEqual(String(csrfToken), expected));
}

export function assertRuntimeSecrets({ host = process.env.HOST || "0.0.0.0", nodeEnv = process.env.NODE_ENV || "" } = {}) {
  if (!isPublicRuntime({ host, nodeEnv })) return;

  const weakSecrets = [];
  if (isWeakSecret(process.env.CHRONONOTE_SECRET)) weakSecrets.push("CHRONONOTE_SECRET");
  if (isWeakSecret(process.env.CHRONONOTE_JWT_SECRET)) weakSecrets.push("CHRONONOTE_JWT_SECRET");
  if (weakSecrets.length) {
    throw new Error(`${weakSecrets.join(", ")} must be long, unique values before running ChronoNote publicly.`);
  }
}

export function secureCookiesEnabled() {
  const preference = String(process.env.CHRONONOTE_SECURE_COOKIES || "auto").toLowerCase();
  if (preference === "true" || preference === "1") return true;
  if (preference === "false" || preference === "0") return false;
  return process.env.NODE_ENV === "production";
}

export function isPublicRuntime({ host = process.env.HOST || "0.0.0.0", nodeEnv = process.env.NODE_ENV || "" } = {}) {
  const cleanHost = String(host || "").toLowerCase();
  return nodeEnv === "production" || (cleanHost && cleanHost !== "127.0.0.1" && cleanHost !== "localhost" && cleanHost !== "::1");
}

export function isWeakSecret(value) {
  const secret = String(value || "");
  return PLACEHOLDER_SECRETS.has(secret) || secret.length < 32;
}

function cookieParts(value, maxAge) {
  const parts = [
    value,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
  if (secureCookiesEnabled()) parts.push("Secure");
  return parts;
}

export function googleOAuthAvailable() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

export function googleAuthUrl(state) {
  if (!googleOAuthAvailable()) return null;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGoogleCode(code) {
  if (!googleOAuthAvailable()) {
    const error = new Error("Google OAuth 환경변수가 설정되지 않았습니다.");
    error.status = 400;
    throw error;
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });

  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok) {
    const error = new Error(tokenPayload.error_description || tokenPayload.error || "Google token exchange failed.");
    error.status = 400;
    throw error;
  }

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` }
  });
  const profile = await profileResponse.json();
  if (!profileResponse.ok) {
    const error = new Error(profile.error_description || profile.error || "Google profile request failed.");
    error.status = 400;
    throw error;
  }
  if (profile.email_verified === false) {
    const error = new Error("Google 계정의 이메일 인증이 필요합니다.");
    error.status = 403;
    throw error;
  }

  return {
    googleId: profile.sub,
    email: profile.email,
    name: profile.name || profile.email,
    picture: profile.picture || null
  };
}

function signJwt(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function sign(value) {
  return createHmac("sha256", JWT_SECRET).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}
