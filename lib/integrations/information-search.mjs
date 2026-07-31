import { executeInformationCapabilitySlot, listInformationCapabilitySlots } from '../tools/capability-slots.mjs';
import { createStoreExecutionLogger } from '../tools/execution-log.mjs';

// 联网搜索补充资料（待办「补齐三个信息工具能力」步骤 4）：
// 自主写作与自定义图文在创建事实基座时，按用户显式开关调用 web-search / news-search 信息槽位，
// 结果持久化进事实基座（web_search / news_search 字段），后续重新生成直接复用，不重复计费。
// 搜索结果属于外部资料，等同于 user_material 级素材：必须保留来源归属，不得写成作者亲历。

const SEARCH_SLOTS = [
  { flag: 'enableWebSearch', slotId: 'web-search', field: 'web_search' },
  { flag: 'enableNewsSearch', slotId: 'news-search', field: 'news_search' },
];

export function wantsInformationSearch(input = {}) {
  return SEARCH_SLOTS.some(({ flag }) => input[flag] === true || input[flag] === 'true');
}

export async function attachInformationSearch({ fact, input = {}, root, toolContext = {} }) {
  const requested = SEARCH_SLOTS.filter(({ flag }) => input[flag] === true || input[flag] === 'true');
  if (!requested.length) return { attached: [], notes: [] };
  const slots = await listInformationCapabilitySlots(root);
  const notes = [];
  const attached = [];
  for (const { slotId, field } of requested) {
    const slot = slots.find((item) => item.id === slotId);
    if (!slot?.available) {
      notes.push(`${slot?.name || slotId}槽位无可用实现，未执行检索`);
      continue;
    }
    const result = await executeInformationCapabilitySlot(slotId,
      { query: fact.topic, maxResults: 5 },
      {
        workspaceRoot: root,
        allowedCapabilities: toolContext.allowedCapabilities,
        executionLog: toolContext.store
          ? createStoreExecutionLogger(toolContext.store, { ...toolContext, capability: slot.capability })
          : undefined,
      });
    if (result.status !== 'ok') {
      notes.push(`${slot.name}失败：${result.error?.message || '未知错误'}（不阻止创建，可稍后在技能与工具页检查槽位）`);
      continue;
    }
    fact[field] = {
      query: String(fact.topic),
      provider: result.provenance?.provider || '',
      answer: result.data.answer || '',
      results: result.data.results || [],
      warnings: result.warnings || [],
      searched_at: new Date().toISOString(),
    };
    attached.push(field);
  }
  if (notes.length) fact.search_notes = [...(fact.search_notes || []), ...notes];
  return { attached, notes };
}
