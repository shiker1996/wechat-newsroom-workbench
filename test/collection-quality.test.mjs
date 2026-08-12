import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { filterCollectedItems, hasMeaningfulCollectedContent } from '../lib/domain/collection-quality.mjs';

test('采集质量门丢弃只有链接但标题和正文均为空的记录', () => {
  assert.equal(hasMeaningfulCollectedContent({ url:'https://x.com/example/1', title:'', summary:'' }), false);
  const result = filterCollectedItems([
    { url:'https://x.com/example/1', title:'', summary:'' },
    { url:'https://example.com/2', title:'有效标题' },
    { url:'https://example.com/3', title:'', description:'有效描述' },
  ]);
  assert.equal(result.kept.length, 2);
  assert.equal(result.dropped.length, 1);
});

test('采集质量门兼容正文类字段并拒绝空白内容', () => {
  assert.equal(hasMeaningfulCollectedContent({ title:'  ', content:'正文' }), true);
  assert.equal(hasMeaningfulCollectedContent({ title:'\n', text:'\t', selftext:' ' }), false);
  assert.deepEqual(filterCollectedItems(null), { kept:[], dropped:[] });
});

test('Reddit 与 RSSHub 采集结果均在入库前经过统一质量门', () => {
  const manager = fs.readFileSync(new URL('../lib/jobs/job-manager.mjs', import.meta.url), 'utf8');
  assert.match(manager, /runner\.run[\s\S]*filterCollectedItems\(run\.items\)[\s\S]*addHotspots\(job\.batchId,source,selected\)/);
  assert.match(manager, /createCollectorRuntime/);
  assert.match(manager, /过滤空内容|采集质量过滤/);
});
