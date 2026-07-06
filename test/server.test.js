import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("HTTP security, registration, and logout session revocation work end to end", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chrononote-server-test-"));
  const port = await availablePort();
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      CHRONONOTE_DATA_DIR: dataRoot,
      CHRONONOTE_SECRET: "server-test-secret-0123456789abcdef",
      CHRONONOTE_JWT_SECRET: "server-test-jwt-secret-0123456789abcdef",
      CHRONONOTE_SECURE_COOKIES: "false",
      CHRONONOTE_AUTO_COMPACT: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });

  try {
    await waitForServer(port, child, () => logs);
    const base = `http://127.0.0.1:${port}`;

    const methodResponse = await fetch(base, { method: "POST" });
    assert.equal(methodResponse.status, 405);
    assert.equal(methodResponse.headers.get("allow"), "GET, HEAD");

    const headResponse = await fetch(base, { method: "HEAD" });
    assert.equal(headResponse.status, 200);
    assert.equal(await headResponse.text(), "");

    const malformed = await rawRequest(port, "/%E0%A4%A");
    assert.equal(malformed.status, 400);

    const missingConsentResponse = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "integration@example.com",
        password: "password-1234",
        password_confirm: "password-1234"
      })
    });
    assert.equal(missingConsentResponse.status, 400);

    const registerResponse = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "integration@example.com",
        password: "password-1234",
        password_confirm: "password-1234",
        terms_accepted: true,
        privacy_accepted: true,
        age_confirmed: true
      })
    });
    assert.equal(registerResponse.status, 201);
    const registered = await registerResponse.json();
    const cookie = registerResponse.headers.get("set-cookie").split(";", 1)[0];
    assert.ok(registered.csrf_token);

    const authenticated = await fetch(`${base}/api/session`, { headers: { Cookie: cookie } });
    assert.equal((await authenticated.json()).authenticated, true);

    const logoutResponse = await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-CSRF-Token": registered.csrf_token
      }
    });
    assert.equal(logoutResponse.status, 200);

    const revoked = await fetch(`${base}/api/session`, { headers: { Cookie: cookie } });
    assert.equal((await revoked.json()).authenticated, false);

    const termsResponse = await fetch(`${base}/terms`);
    assert.equal(termsResponse.status, 200);
    assert.match(await termsResponse.text(), /ChronoNote 이용약관/);
    const privacyResponse = await fetch(`${base}/privacy/`);
    assert.equal(privacyResponse.status, 200);
    assert.match(await privacyResponse.text(), /개인정보 처리방침/);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(port, child, readLogs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early\n${readLogs()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/session`);
      if (response.ok) return;
    } catch {
      // The listening socket may not be ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not become ready\n${readLogs()}`);
}

function rawRequest(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: requestPath,
      method: "GET"
    }, (response) => {
      response.resume();
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers }));
    });
    request.once("error", reject);
    request.end();
  });
}
