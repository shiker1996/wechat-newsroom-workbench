import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('编辑室互斥成稿按钮，编辑器以锁定状态或已有文稿兜底展示', () => {
  const editorial = fs.readFileSync(new URL('../public/src/views/editorial.js', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../public/src/views/editor.js', import.meta.url), 'utf8');
  assert.match(editorial, /editorialRequestPending = true/);
  assert.match(editorial, /btn\.disabled = editorialRequestPending/);
  assert.match(editorial, /请等待 AI 编辑回应完成后再开始成稿/);
  assert.match(editor, /item\.status === "locked" \|\| item\.brief_status === "LOCKED" \|\| documentedCandidateIds\.has/);
});
