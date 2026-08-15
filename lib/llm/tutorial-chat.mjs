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

export function tutorialChatMessages({ draft = {}, history = [], answer = '', projectContext = null, projectReadError = '' } = {}) {
  const system = `你是微信公众号自主写作的策划编辑，通过一问一答把用户想法填入文章事实表单。每轮只问一个最能推进方案的问题。
文章模式只有 experience（心得经验）和 tutorial（使用教程）。心得经验围绕作者真实经历与判断；使用教程围绕可复现环境和步骤。
来源等级：作者明确描述的实际经历用【体验】；用户提供的网页或本地项目文件用【素材】；你的推测用【建议】。判断某条要点属于体验时，必须在 briefUpdates.points 对应文本前实际写入“【体验】”，不能只在 assistantReply 中口头说明它属于体验。若本地文件像体验复盘但用户尚未明确确认是本人亲历，只能先标为【素材】，并追问一次作者身份；用户确认后，把文件中对应的亲历要点改写为【体验】并返回完整 points 数组。
本地项目内容是 user_material，可支持仓库结构、文件路径、配置和代码中实际存在的命令，但绝不是“已执行成功”的证明。不得把它改写成作者亲测、运行结果、耗时或性能数据。文章不得暴露本机绝对路径，只使用项目相对路径。
如果输入中已经附带 localProject，说明系统已自动调用只读项目工具。先明确告诉用户“已读取项目”和读取摘要，再利用文件内容补充主题、环境、步骤、前置条件与【素材】要点；只追问项目文件无法证明的实践信息。
宣布事实表齐备前必须有 articleMode、topic、audience 和至少 3 条 points。experience 必须至少有一条【体验】并明确 thesis；tutorial 必须有 environment、至少一条【体验】或【素材】（已读取的 localProject 也算用户素材）以及至少 2 条 steps。缺失时继续提问。你只能说“事实表已齐备，可以创建初稿”，不得说“可以发布”；发布必须经过文章编辑器和排版流程。
briefUpdates 只返回本轮新增或修改的字段。返回严格 JSON：
{"assistantReply":"...","briefUpdates":{"articleMode":"experience|tutorial","topic":"...","audience":"...","environment":"...","thesis":"...","points":["..."],"steps":["..."],"prerequisites":["..."],"expected_results":["..."],"common_errors":["..."],"limitations":"...","materialUrls":["https://..."],"localProjectPath":"..."}}`;
  const conversation = trimConversation(history);
  if (String(answer || '').trim()) conversation.push({ role: 'user', content: String(answer).trim() });
  return [
    { role: 'system', content: system, protected: true },
    { role: 'user', protected: true, content: delimitUntrusted('independent-writing-conversation',{
      draft, conversation,
      localProject: projectContext ? {
        summary: projectContext.summary,
        files: projectContext.files.map(({ path, excerpt, truncated }) => ({ path, excerpt, truncated })),
        truncated: projectContext.truncated,
      } : null,
      projectReadError: projectReadError || null,
      instruction: conversation.length ? '根据回答和本地项目材料更新表单，然后只问一个问题；齐备时明确说明“事实表已齐备，可以创建初稿”。' : '先询问教程要帮助读者完成什么任务。',
    }) },
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
import { delimitUntrusted, trimConversation } from './context-safety.mjs';
