import { selectSkillPromptReferences } from '../../../platform/llm/skill-runtime.mjs';

function copyReferences(contentType, storyboardClass = contentType) {
  const primary = contentType === 'event'
    ? (storyboardClass === 'technology' ? 'references\\copy-technology.md' : storyboardClass === 'trend' ? 'references\\copy-trend.md' : 'references\\copy-event.md')
    : contentType === 'custom' ? 'references\\copy-custom.md' : 'references\\copy-tool.md';
  const legacy = contentType === 'event' ? 'references\\wechat-event-cards.md'
    : contentType === 'custom' ? 'references\\custom-cards.md' : 'references\\wechat-tool-cards.md';
  return [primary, legacy];
}

export function buildSocialCardCopySkillPrompt(skillPrompt, { contentType, storyboardClass } = {}) {
  return selectSkillPromptReferences(skillPrompt, {
    include: ['COPY_GUIDE.md', ...copyReferences(contentType, storyboardClass)],
  });
}

export function buildSocialCardCopyInput({
  channelMode = 'wechat',
  outputMode = '',
  topic = '',
  contentType = 'event',
  storyboardClass,
  factData = {},
  sourceUrl = '',
  eventAnalysis = null,
  editorial = {},
  cardPlan = [],
  disclosure = '',
} = {}) {
  const sourceUrls = contentType === 'event'
    ? (eventAnalysis?.sources || factData?.sources || []).map((item) => item?.url).filter(Boolean)
    : contentType === 'custom'
      ? (factData?.materials || []).map((item) => item?.url).filter(Boolean)
      : [];
  return {
    channel_mode: outputMode || channelMode,
    topic,
    content_type: contentType,
    storyboard_class: contentType === 'event' ? storyboardClass : undefined,
    custom_content_type: contentType === 'custom' ? factData?.content_type : undefined,
    source_url: contentType === 'event' ? sourceUrls : contentType === 'custom' ? sourceUrls : sourceUrl,
    repository_facts: contentType === 'repository' ? factData : undefined,
    event_analysis: contentType === 'event' ? (eventAnalysis || factData) : undefined,
    custom_facts: contentType === 'custom' ? factData : undefined,
    editorial_decisions: editorial,
    card_plan: cardPlan,
    disclosure,
  };
}

export function buildSocialCardCopySystemPrompt(skillPrompt, { channelMode = 'wechat', contentType = 'event', storyboardClass } = {}) {
  return `${buildSocialCardCopySkillPrompt(skillPrompt, { contentType, storyboardClass })}

## 当前运行阶段
只生成可直接发布的配套文案。输出纯文本，不要 JSON、Markdown 围栏、页码或布局指令；严格遵守事实与禁用表达。${channelMode === 'xiaohongshu' ? ' 小红书渠道：文案口语化、段落短，适度使用 emoji，末尾带 6–8 个话题标签，标签不得含夸大功效词。' : ' 公众号渠道：文案信息密度优先，结构清晰，末尾带 6–8 个准确话题标签，标签须与内容严格相关。'}${contentType === 'event' ? ' 未核实主张必须注明说话者和“尚未获独立证实”等边界；不得把技术能力、趋势判断或争议定性为超出证据的结论。' : ''}${contentType === 'custom' ? ' 体验性表述只能来自 source_level=author_experience 的要点；user_material 必须保留来源归属；model_suggestion 只能写成建议或参考，禁止写成亲测、效果或收益。' : ''}`;
}

export function validateSocialCardCopy(copy = '') {
  const value = String(copy || '').trim();
  const issues = [];
  if (!value) issues.push('配套文案为空');
  const copyTagCount = (value.match(/#[^#\s]{1,30}/g) || []).length;
  if (value && copyTagCount < 3) issues.push(`配套文案话题标签不足（检测到 ${copyTagCount} 个，末尾应有 6–8 个）`);
  return { valid: issues.length === 0, issues, tagCount: copyTagCount };
}

export async function generateSocialCardCopy({
  gateway,
  provider,
  providerConfig = {},
  batchId,
  candidateId,
  skillPrompt,
  channelMode = 'wechat',
  outputMode = '',
  topic = '',
  contentType = 'event',
  storyboardClass,
  factData = {},
  sourceUrl = '',
  eventAnalysis = null,
  editorial = {},
  cardPlan = [],
  disclosure = '',
} = {}) {
  const input = buildSocialCardCopyInput({ channelMode, outputMode, topic, contentType, storyboardClass, factData, sourceUrl, eventAnalysis, editorial, cardPlan, disclosure });
  const result = await gateway.complete({
    provider,
    purpose: 'social-card-copy',
    batchId,
    candidateId,
    maxOutputTokens: Math.min(2400, Number(providerConfig.maxOutputTokens) || 2400),
    messages: [
      { role: 'system', protected: true, content: buildSocialCardCopySystemPrompt(skillPrompt, { channelMode, contentType, storyboardClass }) },
      { role: 'user', protected: true, content: JSON.stringify(input) },
    ],
  });
  const copy = String(result?.content || '').trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return { copy, result, input };
}
