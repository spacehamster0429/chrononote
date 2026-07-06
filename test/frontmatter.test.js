import assert from "node:assert/strict";
import test from "node:test";
import { buildMarkdown, normalizeTags, parseMarkdown } from "../src/frontmatter.js";

test("frontmatter round-trips core memo metadata", () => {
  const markdown = buildMarkdown({
    id: "memo-12345678",
    title: "2026 트렌드 리포트",
    tags: ["리서치", "아이디어", "리서치"],
    created_at: "2026-05-10T09:00:00.000Z",
    updated_at: "2026-05-10T10:00:00.000Z",
    folder: "리서치",
    pinned: true,
    position: 7,
    content: "# 본문\n마크다운 내용"
  });

  const parsed = parseMarkdown(markdown);
  assert.equal(parsed.id, "memo-12345678");
  assert.equal(parsed.title, "2026 트렌드 리포트");
  assert.deepEqual(parsed.tags, ["리서치", "아이디어"]);
  assert.equal(parsed.created_at, "2026-05-10T09:00:00.000Z");
  assert.equal(parsed.updated_at, "2026-05-10T10:00:00.000Z");
  assert.equal(parsed.folder, "리서치");
  assert.equal(parsed.pinned, true);
  assert.equal(parsed.position, 7);
  assert.equal(parsed.content, "# 본문\n마크다운 내용");
});

test("tag normalization accepts comma separated input", () => {
  assert.deepEqual(normalizeTags("dev, idea, dev, , ops"), ["dev", "idea", "ops"]);
});
