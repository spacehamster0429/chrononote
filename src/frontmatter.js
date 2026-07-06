export function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
  }

  if (typeof tags === "string") {
    return normalizeTags(tags.split(","));
  }

  return [];
}

export function buildMarkdown({ id, title, tags, created_at, updated_at, content, deleted_commits, folder, pinned, position, trashed_at, original_folder }) {
  const createdAt = created_at || new Date().toISOString();
  const updatedAt = updated_at || new Date().toISOString();
  const cleanTitle = String(title || "Untitled").trim() || "Untitled";

  const lines = [
    "---",
    `id: ${id}`,
    `title: ${JSON.stringify(cleanTitle)}`,
    `tags: ${JSON.stringify(normalizeTags(tags))}`,
    `created_at: ${JSON.stringify(createdAt)}`,
    `updated_at: ${JSON.stringify(updatedAt)}`
  ];

  if (deleted_commits && deleted_commits.length) {
    lines.push(`deleted_commits: ${JSON.stringify(deleted_commits)}`);
  }
  if (folder) {
    lines.push(`folder: ${JSON.stringify(folder)}`);
  }
  if (trashed_at) {
    lines.push(`trashed_at: ${JSON.stringify(trashed_at)}`);
  }
  if (original_folder) {
    lines.push(`original_folder: ${JSON.stringify(original_folder)}`);
  }
  if (pinned) {
    lines.push("pinned: true");
  }
  if (Number.isFinite(Number(position)) && Number(position) > 0) {
    lines.push(`position: ${Number(position)}`);
  }

  lines.push("---", content || "");
  return lines.join("\n");
}

export function parseMarkdown(markdown, fallback = {}) {
  const raw = String(markdown || "").replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const now = new Date().toISOString();

  if (!match) {
    return {
      id: fallback.id,
      title: fallback.title || "Untitled",
      tags: normalizeTags(fallback.tags),
      created_at: fallback.created_at || now,
      updated_at: fallback.updated_at || now,
      deleted_commits: fallback.deleted_commits || [],
      folder: fallback.folder || "",
      trashed_at: fallback.trashed_at || null,
      original_folder: fallback.original_folder || "",
      pinned: Boolean(fallback.pinned),
      position: Number(fallback.position || 0),
      content: raw
    };
  }

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    meta[key] = parseYamlValue(value);
  }

  return {
    id: meta.id || fallback.id,
    title: meta.title || fallback.title || "Untitled",
    tags: normalizeTags(meta.tags || fallback.tags),
    created_at: meta.created_at || fallback.created_at || now,
    updated_at: meta.updated_at || fallback.updated_at || now,
    deleted_commits: meta.deleted_commits || fallback.deleted_commits || [],
    folder: meta.folder || fallback.folder || "",
    trashed_at: meta.trashed_at || fallback.trashed_at || null,
    original_folder: meta.original_folder || fallback.original_folder || "",
    pinned: Boolean(meta.pinned ?? fallback.pinned),
    position: Number(meta.position ?? fallback.position ?? 0),
    content: match[2] || ""
  };
}

function parseYamlValue(value) {
  if (!value) return "";
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("[") && value.endsWith("]"))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  return value;
}
