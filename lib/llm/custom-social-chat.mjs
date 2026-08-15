import { formatAccountContext } from '../domain/account-context.mjs';
import { delimitUntrusted, trimConversation } from './context-safety.mjs';
import { parseModelJson } from './model-json.mjs';

// 自定义图文创建前的对话式策划（仿 editorial-room.mjs 的流式 JSON 模式，但无状态：
// 创建前还没有候选记录，草稿与对话历史由前端每轮全量传入，本模块只返回结构化表单更新）。

const CONTENT_TYPES = new Set(['tutorial', 'list', 'opinion']);
const CHANNELS = new Set(['wechat', 'xiaohongshu']);

export function parseResult(result, store) {
  return parseModelJson(result,{store,label:'图文策划'});
}
import { selectionPrompt } from './selection-prompts.mjs';

// 图文策划 prompt 的唯一事实源是技能 skills/custom-social-chat；账号上下文仍是代码注入的数据，
// 技能文本用 {{ACCOUNT_CONTEXT}} 占位符标出注入位置。技能缺失或被禁用时 selectionPrompt 直接抛错（fail-fast）。
function customSocialSystem(workspaceRoot) {
  const { prompt } = selectionPrompt({ workspaceRoot, skillName:'custom-social-chat' });
  return prompt.replaceAll('{{ACCOUNT_CONTEXT}}', formatAccountContext({workspaceRoot}));
}

export function requestMessages({ draft = {}, history = [], answer = '', workspaceRoot } = {}) {
  const webSearchContext = '如有联网搜索信息已在对话开头提供。联网搜索结果为当前实时公开资料，可据此提出【素材】建议。';
  const trimmed = String(answer || '').trim();
  const conversation = trimConversation(history);
  if (trimmed) conversation.push({ role: 'user', content: trimmed });
  const instruction = trimmed
    ? '处理用户刚才的回答并更新表单草稿；然后只问一个下一问题（方案已齐备则不再提问）。'
    : '对话刚开始。先问第一个问题：想做什么类型、什么主题的图文？';
  // 装配结构：不可信块只放纯数据（表单草稿）；对话历史展开为真实 user/assistant 回合，指令作为最后一条 user 消息收尾。
  return [
    { role: 'system', content: `${customSocialSystem(workspaceRoot)}\n${webSearchContext}`, protected: true },
    { role: 'user', protected: true, content: delimitUntrusted('custom-social-conversation',{ draft }) },
    ...conversation,
    { role: 'user', protected: true, content: instruction },
  ];
}

function cleanLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

// 只放行表单上真实存在的字段，并做类型清洗，防止模型输出污染表单
export function sanitizeFormUpdates(updates) {
  const input = updates && typeof updates === 'object' ? updates : {};
  const out = {};
  if (CONTENT_TYPES.has(input.content_type)) out.content_type = input.content_type;
  if (CHANNELS.has(input.channel)) out.channel = input.channel;
  for (const key of ['topic', 'audience', 'scenario', 'thesis', 'limitations']) {
    if (input[key] != null && String(input[key]).trim()) out[key] = String(input[key]).trim();
  }
  for (const key of ['points', 'steps', 'items']) {
    if (input[key] != null) {
      const lines = cleanLines(input[key]);
      if (lines.length) out[key] = lines;
    }
  }
  if (input.materialUrls != null) {
    const urls = cleanLines(input.materialUrls).filter((item) => /^https?:\/\//i.test(item));
    if (urls.length) out.materialUrls = urls;
  }
  const pages = Number(input.expected_pages);
  if (Number.isFinite(pages) && pages > 0) out.expected_pages = Math.min(10, Math.max(4, Math.round(pages)));
  return out;
}
