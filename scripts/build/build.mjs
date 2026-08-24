import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createThemeRegistry } from "../../server/shared/themes/theme-registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const publicDir = path.join(root, "public");
const cssSourceDir = path.join(publicDir, "styles");
const cssSources = ["tokens-base.css", "social-card.css", "production.css", "topics-accessibility.css", "editor-themes.css", "system-console.css"];

function walk(dir, extensions = new Set([".js", ".mjs"])) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) files.push(...walk(full, extensions));
    else if (extensions.has(path.extname(name))) files.push(full);
  }
  return files;
}

function checkSyntax(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], { encoding: "utf8" });
  if (result.status === 0) return true;
  console.error(`  语法错误 ${path.relative(root, filePath)}\n${(result.stderr || result.stdout).trim()}`);
  return false;
}

function checkLocalImports(filePath, content) {
  let ok = true;
  const importPattern = /(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+)["']/g;
  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1];
    const base = path.resolve(path.dirname(filePath), specifier);
    const candidates = [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js"), path.join(base, "index.mjs")];
    if (!candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
      console.error(`  本地 import 不存在 ${path.relative(root, filePath)} -> ${specifier}`);
      ok = false;
    }
  }
  return ok;
}

const sourceFiles = [
  path.join(root, "server.mjs"),
  ...walk(path.join(root, "server")),
  ...walk(path.join(root, "plugins")),
  ...walk(path.join(publicDir, "src"), new Set([".js"])),
];
let ok = true;
try {
  const themes = createThemeRegistry({ builtinRoot:path.join(root, "themes") });
  console.log(`主题校验完成：${themes.list({ target:"article" }).length} 个文章主题，${themes.list({ target:"social" }).length} 个图文主题，${themes.list({ target:"cover" }).length} 个封面主题`);
} catch (error) {
  console.error(`  内置主题校验失败：${error.message}`);
  ok = false;
}
const packageBytes = fs.readFileSync(path.join(root, "package.json"));
if (packageBytes[0] === 0xef && packageBytes[1] === 0xbb && packageBytes[2] === 0xbf) {
  console.error("  package.json 含 UTF-8 BOM，会导致部分排版依赖解析失败");
  ok = false;
}
for (const filePath of sourceFiles) {
  const content = fs.readFileSync(filePath, "utf8");
  ok = checkSyntax(filePath) && checkLocalImports(filePath, content) && ok;
}

const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
  const src = match[1];
  if (/^(?:https?:)?\/\//i.test(src)) continue;
  const filePath = path.resolve(publicDir, src.replace(/^\//, ""));
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    console.error(`  HTML 脚本引用不存在 ${src}`);
    ok = false;
  }
}

const expectedStyles = `${cssSources.map((name) => fs.readFileSync(path.join(cssSourceDir, name), "utf8").replace(/\s+$/, "")).join("\n\n")}\n`;
const actualStyles = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
if (actualStyles !== expectedStyles) {
  console.error("  public/styles.css 不是由 public/styles/*.css 当前分片生成，请运行 npm run build:styles");
  ok = false;
}

const frontendFiles = walk(path.join(publicDir, "src"), new Set([".js"]));
const total = frontendFiles.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);
console.log(`构建校验完成：${sourceFiles.length} 个生产模块，前端源码 ${(total / 1024).toFixed(1)} KB`);
process.exit(ok ? 0 : 1);
