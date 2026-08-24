import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownVisibleChars } from '../server/shared/domain/markdown-visible-chars.mjs';

test('visual directive fences do not count toward article length', () => {
  const markdown = `# 标题

正文

\`\`\`mermaid
flowchart TB
A --> B
\`\`\`

\`\`\`echarts
{"series":[{"data":[1,2,3]}]}
\`\`\``;

  assert.equal(markdownVisibleChars(markdown), 2);
});

test('ordinary code blocks remain reader-visible and are counted', () => {
  const markdown = `正文

\`\`\`js
run()
\`\`\``;

  assert.equal(markdownVisibleChars(markdown), 7);
});
