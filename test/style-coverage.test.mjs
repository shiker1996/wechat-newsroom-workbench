import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkStyleCoverage } from "../scripts/quality/check-style-coverage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("前端使用的 class 不新增未覆盖的 CSS 类名", () => {
  const result = checkStyleCoverage(root);
  assert.deepEqual(result.missing, []);
});
