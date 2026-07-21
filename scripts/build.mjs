/**
 * 构建脚本 — 将拆分的前端模块合并为 app.min.js
 * 运行: npm run build
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");

const MODULES = [
  "app-core.js",
  "app-overview.js",
  "app-pool-editorial.js",
  "app-editor-production.js",
  "app-models-logs.js",
  "app-bind.js",
];

const OUTPUT = "app.min.js";

function build() {
  let combined = "";
  let totalBytes = 0;
  for (const name of MODULES) {
    const filePath = path.join(publicDir, name);
    if (!fs.existsSync(filePath)) {
      console.error("[build] 缺少模块: " + name + " at " + filePath);
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    combined += content + "\n";
    totalBytes += Buffer.byteLength(content, "utf-8");
  }
  const outPath = path.join(publicDir, OUTPUT);
  fs.writeFileSync(outPath, combined, "utf-8");
  const outSize = fs.statSync(outPath).size;
  console.log("[build] " + MODULES.length + " 个模块 → " + OUTPUT);
  console.log("[build] 源文件合计: " + (totalBytes / 1024).toFixed(1) + " KB");
  console.log("[build] 输出文件: " + (outSize / 1024).toFixed(1) + " KB");
}

build();
