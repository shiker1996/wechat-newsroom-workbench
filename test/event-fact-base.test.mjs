import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeEventAnalysis } from '../lib/domain/event-fact-base.mjs';
import { evaluateEventCardGate } from '../lib/domain/social-card-gate.mjs';

const groups = [
  {
    event_id: 'e1',
    title: '微信读书导出调整',
    card: {
      conclusion: '微信读书调整书摘导出格式，第三方同步工具需要适配。',
      confirmed_facts: ['微信读书 8.0 更改书摘导出格式', '多个同步插件失效'],
      disagreements: ['官方称是临时调整，第三方开发者认为是永久变更'],
      unverified: ['传闻下版本将封闭导出接口'],
    },
    hotspots: [
      { id: 1, title: '报道一', url: 'https://a.com/1', sourceDoc: { status: 'ok', final_url: 'https://a.com/1', title: '报道一' } },
      { id: 2, title: '报道二', url: 'https://b.com/2', sourceDoc: null },
    ],
  },
];

test('synthesizeEventAnalysis 合成与突发分析相同的形状', () => {
  const record = synthesizeEventAnalysis(groups);
  assert.equal(record.eventSummary, '微信读书调整书摘导出格式，第三方同步工具需要适配。');
  assert.deepEqual(record.factBase.confirmedFacts, ['微信读书 8.0 更改书摘导出格式', '多个同步插件失效']);
  assert.deepEqual(record.factBase.claims, ['传闻下版本将封闭导出接口']);
  assert.equal(record.sources.length, 2);
  assert.equal(record.sources[0].status, 'ok');
  assert.equal(record.sources[1].status, 'missing');
  assert.equal(record.sourceAudit.independentSourceCount, 2);
  assert.deepEqual(record.sourceAudit.issues, ['官方称是临时调整，第三方开发者认为是永久变更']);
  assert.equal(record.sourceAudit.neededMaterials.length, 1);
});

test('synthesizeEventAnalysis 空输入返回 null，无事件卡时保留来源列表', () => {
  assert.equal(synthesizeEventAnalysis([]), null);
  assert.equal(synthesizeEventAnalysis(null), null);
  const noCard = synthesizeEventAnalysis([{ event_id: 'e2', card: null, hotspots: [{ id: 3, title: 't', url: 'https://c.com', sourceDoc: null }] }]);
  assert.equal(noCard.eventSummary, '');
  assert.equal(noCard.sources.length, 1);
});

test('合成的事实基座能通过事件门禁的事实类检查', () => {
  const record = synthesizeEventAnalysis(groups);
  const editorial = {
    card_plan_json: JSON.stringify([{ kind: 'cover' }, { kind: 'content' }, { kind: 'content' }, { kind: 'ending' }]),
    must_disclose: '未核实传闻已设界', forbidden_claims: '不得声称接口已封闭',
    target_reader: '知识管理用户', pain_point: '同步工具失效',
  };
  const gate = evaluateEventCardGate({}, { analysis: record }, editorial);
  assert.equal(gate.ready, true, gate.issues.join('；'));
});
