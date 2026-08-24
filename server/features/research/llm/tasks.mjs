import { isFreshForBatch } from '../index.mjs';
import { isResearchEligibleHotspot } from '../domain/hotspot-pipeline-scope.mjs';
import { selectionPrompt } from './selection-prompts.mjs';

function parseJson(content) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

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

export async function tagBatch({ gateway, store, batchId, provider, limit, hotspotIds = null, force = false, maxAgeHours = 168, workspaceRoot, runId = null, onProgress = () => {} }) {
  const { prompt: tagSystem } = selectionPrompt({ workspaceRoot, skillName: 'hotspot-tagging' });
  const batch = store.getBatch(batchId);
  if (!batch) throw new Error('批次不存在');
  // 超过有效时间窗口的旧闻不会进入研判，打标纯属浪费 token，直接跳过（仍保留在批次档案中）
  const scoped = batch.hotspots.filter(isResearchEligibleHotspot);
  const fresh = scoped.filter((item) => isFreshForBatch(item, batch.batch_date, maxAgeHours));
  const staleCount = scoped.length - fresh.length;
  if (staleCount) onProgress(`已跳过 ${staleCount} 条超过 ${maxAgeHours} 小时的旧闻，不再打标；仍保留在历史档案`);
  const requestedIds=Array.isArray(hotspotIds)?new Set(hotspotIds.map(Number)):null;
  const targeted=requestedIds?fresh.filter((item)=>requestedIds.has(item.id)):fresh;
  const available = force ? targeted : targeted.filter((item) => !hasResearchTags(item));
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
  const recordFailures = (failedItems, errorMessage, detail = {}) => {
    for (const item of failedItems) store.recordPipelineFailure?.({
      batchId, runId, stage: 'tag', objectType: 'hotspot', objectKey: `hotspot:${item.id}`,
      hotspotId: item.id, title: item.title, url: item.url || null, errorCode: detail.errorCode || 'tag_failed',
      errorMessage, detail: { source: item.source, sourceType: item.source_type, ...detail },
    });
  };
  // 单批模型调用失败（超时 / 空内容 / 网络中断）不再拖垮整批：先按对侧 thinking 重试一次，
  // 仍失败则抛给上层标记跳过，批次结束后可用「继续打标」补打。
  async function completeChunk(chunk, thinking) {
    const call = (useThinking) => gateway.complete({ provider, purpose: 'hotspot-tagging', batchId, jsonMode: true,
      thinking: useThinking ? true : undefined,
      maxOutputTokens: Math.min(600 + chunk.length * 850, providerConfig.maxOutputTokens), messages: [
        { role: 'system', content: tagSystem, protected: true },
        { role: 'user', content: JSON.stringify(chunk.map(buildTaggingInput)), protected: true },
      ] });
    try {
      return await call(thinking);
    } catch (error) {
      onProgress(`模型调用失败：${error.message}`);
      onProgress(thinking ? '回落无思考重试一次（释放推理预算）' : '补开 thinking 重试一次');
      return call(!thinking);
    }
  }
  async function processChunk(chunk, label, depth = 0, thinking = false) {
    onProgress(`AI 语义打标 ${label}（${updatedIds.size}/${items.length} 条已完成）`);
    let result;
    try {
      result = await completeChunk(chunk, thinking);
    } catch (error) {
      failedIds.push(...chunk.map((item) => item.id));
      recordFailures(chunk, error.message, { errorCode: 'model_call_failed', thinking });
      onProgress(`打标调用失败，已跳过 ${chunk.length} 条（批次结束后可用「继续打标」补打）：${error.message}`);
      return;
    }
    let parsed;
    try { parsed = parseJson(result.content); }
    catch (error) {
      const reason = result.finishReason === 'length' ? '模型达到输出上限，JSON 被截断' : `模型返回的 JSON 无效：${error.message}`;
      store.updateModelCall(result.callId, { status:'invalid_output', error:reason });
      // 非思考模式下模型可能退化（回显输入/截断），开启 thinking 重试一次再进入拆分逻辑
      if (!thinking) {
        onProgress(`${reason}；开启 thinking 重试`);
        await processChunk(chunk, `${label}.T`, depth, true);
        return;
      }
      if (chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);
        onProgress(`${reason}；自动拆分为 ${middle} + ${chunk.length-middle} 条重试`);
        // 此处 reachable 时 thinking 必为 true（非思考首轮失败已在上方开启 thinking 重试），
        // 拆分后必须继续携带 thinking，否则刚打开的状态又被关闭、退化问题复现。
        await processChunk(chunk.slice(0,middle), `${label}.1`, depth+1, thinking);
        await processChunk(chunk.slice(middle), `${label}.2`, depth+1, thinking);
        return;
      }
      // 单条热点反复失败不再拖垮整批：标记失败后跳过，批次结束后可用“继续打标”补打
      failedIds.push(...chunk.map((item) => item.id));
      recordFailures(chunk, reason, { errorCode: result.finishReason === 'length' ? 'json_truncated' : 'invalid_json',
        modelCallId: result.callId, thinking, depth });
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
      // 整组 0 条有效标注通常是模型回显输入（items 里没有 preScores/eventKey），开启 thinking 重试一次
      if (!thinking && returnedIds.size === 0) {
        onProgress(`${reason}；疑似模型回显输入，开启 thinking 重试`);
        await processChunk(chunk, `${label}.T`, depth, true);
        return;
      }
      if(depth<2) { onProgress(`${reason}；只重试缺失的 ${missing.length} 条`); await processChunk(missing,`${label}.M`,depth+1,thinking); }
      else { failedIds.push(...missing.map((item) => item.id));
        recordFailures(missing, reason, { errorCode: 'missing_valid_tag', modelCallId: result.callId, thinking, depth });
        onProgress(`${reason}；已跳过 ${missing.length} 条（批次结束后可用“继续打标”补打）`); }
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
