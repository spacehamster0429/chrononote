import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRuntimeSecrets,
  createSessionToken,
  csrfTokenForSession,
  secureCookiesEnabled,
  sessionCookie,
  verifyCsrfToken,
  verifySessionToken
} from "../src/auth.js";

test("JWT session tokens verify and expose user id", () => {
  const token = createSessionToken("user-00000001", 3);
  const payload = verifySessionToken(token);

  assert.equal(payload.sub, "user-00000001");
  assert.equal(payload.ver, 3);
  assert.ok(payload.exp > payload.iat);
});

test("JWT verification rejects a tampered token", () => {
  const token = createSessionToken("user-00000001");
  const tampered = token.replace(/.$/, "x");

  assert.equal(verifySessionToken(tampered), null);
});

test("CSRF token is bound to the session token", () => {
  const token = createSessionToken("user-00000001");
  const csrf = csrfTokenForSession(token);

  assert.equal(verifyCsrfToken(token, csrf), true);
  assert.equal(verifyCsrfToken(token, `${csrf}x`), false);
});

test("public runtime rejects placeholder secrets", () => {
  const previousSecret = process.env.CHRONONOTE_SECRET;
  const previousJwtSecret = process.env.CHRONONOTE_JWT_SECRET;
  process.env.CHRONONOTE_SECRET = "replace-with-a-long-random-secret";
  process.env.CHRONONOTE_JWT_SECRET = "replace-with-a-long-random-jwt-secret";
  try {
    assert.throws(() => assertRuntimeSecrets({ host: "0.0.0.0", nodeEnv: "" }), /CHRONONOTE_SECRET/);
    assert.doesNotThrow(() => assertRuntimeSecrets({ host: "127.0.0.1", nodeEnv: "" }));
  } finally {
    restoreEnv("CHRONONOTE_SECRET", previousSecret);
    restoreEnv("CHRONONOTE_JWT_SECRET", previousJwtSecret);
  }
});

test("secure cookie flag follows production or explicit preference", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSecure = process.env.CHRONONOTE_SECURE_COOKIES;
  process.env.NODE_ENV = "production";
  delete process.env.CHRONONOTE_SECURE_COOKIES;
  try {
    assert.equal(secureCookiesEnabled(), true);
    assert.match(sessionCookie(createSessionToken("user-00000001")), /;\sSecure/);
    process.env.CHRONONOTE_SECURE_COOKIES = "false";
    assert.equal(secureCookiesEnabled(), false);
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    restoreEnv("CHRONONOTE_SECURE_COOKIES", previousSecure);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
