import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLASS_TOKEN = /[-_a-zA-Z][-_a-zA-Z0-9]*/g;
const CLASS_ATTR = /(?<![-\w])class\s*=\s*(["'`])([\s\S]*?)\1/g;
const CLASS_NAME_ASSIGNMENT = /\bclassName\s*=\s*(["'`])([\s\S]*?)\1/g;
const CLASS_ATTRIBUTE_ASSIGNMENT = /setAttribute\s*\(\s*["']class["']\s*,\s*(["'`])([\s\S]*?)\1/g;
const CLASS_LIST_CALL = /classList\.(?:add|remove|toggle|contains)\s*\(\s*(["'`])([^"'`]+)\1/g;

function stripCssComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, "");
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function extractClassAttributes(source) {
  const values = [];
  const startPattern = /(?<![-\w])class\s*=\s*(["'`])/g;
  for (const start of source.matchAll(startPattern)) {
    const quote = start[1];
    const valueStart = start.index + start[0].length;
    let cursor = valueStart;
    let value = "";
    while (cursor < source.length) {
      if (source[cursor] === "$" && source[cursor + 1] === "{") {
        let depth = 1;
        let nestedQuote = "";
        let escaped = false;
        cursor += 2;
        while (cursor < source.length && depth) {
          const char = source[cursor];
          if (nestedQuote) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === nestedQuote) nestedQuote = "";
          } else if (char === "\"" || char === "'" || char === "`") nestedQuote = char;
          else if (char === "{") depth += 1;
          else if (char === "}") depth -= 1;
          cursor += 1;
        }
        value += " ";
        continue;
      }
      if (source[cursor] === quote) break;
      value += source[cursor];
      cursor += 1;
    }
    values.push({ value, index: valueStart });
  }
  return values;
}

function addUsage(target, value, source, file, offset) {
  const staticValue = value.replace(/\$\{[\s\S]*?\}/g, " ");
  for (const match of staticValue.matchAll(CLASS_TOKEN)) {
    const name = match[0];
    if (!target.has(name)) target.set(name, []);
    target.get(name).push({ file, line: lineNumber(source, offset + match.index) });
  }
}

function collectHtmlUsages(source, file, usages) {
  for (const match of source.matchAll(CLASS_ATTR)) addUsage(usages, match[2], source, file, match.index + match[0].indexOf(match[2]));
}

function collectJsUsages(source, file, usages) {
  for (const attribute of extractClassAttributes(source)) addUsage(usages, attribute.value, source, file, attribute.index);
  for (const pattern of [CLASS_NAME_ASSIGNMENT, CLASS_ATTRIBUTE_ASSIGNMENT]) {
    for (const match of source.matchAll(pattern)) addUsage(usages, match[2], source, file, match.index + match[0].indexOf(match[2]));
  }
  for (const match of source.matchAll(CLASS_LIST_CALL)) addUsage(usages, match[2], source, file, match.index + match[0].indexOf(match[2]));
}

function collectCssClasses(source) {
  return new Set([...stripCssComments(source).matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]));
}

function listFiles(directory, extension, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(fullPath, extension, result);
    else if (entry.isFile() && fullPath.endsWith(extension)) result.push(fullPath);
  }
  return result;
}

function readAllowlist(root) {
  const file = path.join(root, "scripts", "quality", "style-coverage-allowlist.json");
  if (!fs.existsSync(file)) return { classes: [], prefixes: [] };
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    classes: Array.isArray(parsed.classes) ? parsed.classes.map(String) : [],
    prefixes: Array.isArray(parsed.prefixes) ? parsed.prefixes.map(String) : [],
  };
}

function readBaseline(root) {
  const file = path.join(root, "scripts", "quality", "style-coverage-baseline.json");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(parsed.missingClasses) ? parsed.missingClasses.map(String) : [];
}

export function checkStyleCoverage(root) {
  const publicRoot = path.join(root, "public");
  const usages = new Map();
  const htmlFiles = listFiles(publicRoot, ".html");
  const jsFiles = listFiles(publicRoot, ".js");
  const cssFiles = listFiles(publicRoot, ".css");

  for (const file of htmlFiles) {
    const source = fs.readFileSync(file, "utf8");
    collectHtmlUsages(source, path.relative(root, file), usages);
  }
  for (const file of jsFiles) {
    const source = fs.readFileSync(file, "utf8");
    collectJsUsages(source, path.relative(root, file), usages);
  }

  const defined = new Set();
  for (const file of cssFiles) {
    for (const name of collectCssClasses(fs.readFileSync(file, "utf8"))) defined.add(name);
  }

  const allowlist = readAllowlist(root);
  const baseline = readBaseline(root);
  const allMissing = [...usages.entries()]
    .filter(([name]) => !defined.has(name) && !allowlist.classes.includes(name) && !allowlist.prefixes.some((prefix) => name.startsWith(prefix)))
    .map(([name, references]) => ({ name, references }));
  const missing = allMissing.filter((item) => !baseline.includes(item.name));
  return { missing, knownMissing: allMissing.length - missing.length, definedCount: defined.size, usedCount: usages.size, files: { html: htmlFiles.length, js: jsFiles.length, css: cssFiles.length } };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const result = checkStyleCoverage(root);
  if (!result.missing.length) {
    console.log(`style coverage ok · ${result.usedCount} used / ${result.definedCount} defined classes · ${result.knownMissing} baseline gaps`);
    return;
  }
  console.error(`style coverage failed · ${result.missing.length} used classes have no CSS definition`);
  for (const item of result.missing) {
    const refs = item.references.slice(0, 3).map((ref) => `${ref.file}:${ref.line}`).join(", ");
    console.error(`- .${item.name} · ${refs}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
