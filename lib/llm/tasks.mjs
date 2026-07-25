import { isFreshForBatch } from './research-pipeline.mjs';

function parseJson(content) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

const TAG_SYSTEM = `你是公众号热点语义标注与全量预评估器。只根据标题、RSS 摘要（如有）、来源、链接、发布时间和输入元数据判断，不补写未提供的事实。摘要是 RSS 提供的节选，可能不完整，不得当作完整正文引用。
返回严格 JSON：{"items":[{"id":数字,"category":"🤖 AI/技术动态|📰 综合资讯|🏢 大厂战略|📈 行业趋势|💼 职场生态","marketScope":"国内|全球性|国外","chinaRelevance":0到12整数,"relevanceReason":字符串,"riskLevel":"低|中|高","riskReason":字符串,"score":0到100整数,"eventParts":{"who":字符串,"what":字符串,"where":字符串,"when":字符串,"actionType":"发布|开源|融资|收购|裁员|诉讼|合作|获奖|政策|人事|产品更新|研究突破|争议回应|其他","object":字符串,"occasion":字符串},"keywords":[字符串],"globalException":布尔,"preScores":{"conflict":0到20,"audience":0到20,"informationGain":0到15,"emotion":0到15,"timeliness":0到10,"impact":0到10,"sourceReliability":0到10},"credibleScoop":0到12,"saturationPenalty":0到15,"duplicatePenalty":0到10,"blackHorseSignals":["信息稀缺|搜索需求|个人利益|差异角度|上升迹象"]}]}。
eventParts 把事件拆成名词化要素：who 为核心主体（公司、产品或人物的规范名称，同一实体必须使用同一名称，例如“月之暗面”和“Moonshot”只取其一）；what 为核心动作或事实的名词化短语（如“发布开源模型K3”），同公司不同发布、评论文章与新增事实必须分开；where 为事件影响地区（如“国内”“美国”“欧盟”“全球”），无明确地区留空字符串；when 为粗粒度时间窗口（如“2026-07”），不明确留空字符串。actionType 为事件核心动作的类目，必须从给定枚举中单选（发布新品选“发布”、开源项目选“开源”、公司融资选“融资”、公开回应争议选“争议回应”），无法归类选“其他”。object 为动作作用的对象或赛道的规范名（如“GPT-5”“Agent 框架”“菲尔兹奖”），同一对象必须使用同一名称，用于跨主体对比分组。occasion 为事件发生的命名场合（展会、大会、发布会、赛事的规范名称，如“WAIC”“WWDC”），不是命名场合或无法确定时输出空字符串；where 只填影响地区，不要把场合名写进 where。只有同一 who、同一 what 且时间相容的报道才属于同一事件。eventKey 由系统按 who|what 自动生成，模型无需输出。category 只能使用给定五类。地区按事件影响而不是媒体所在地。风险只标记不删除。score 是面向国内科技/互联网/职场公众号的相关度，不是社会真实热度。只输出 JSON 本身，不要解释、Markdown 围栏或任何额外文字；relevanceReason 与 riskReason 各控制在 40 字以内。`;

function hasResearchTags(item) {
  try {
    const tags = JSON.parse(item.raw_json).aiTags;
    return Boolean(tags?.eventKey && tags?.preScores);
  } catch { return false; }
}

