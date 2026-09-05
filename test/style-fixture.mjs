import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CSS_SOURCES = [
  "tokens-base.css",
  "social-card.css",
  "production.css",
  "topics-accessibility.css",
  "editor-themes.css",
  "system-console.css",
];

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Read the authoritative CSS sources for source-level assertions.
 * The browser loads generated route bundles; tests should never depend on
 * the removed legacy compatibility bundle.
 */
export function readStyles(root = defaultRoot) {
  return `${CSS_SOURCES.map((name) => fs.readFileSync(path.join(root, "public", "styles", name), "utf8").replace(/\s+$/, "")).join("\n\n")}\n`;
}
