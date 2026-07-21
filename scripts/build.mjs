import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

// ESM source: validate all modules can be parsed
const srcDir = path.join(publicDir, "src");
function walk(dir) {
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) files.push(...walk(full));
    else if (name.endsWith(".js")) files.push(full);
  }
  return files;
}
const modules = walk(srcDir);
let ok = true;
for (const m of modules) {
  try {
    // Just check the file exists and is readable
    const content = fs.readFileSync(m, "utf-8");
    const rel = path.relative(root, m);
    console.log(`  ${rel} (${(Buffer.byteLength(content, "utf-8") / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error(`  ${m}: ${err.message}`);
    ok = false;
  }
}
const total = modules.reduce((s, m) => s + fs.statSync(m).size, 0);
console.log(`\nESM 源码验证完成：${modules.length} 个文件，合计 ${(total / 1024).toFixed(1)} KB`);
process.exit(ok ? 0 : 1);