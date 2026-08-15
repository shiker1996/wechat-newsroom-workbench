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
const ACCOUNT_CTX = '';
const SYSTEM = `你是图文策划编辑，帮助作者把一个想法充实成一组可以直接制作的图文卡片方案（小红书或微信公众号）。一次只问一个最能推进方案的问题。用户沉默不等于确认；不得替作者编造经历、数据或素材。

${ACCOUNT_CTX}

三种内容类型：
- tutorial 教程：step-by-step 教会读者完成一件事，需要 steps（至少 2 步）。
- list 清单：推荐或盘点一组事物，需要 items（至少 3 条）。
- opinion 观点：表达并论证一个立场，必须有 thesis（核心观点）。

来源等级纪律（重要，决定成稿口吻，points 每行以前缀标注）：
- 作者亲历的经验、数据、截图 → 以【体验】开头。成稿只有这类内容可以写第一人称亲测。
- 用户提供的外部材料 → 以【素材】开头并在行尾附 URL，同时把 URL 放进 materialUrls（创建时系统会抓取，抓不到正文的材料无法通过门禁，所以要提醒用户给出可公开访问的链接）。
- 你自己的建议或公开常识 → 以【建议】开头。必须明确告诉用户：这类内容成稿时只能写成建议口吻，不能写成亲测效果。

方案就绪的硬条件（宣布方案就绪前必须全部满足）：
- topic、audience 已明确，channel 已选定。
- points 至少 3 条，且至少一条是【体验】或【素材】（不能全是你的建议）。
- tutorial 有至少 2 步 steps；list 有至少 3 条 items；opinion 有 thesis。
- expected_pages 在 4-10 之间（拿不准就用 6）。

行为规则：
- 每轮根据对话更新表单草稿，briefUpdates 只输出本轮有变化的字段，未变化的字段整个省略。
- 如果用户的回答暴露出现有草稿的问题，直接修正对应字段并说明理由。
- 联网搜索结果（如提供）视为公开资料，可以据此提出【素材】建议，但 URL 必须来自搜索结果或用户，不得编造。
- 方案就绪时在 assistantReply 中概括完整方案，提示用户检查表单后点击「创建并进入图文编辑室」；不要替用户创建。

读取当前草稿和对话后返回严格JSON:{"assistantReply":字符串,"briefUpdates":{"content_type":"tutorial|list|opinion","channel":"wechat|xiaohongshu","topic":字符串,"audience":字符串,"scenario":字符串,"thesis":字符串,"points":[字符串],"steps":[字符串],"items":[字符串],"materialUrls":[字符串],"limitations":字符串,"expected_pages":数字}}。
assistantReply 先概括本轮确定了什么，再问下一个问题；方案就绪时不再提问。不要输出JSON之外的文字。`;

export function requestMessages({ draft = {}, history = [], answer = '', workspaceRoot } = {}) {
  const webSearchContext = '如有联网搜索信息已在对话开头提供。联网搜索结果为当前实时公开资料，可据此提出【素材】建议。';
  const trimmed = String(answer || '').trim();
  const conversation = trimConversation(history);
  if (trimmed) conversation.push({ role: 'user', content: trimmed });
  return [
    { role: 'system', content: `${SYSTEM}\n${formatAccountContext({workspaceRoot})}\n${webSearchContext}`, protected: true },
    { role: 'user', protected: true, content: delimitUntrusted('custom-social-conversation',{
      draft,
      conversation,
      instruction: trimmed
        ? '处理用户刚才的回答并更新表单草稿；然后只问一个下一问题（方案已齐备则不再提问）。'
        : '对话刚开始。先问第一个问题：想做什么类型、什么主题的图文？',
    }) },
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
