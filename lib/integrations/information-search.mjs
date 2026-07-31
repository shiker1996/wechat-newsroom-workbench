import { executeInformationCapabilitySlot, listInformationCapabilitySlots } from '../tools/capability-slots.mjs';
import { createStoreExecutionLogger } from '../tools/execution-log.mjs';

// 联网搜索补充资料（待办「补齐三个信息工具能力」步骤 4）：
// 自主写作与自定义图文在创建事实基座时，按用户显式开关调用 web-search / news-search / document 信息槽位，
// 结果持久化进事实基座（web_search / news_search / document_search 字段），后续重新生成直接复用，不重复计费。
// 搜索与检索结果属于外部资料，等同于 user_material 级素材：必须保留来源归属，不得写成作者亲历。
// 文档检索只扫描 config.local.json 的 documentSearch.roots 明确授权的目录（如 Obsidian vault），
// 目录清单由调用方从运行配置传入，本模块不读取配置文件。

const SEARCH_SLOTS = [
  { flag: 'enableWebSearch', slotId: 'web-search', field: 'web_search' },
  { flag: 'enableNewsSearch', slotId: 'news-search', field: 'news_search' },
  { flag: 'enableDocumentSearch', slotId: 'document', field: 'document_search' },
];

export function wantsInformationSearch(input = {}) {
  return SEARCH_SLOTS.some(({ flag }) => input[flag] === true || input[flag] === 'true');
}

function executionContext(root, toolContext, capability, extra = {}) {
  return {
    workspaceRoot: root,
    allowedCapabilities: toolContext.allowedCapabilities,
    executionLog: toolContext.store
      ? createStoreExecutionLogger(toolContext.store, { ...toolContext, capability })
      : undefined,
    ...extra,
  };
}

async function attachDocumentSearch({ fact, root, slot, roots, toolContext, notes }) {
  const authorized = (roots || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!authorized.length) {
    notes.push('文档检索未配置授权知识库目录（config.local.json 的 documentSearch.roots），未执行检索');
    return null;
  }
  const merged = [];
  const warnings = [];
  for (const vaultRoot of authorized) {
    const result = await executeInformationCapabilitySlot('document',
      { query: fact.topic, maxResults: 5, root: vaultRoot },
      executionContext(root, toolContext, slot.capability, { allowedRoots: authorized }));
    if (result.status !== 'ok') {
      warnings.push(`${vaultRoot}：${result.error?.message || '检索失败'}`);
      continue;
    }
    merged.push(...(result.data.documents || []));
    warnings.push(...(result.warnings || []));
  }
  if (!merged.length && warnings.length) {
    notes.push(`文档检索失败：${warnings.join('；')}（不阻止创建）`);
    return null;
  }
  merged.sort((left, right) => (right.score || 0) - (left.score || 0));
  return {
    query: String(fact.topic),
    provider: 'document-folder-search',
    documents: merged.slice(0, 5),
    warnings,
    searched_at: new Date().toISOString(),
  };
}

export async function attachInformationSearch({ fact, input = {}, root, toolContext = {}, documentRoots = [] }) {
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
    if (slotId === 'document') {
      const findings = await attachDocumentSearch({ fact, root, slot, roots: documentRoots, toolContext, notes });
      if (findings) {
        fact[field] = findings;
        attached.push(field);
      }
      continue;
    }
    const result = await executeInformationCapabilitySlot(slotId,
      { query: fact.topic, maxResults: 5 },
      executionContext(root, toolContext, slot.capability));
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
