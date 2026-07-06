import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("workspace uses markdown as source, sqlite as index, and git as file history", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chrononote-test-"));
  process.env.CHRONONOTE_DATA_DIR = dataRoot;
  const storage = await import(`../src/storage.js?test=${Date.now()}`);
  const userId = "test-user-0001";
  const consent = {
    termsAccepted: true,
    privacyAccepted: true,
    ageConfirmed: true,
    acceptedAt: "2026-07-06T00:00:00.000Z"
  };

  try {
    storage.ensureWorkspace({ userId, seed: false });
    const created = storage.createMemo({
      userId,
      title: "Alpha",
      tags: ["draft"],
      folder: "Inbox",
      content: "original body"
    });
    const beta = storage.createMemo({
      userId,
      title: "Beta",
      tags: ["draft"],
      folder: "Inbox",
      content: "second memo"
    });

    storage.createFolder({ userId, name: "Archive", icon: "🗃️" });
    let folders = storage.listFolders({ userId });
    assert.deepEqual(folders.map((folder) => folder.name), ["", storage.TRASH_FOLDER_NAME, "Inbox", "Archive"]);
    assert.equal(folders.find((folder) => folder.name === "Archive").icon, "🗃");

    storage.moveFolder({ userId, name: "Archive", direction: "up" });
    folders = storage.listFolders({ userId });
    assert.deepEqual(folders.map((folder) => folder.name), ["", storage.TRASH_FOLDER_NAME, "Archive", "Inbox"]);

    storage.reorderFolders({ userId, names: ["Inbox", "Archive", "", storage.TRASH_FOLDER_NAME] });
    folders = storage.listFolders({ userId });
    assert.deepEqual(folders.map((folder) => folder.name), ["Inbox", "Archive", "", storage.TRASH_FOLDER_NAME]);

    storage.updateFolderIcon({ userId, name: "Inbox", icon: "📌" });
    folders = storage.listFolders({ userId });
    assert.equal(folders.find((folder) => folder.name === "Inbox").icon, "📌");

    storage.reorderMemos({
      userId,
      groups: [{ folder: "Inbox", memoIds: [beta.id, created.id] }]
    });
    const inboxMemos = storage.listMemos({ userId })
      .filter((memo) => memo.folder === "Inbox")
      .map((memo) => memo.id);
    assert.deepEqual(inboxMemos, [beta.id, created.id]);
    assert.equal(storage.readMemo({ userId, id: created.id }).position, 2);

    const deletedFolder = storage.deleteFolder({ userId, name: "Inbox" });
    assert.equal(deletedFolder.moved_count, 2);
    assert.equal(storage.listFolders({ userId }).some((folder) => folder.name === "Inbox"), false);
    assert.equal(storage.readMemo({ userId, id: created.id }).folder, "");
    assert.equal(storage.readMemo({ userId, id: beta.id }).folder, "");

    storage.autosaveMemo({
      userId,
      id: created.id,
      title: "Alpha draft",
      tags: ["draft", "search"],
      content: "autosaved searchable body"
    });

    const indexed = storage.listMemos({ userId, search: "searchable" });
    assert.equal(indexed.length, 1);
    assert.equal(indexed[0].title, "Alpha draft");
    assert.ok(storage.listMemos({ userId, search: "search" }).some((memo) => memo.id === created.id));
    assert.deepEqual(storage.listTags({ userId }).map((tag) => tag.name), ["draft", "search"]);

    const withAutosave = storage.readMemo({ userId, id: created.id });
    assert.equal(withAutosave.has_autosave, true);
    assert.equal(withAutosave.content, "original body");
    assert.equal(withAutosave.autosave.content, "autosaved searchable body");

    const pinned = storage.updateMemoPin({ userId, id: created.id, pinned: true });
    assert.equal(pinned.pinned, true);
    assert.equal(storage.listMemos({ userId }).find((memo) => memo.id === created.id).pinned, true);

    const saved = storage.commitMemo({ userId, id: created.id });
    assert.equal(saved.memo.has_autosave, false);
    assert.equal(saved.memo.content, "autosaved searchable body");
    assert.equal(saved.memo.pinned, true);

    const imported = storage.importTextFiles({
      userId,
      files: [
        { name: "plain.txt", content: "plain text body" },
        { name: "frontmatter.md", content: "---\ntitle: \"Imported MD\"\ntags: [import]\n---\nmarkdown body" }
      ]
    });
    assert.equal(imported.count, 2);
    assert.equal(imported.memos[0].title, "plain");
    assert.equal(imported.memos[1].title, "Imported MD");

    storage.commitMemo({
      userId,
      id: created.id,
      title: "Alpha changed",
      tags: ["changed"],
      content: "second version"
    });

    const history = storage.memoHistory({ userId, id: created.id });
    assert.ok(history.length >= 3);

    const oldest = history.at(-1);
    const oldestVersion = storage.readMemoHistoryVersion({ userId, id: created.id, commit: oldest.hash });
    assert.equal(oldestVersion.commit.hash, oldest.hash);
    assert.match(oldestVersion.markdown, /original body/);
    const restored = storage.restoreMemo({ userId, id: created.id, commit: oldest.hash });
    assert.equal(restored.memo.content, "original body");

    const deletedHistory = storage.deleteMemoHistory({
      userId,
      id: created.id,
      commit: restored.commit.hash
    });
    assert.equal(deletedHistory.ok, true);
    assert.equal(
      storage.memoHistory({ userId, id: created.id }).some((item) => item.hash === restored.commit.hash),
      false
    );
    assert.throws(() => {
      execFileSync("git", ["cat-file", "-e", `${restored.commit.hash}^{commit}`], {
        cwd: storage.getWorkspace(userId).userDir,
        stdio: "ignore"
      });
    });

    storage.autosaveMemo({
      userId,
      id: beta.id,
      title: "Beta export draft",
      content: "this recovery draft must survive export"
    });
    const betaAutosavePath = path.join(storage.getWorkspace(userId).autosavesDir, `${beta.id}.md`);
    assert.equal(fs.existsSync(betaAutosavePath), true);
    const archivePath = await storage.exportArchive({ userId });
    assert.equal(fs.existsSync(archivePath), true);
    assert.equal(fs.existsSync(betaAutosavePath), true, "ZIP export must not delete recovery drafts");
    fs.rmSync(archivePath, { force: true });

    const compacted = await storage.compactWorkspace({ userId });
    assert.equal(compacted.ok, true);

    const settings = storage.updateUserSettings({
      userId,
      is_autosave_enabled: false,
      github_sync_repo: "octo-org/chrononote-backup",
      github_sync_token: "ghp_example_token",
      theme_preference: "dark"
    });
    assert.equal(settings.is_autosave_enabled, false);
    assert.equal(settings.github_sync_repo, "octo-org/chrononote-backup");
    assert.equal(settings.has_github_sync_token, true);
    assert.equal(settings.theme_preference, "dark");
    assert.equal(storage.isAutosaveEnabled(userId), false);

    const systemTheme = storage.updateUserSettings({
      userId,
      theme_preference: "system"
    });
    assert.equal(systemTheme.theme_preference, "system");

    const passwordUser = storage.createPasswordUser({
      email: "member@example.com",
      password: "password-1234",
      consent
    });
    assert.equal(passwordUser.email, "member@example.com");
    assert.equal(passwordUser.auth_provider, "password");
    assert.equal(passwordUser.has_password, true);
    assert.equal(passwordUser.terms_version, storage.TERMS_VERSION);
    assert.equal(passwordUser.privacy_version, storage.PRIVACY_VERSION);
    assert.equal(passwordUser.age_confirmed, true);
    assert.throws(
      () => storage.createPasswordUser({ email: "no-consent@example.com", password: "password-1234" }),
      /약관/
    );
    assert.equal(storage.getEmailAvailability("new-member@example.com").available, true);
    assert.equal(storage.getEmailAvailability("member@example.com").available, false);

    const loggedIn = storage.authenticatePasswordUser({
      email: "member@example.com",
      password: "password-1234"
    });
    assert.equal(loggedIn.id, passwordUser.id);
    assert.throws(
      () => storage.findOrCreateGoogleUser({
        email: "member@example.com",
        googleId: "google-pre-registration-collision"
      }),
      /이메일로 로그인한 뒤/
    );
    assert.throws(
      () => storage.authenticatePasswordUser({ email: "member@example.com", password: "wrong-pass" }),
      /올바르지/
    );

    assert.throws(
      () => storage.findOrCreateGoogleUser({
        email: "not-registered-google@example.com",
        googleId: "google-login-without-registration"
      }),
      /회원가입 화면/
    );

    const googleUser = storage.findOrCreateGoogleUser({
      email: "google@example.com",
      googleId: "google-user-1",
      allowCreate: true,
      consent
    });
    assert.equal(googleUser.auth_provider, "google");
    assert.equal(googleUser.has_google, true);
    assert.equal(googleUser.has_password, false);

    const googleWithPassword = storage.setAccountPassword({
      userId: googleUser.id,
      password: "password-1234"
    });
    assert.equal(googleWithPassword.auth_provider, "hybrid");
    assert.equal(googleWithPassword.has_password, true);
    const googlePasswordLogin = storage.authenticatePasswordUser({
      email: "google@example.com",
      password: "password-1234"
    });
    assert.equal(googlePasswordLogin.id, googleUser.id);

    const linkedPasswordUser = storage.linkGoogleUser({
      userId: passwordUser.id,
      email: "member@example.com",
      googleId: "google-user-2"
    });
    assert.equal(linkedPasswordUser.auth_provider, "hybrid");
    assert.equal(linkedPasswordUser.has_google, true);
    const googleLoginToLinkedUser = storage.findOrCreateGoogleUser({
      email: "member@example.com",
      googleId: "google-user-2"
    });
    assert.equal(googleLoginToLinkedUser.id, passwordUser.id);
    const sessionVersion = storage.getUserById(passwordUser.id).session_version;
    assert.equal(storage.revokeUserSessions(passwordUser.id), true);
    assert.equal(storage.getUserById(passwordUser.id).session_version, sessionVersion + 1);
    assert.throws(
      () => storage.linkGoogleUser({
        userId,
        email: "other@example.com",
        googleId: "google-user-2"
      }),
      /이미 다른 작업공간/
    );

    const deletion = storage.requestAccountDeletion({
      userId: passwordUser.id,
      email: "member@example.com",
      password: "password-1234"
    });
    assert.ok(deletion.recover_until);
    assert.ok(storage.getUserById(passwordUser.id).deletion_requested_at);

    const recovered = storage.authenticatePasswordUser({
      email: "member@example.com",
      password: "password-1234"
    });
    assert.equal(recovered.deletion_requested_at, null);

    storage.requestAccountDeletion({
      userId: passwordUser.id,
      email: "member@example.com",
      password: "password-1234"
    });
    const deletedWorkspace = storage.getWorkspace(passwordUser.id).userDir;
    assert.equal(fs.existsSync(deletedWorkspace), true);
    const purged = storage.purgeExpiredDeletedUsers({
      now: new Date(Date.now() + 49 * 60 * 60 * 1000)
    });
    assert.equal(purged.purged, 1);
    assert.equal(storage.getUserById(passwordUser.id), null);
    assert.equal(fs.existsSync(deletedWorkspace), false);

    const trashMemo = storage.createMemo({
      userId,
      title: "Trash me",
      folder: "Archive",
      content: "temporary"
    });
    const workspace = storage.getWorkspace(userId);
    const activeTrashSource = path.join(workspace.memosDir, `${trashMemo.id}.md`);
    const trashedPath = path.join(workspace.trashDir, `${trashMemo.id}.md`);
    const trashed = storage.deleteMemo({ userId, id: trashMemo.id });
    assert.equal(trashed.trashed, true);
    assert.equal(fs.existsSync(activeTrashSource), false);
    assert.equal(fs.existsSync(trashedPath), true);
    assert.equal(storage.readMemo({ userId, id: trashMemo.id }).folder, storage.TRASH_FOLDER_NAME);
    assert.equal(storage.readMemo({ userId, id: trashMemo.id }).original_folder, "Archive");

    const restoredTrash = storage.restoreTrashedMemo({ userId, id: trashMemo.id });
    assert.equal(restoredTrash.memo.folder, "Archive");
    assert.equal(fs.existsSync(activeTrashSource), true);
    assert.equal(fs.existsSync(trashedPath), false);

    storage.deleteMemo({ userId, id: trashMemo.id });
    const purgeTrash = storage.purgeExpiredTrashedMemos({
      userId,
      now: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
    });
    assert.equal(purgeTrash.purged, 1);
    assert.equal(storage.listMemos({ userId }).some((memo) => memo.id === trashMemo.id), false);
    assert.equal(fs.existsSync(trashedPath), false);

    const stale = storage.createMemo({
      userId,
      title: "Stale",
      content: "remove me"
    });
    const stalePath = path.join(storage.getWorkspace(userId).memosDir, `${stale.id}.md`);
    fs.unlinkSync(stalePath);
    storage.rebuildIndex(userId);
    assert.equal(storage.listMemos({ userId }).some((memo) => memo.id === stale.id), false);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("attachments are normalized, sanitized, and embedded safely", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chrononote-media-test-"));
  process.env.CHRONONOTE_DATA_DIR = dataRoot;
  const storage = await import(`../src/storage.js?media=${Date.now()}`);
  const userId = "media-test-0001";

  try {
    storage.ensureWorkspace({ userId, seed: false });
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const image = await storage.uploadAttachment({
      userId,
      filename: "avatar.png",
      data: `data:image/png;base64,${png}`
    });
    assert.equal(path.extname(image.filename), ".webp");
    assert.equal(image.media_type, "image");
    assert.match(image.embed_markdown, /!\[avatar\.png\]\(\.\.\/\.attachments\/media_.+\.webp\)/);

    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="10" height="10" fill="red"/></svg>'
    ).toString("base64");
    const sanitized = await storage.uploadAttachment({
      userId,
      filename: "unsafe.svg",
      data: `data:image/svg+xml;base64,${svg}`
    });
    const savedSvg = fs.readFileSync(path.join(storage.getWorkspace(userId).attachmentsDir, sanitized.filename), "utf8");
    assert.equal(path.extname(sanitized.filename), ".svg");
    assert.doesNotMatch(savedSvg, /script|onload|javascript:/i);

    const gif = "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";
    const video = await storage.uploadAttachment({
      userId,
      filename: "loop.gif",
      data: `data:image/gif;base64,${gif}`
    });
    assert.equal(path.extname(video.filename), ".mp4");
    assert.equal(video.media_type, "video");
    assert.match(video.embed_markdown, /^<video .+autoplay loop muted playsinline controls><\/video>$/);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
