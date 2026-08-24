const STRING_FIELDS = ['topic', 'audience', 'environment', 'thesis', 'limitations', 'localProjectPath'];
const LIST_FIELDS = ['points', 'steps', 'prerequisites', 'expected_results', 'common_errors', 'materialUrls'];

function cleanLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}
export function sanitizeTutorialUpdates(value) {
  const input = value && typeof value === 'object' ? value : {};
  const output = {};
  if (['experience', 'tutorial'].includes(input.articleMode)) output.articleMode = input.articleMode;
  for (const key of STRING_FIELDS) if (input[key] != null && String(input[key]).trim()) output[key] = String(input[key]).trim();
  for (const key of LIST_FIELDS) {
    if (input[key] == null) continue;
    const lines = cleanLines(input[key]);
    if (key === 'materialUrls') output[key] = lines.filter((item) => /^https?:\/\//i.test(item));
    else if (lines.length) output[key] = lines;
  }
  return output;
}

export function tutorialChatMessages({ draft = {}, history = [], answer = '', projectContext = null, projectReadError = '', workspaceRoot } = {}) {
  // 自主写作 prompt 的唯一事实源是技能 skills/tutorial-chat；技能缺失或被禁用时 selectionPrompt 直接抛错（fail-fast）。
  const system = selectionPrompt({ workspaceRoot, skillName:'tutorial-chat' }).prompt;
  const conversation = trimConversation(history);
  if (String(answer || '').trim()) conversation.push({ role: 'user', content: String(answer).trim() });
  const instruction = conversation.length
    ? '根据回答和本地项目材料更新表单，然后只问一个问题；齐备时明确说明“事实表已齐备，可以创建初稿”。'
    : '先询问教程要帮助读者完成什么任务。';
  // 装配结构：不可信块只放纯数据（草稿/本地项目材料）；对话历史展开为真实 user/assistant 回合，指令作为最后一条 user 消息收尾。
  return [
    { role: 'system', content: system, protected: true },
    { role: 'user', protected: true, content: delimitUntrusted('independent-writing-conversation',{
      draft,
      localProject: projectContext ? {
        summary: projectContext.summary,
        files: projectContext.files.map(({ path, excerpt, truncated }) => ({ path, excerpt, truncated })),
        truncated: projectContext.truncated,
      } : null,
      projectReadError: projectReadError || null,
    }) },
    ...conversation,
    { role: 'user', protected: true, content: instruction },
  ];
}

export function parseTutorialResult(result, store) {
  try { return JSON.parse(String(result.content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch (error) {
    const reason = `教程策划返回无效 JSON：${error.message}`;
    if (store) store.updateModelCall(result.callId, { status: 'invalid_output', error: reason });
    throw new Error(reason);
  }
}

export function evaluateTutorialChatReadiness({ draft = {}, updates = {}, projectContext = null } = {}) {
  const merged={...draft,...updates};
  const mode=merged.articleMode;
  const points=cleanLines(merged.points);
  const steps=cleanLines(merged.steps);
  const missing=[];
  if(!['experience','tutorial'].includes(mode))missing.push('文章类型');
  if(!String(merged.topic||'').trim())missing.push('文章主题');
  if(!String(merged.audience||'').trim())missing.push('目标读者');
  if(points.length<3)missing.push('至少 3 条核心要点');
  if(mode==='experience'){
    if(!String(merged.thesis||'').trim())missing.push('核心观点');
    if(!points.some((item)=>item.startsWith('【体验】')))missing.push('至少一条【体验】');
  }
  if(mode==='tutorial'){
    if(!String(merged.environment||'').trim())missing.push('实际环境或版本');
    if(steps.length<2)missing.push('至少 2 个实际步骤');
    if(!projectContext&&!points.some((item)=>/^【(?:体验|素材)】/.test(item)))missing.push('作者体验或用户素材');
  }
  return {ready:missing.length===0,missing};
}
import { delimitUntrusted, trimConversation } from '../../../platform/llm/context-safety.mjs';
import { selectionPrompt } from '../../research/llm/selection-prompts.mjs';