// 事件四要素规范化：小写、去空白与标点，保证同一事件的 who|what 拼出稳定 eventKey。
export function normalizeEventPart(value) {
  return String(value ?? '').toLowerCase().replace(/[\s|｜/\\,，.。;；:：!！?？'‘’"“”「」【】\[\]()（）<>《》]+/g, '').slice(0, 40);
}

export const ACTION_TYPES = Object.freeze(['发布','开源','融资','收购','裁员','诉讼','合作','获奖','政策','人事','产品更新','研究突破','争议回应','其他']);

// actionType 必须是枚举单选；模型输出枚举外值时归一为“其他”，避免 what 维度分组键漂移。
export function normalizeActionType(value) {
  const text = String(value ?? '').trim();
  if (ACTION_TYPES.includes(text)) return text;
  const normalized = normalizeEventPart(text);
  return ACTION_TYPES.find((type) => normalizeEventPart(type) === normalized) || '其他';
}

export function normalizeEventParts(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const parts = {
    who: normalizeEventPart(raw.who),
    what: normalizeEventPart(raw.what),
    where: normalizeEventPart(raw.where),
    when: normalizeEventPart(raw.when),
    actionType: normalizeActionType(raw.actionType),
    object: normalizeEventPart(raw.object),
    occasion: normalizeEventPart(raw.occasion),
  };
  if (!parts.who || !parts.what) return null;
  // labels 保留原始写法用于展示（选题标题、关系图节点），规范化值只作分组键。
  parts.labels = {
    who: String(raw.who ?? '').trim(),
    what: String(raw.what ?? '').trim(),
    object: String(raw.object ?? '').trim(),
    occasion: String(raw.occasion ?? '').trim(),
  };
  return parts;
}

export function deriveEventKey(tag) {
  const parts = normalizeEventParts(tag?.eventParts);
  if (parts) return `${parts.who}|${parts.what}`;
  return String(tag?.eventKey || '').trim();
}

export function buildTaggingInput({ id, source, source_group, source_type, source_name, title, url, published_at, raw_json }) {
  let raw = {}; try { raw = JSON.parse(raw_json); } catch {}
  const input = { id, source:source_group||source, title, url, publishedAt:published_at,
    channel:source_name||raw.feedLabel||raw.subreddit||raw.route||source };
  const summary=String(raw.summary||'').replace(/\s+/g,' ').trim();
  if(summary) input.summary=summary.slice(0,500);
  const isRepository=source_group==='github'||source==='github'||/^https:\/\/github\.com\//i.test(String(url||''));
  if(isRepository) input.repository={
    name:raw.repository||title, description:String(raw.description||raw.summary||'').slice(0,500), language:raw.language||'',
    stars:Number.isFinite(Number(raw.stars))?Number(raw.stars):null, topics:Array.isArray(raw.topics)?raw.topics.slice(0,12):[],
    createdAt:raw.createdAt||null, updatedAt:raw.updatedAt||null,
    discoveryChannels:Array.isArray(raw.discoveryChannels)?raw.discoveryChannels:[], primaryDiscovery:raw.primaryDiscovery||source_type||'',
    trendingPeriods:Array.isArray(raw.periods)?raw.periods:raw.period?[raw.period]:[],
    mentionedBy:Array.isArray(raw.mentionedBy)?raw.mentionedBy.slice(0,3):[],
  };
  return input;
}

export async function tagBatch({ gateway, store, batchId, provider, limit, force = false, maxAgeHours = 168, onProgress = () => {} }) {
  const batch = store.getBatch(batchId);
  if (!batch) throw new Error('批次不存在');
  // 超过有效时间窗口的旧闻不会进入研判，打标纯属浪费 token，直接跳过（仍保留在批次档案中）
  const fresh = batch.hotspots.filter((item) => isFreshForBatch(item, batch.batch_date, maxAgeHours));
  const staleCount = batch.hotspots.length - fresh.length;
  if (staleCount) onProgress(`已跳过 ${staleCount} 条超过 ${maxAgeHours} 小时的旧闻，不再打标；仍保留在历史档案`);
  const available = force ? fresh : fresh.filter((item) => !hasResearchTags(item));
  const requestedLimit = limit == null ? available.length : Math.max(1, Math.min(Number(limit) || 60, 500));
  const items = available.slice(0, requestedLimit);
  const providerConfig = gateway.config.providers[provider || gateway.config.defaultProvider];
  const chunkSize = Math.max(1, Math.min(12, Number(providerConfig.taggingChunkSize) || (providerConfig.maxOutputTokens <= 2048 ? 2 : 8)));
  const concurrency = Math.max(1, Math.min(10, Number(providerConfig.taggingConcurrency) || 6));
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));
  const updatedIds = new Set();
  const failedIds = [];
  const calls = [];
  async function processChunk(chunk, label, depth = 0) {
    onProgress(`AI 语义打标 ${label}（${updatedIds.size}/${items.length} 条已完成）`);
    const result = await gateway.complete({ provider, purpose: 'hotspot-tagging', batchId, jsonMode: true,
      maxOutputTokens: Math.min(600 + chunk.length * 850, providerConfig.maxOutputTokens), messages: [
        { role: 'system', content: TAG_SYSTEM, protected: true },
        { role: 'user', content: JSON.stringify(chunk.map(buildTaggingInput)), protected: true },
      ] });
    let parsed;
    try { parsed = parseJson(result.content); }
    catch (error) {
      const reason = result.finishReason === 'length' ? '模型达到输出上限，JSON 被截断' : `模型返回的 JSON 无效：${error.message}`;
      store.updateModelCall(result.callId, { status:'invalid_output', error:reason });
      if (chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);
        onProgress(`${reason}；自动拆分为 ${middle} + ${chunk.length-middle} 条重试`);
        await processChunk(chunk.slice(0,middle), `${label}.1`, depth+1);
        await processChunk(chunk.slice(middle), `${label}.2`, depth+1);
        return;
      }
      // 单条热点反复失败不再拖垮整批：标记失败后跳过，批次结束后可用“继续打标”补打
      failedIds.push(...chunk.map((item) => item.id));
      onProgress(`${reason}；已跳过 ${chunk.length} 条（批次结束后可用“继续打标”补打）`);
      return;
    }
    const returnedIds=new Set();
    for (const tag of Array.isArray(parsed.items)?parsed.items:[]) {
      if (!chunk.some((item) => item.id === Number(tag.id))) continue;
      const eventParts = normalizeEventParts(tag.eventParts);
      const eventKey = eventParts ? `${eventParts.who}|${eventParts.what}` : String(tag.eventKey || '').trim();
      if(!eventKey||!tag.preScores||typeof tag.preScores!=='object')continue;
      returnedIds.add(Number(tag.id));
      store.updateHotspotTags(Number(tag.id), {
        ...tag,
        eventKey,
        eventParts,
        keywords: tag.keywords,
        globalException: tag.globalException,
        preScores: tag.preScores,
        credibleScoop: tag.credibleScoop,
        saturationPenalty: tag.saturationPenalty,
        duplicatePenalty: tag.duplicatePenalty,
        blackHorseSignals: tag.blackHorseSignals,
      });
      updatedIds.add(Number(tag.id));
    }
    const missing=chunk.filter((item)=>!returnedIds.has(item.id));
    if(missing.length) {
      const reason=`模型只返回 ${chunk.length-missing.length}/${chunk.length} 条有效标注`;
      store.updateModelCall(result.callId,{status:'invalid_output',error:reason});
      if(depth<2) { onProgress(`${reason}；只重试缺失的 ${missing.length} 条`); await processChunk(missing,`${label}.M`,depth+1); }
      else { failedIds.push(...missing.map((item) => item.id)); onProgress(`${reason}；已跳过 ${missing.length} 条（批次结束后可用“继续打标”补打）`); }
    }
    calls.push({ model: result.model, compressed: result.context.compressed,
      inputTokens: result.usage.prompt_tokens ?? result.context.afterTokens,
      outputTokens: result.usage.completion_tokens ?? null });
  }
  // 持续补位的工作池：某批完成后立即领取下一批，避免被同一波次中的慢请求阻塞。
  let nextChunkIndex = 0;
  async function worker() {
    while (nextChunkIndex < chunks.length) {
      const index = nextChunkIndex++;
      await processChunk(chunks[index], `${index + 1}/${chunks.length}`);
    }
  }
  const workerCount = Math.min(concurrency, chunks.length);
  onProgress(items.length ? `准备打标 ${items.length} 条：${chunks.length} 批，并发 ${workerCount}` : '本批热点已经全部完成语义打标');
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  onProgress(items.length ? `语义打标完成：${updatedIds.size}/${items.length}${failedIds.length ? `，${failedIds.length} 条失败已跳过` : ''}` : '本批热点已经全部完成语义打标');
  return { requested: items.length, updated:updatedIds.size, failed:failedIds.length, failedIds, skipped: batch.hotspots.length - items.length, skippedStale: staleCount, chunks:chunks.length, concurrency:workerCount, calls };
}

