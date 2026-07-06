import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const vendorDir = path.join(root, "public", "vendor");

copyFile("marked/marked.min.js", "node_modules/marked/lib/marked.umd.js");
copyFile("marked/LICENSE", "node_modules/marked/LICENSE");
copyFile("dompurify/purify.min.js", "node_modules/dompurify/dist/purify.min.js");
copyFile("dompurify/LICENSE", "node_modules/dompurify/LICENSE");
copyFile("katex/katex.min.js", "node_modules/katex/dist/katex.min.js");
copyFile("katex/auto-render.min.js", "node_modules/katex/dist/contrib/auto-render.min.js");
copyFile("katex/katex.min.css", "node_modules/katex/dist/katex.min.css");
copyFile("katex/LICENSE", "node_modules/katex/LICENSE");
copyDir("katex/fonts", "node_modules/katex/dist/fonts");

function copyFile(target, source) {
  const targetPath = path.join(vendorDir, target);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(path.join(root, source), targetPath);
}

function copyDir(target, source) {
  const targetPath = path.join(vendorDir, target);
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(targetPath, { recursive: true });
  for (const entry of fs.readdirSync(path.join(root, source), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    fs.copyFileSync(path.join(root, source, entry.name), path.join(targetPath, entry.name));
  }
}