export async function draftArticle({ gateway, store, candidateId, provider, instructions = '', existingDraft = '' }) {
  const candidate = store.getCandidate(candidateId);
  if (!candidate) throw new Error('候选不存在');
  if (candidate.editorial.brief_status !== 'LOCKED') throw new Error('必须先锁定 article-brief.md 才能调用创作模型');
  const brief = {
    title: candidate.hotspot_title, sourceUrl: candidate.url, angle: candidate.angle, thesis: candidate.thesis,
    confirmedFacts: candidate.editorial.confirmed_facts,
    authorOpinions: candidate.editorial.author_opinions,
    confirmedExperiences: candidate.editorial.confirmed_experiences,
    rejectedAngles: candidate.editorial.rejected_angles,
    forbiddenClaims: candidate.editorial.forbidden_claims,
  };
  const messages = [
    { role: 'system', content: `你是公众号文章编辑。必须严格服从锁定简报，不得虚构事实、引语、数据或作者经历。事实不足处明确写“待核验”，不要用流畅表达掩盖证据缺口。

重要规则：只输出 Markdown 正文，不要输出任何操作说明、摘要、编辑记录或“已按照您的要求更新正文”等元文本。输出的第一行必须是正文标题。`, protected: true },
    { role: 'user', content: `【锁定简报】\n${JSON.stringify(brief, null, 2)}`, protected: true },
  ];
  if (existingDraft.trim()) messages.push({ role: 'assistant', content: `【现有草稿】\n${existingDraft}`, protected: false });
  messages.push({ role: 'user', content: `【本轮编辑要求】\n${instructions.trim() || '按锁定简报生成一版结构完整的初稿。'}`, protected: true });
  return gateway.complete({ provider, purpose: 'article-drafting', batchId: candidate.batch_id,
    candidateId, maxOutputTokens: 5000, temperature: 0.55, messages });
}
