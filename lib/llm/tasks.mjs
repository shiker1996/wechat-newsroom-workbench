function parseJson(content) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

const TAG_SYSTEM = `你是公众号热点语义标注与全量预评估器。只根据标题、来源、链接、发布时间和输入元数据判断，不补写未提供的事实。
返回严格 JSON：{"items":[{"id":数字,"category":"🤖 AI/技术动态|📰 综合资讯|🏢 大厂战略|📈 行业趋势|💼 职场生态","marketScope":"国内|全球性|国外","chinaRelevance":0到12整数,"relevanceReason":字符串,"riskLevel":"低|中|高","riskReason":字符串,"score":0到100整数,"eventKey":字符串,"keywords":[字符串],"globalException":布尔,"preScores":{"conflict":0到20,"audience":0到20,"informationGain":0到15,"emotion":0到15,"timeliness":0到10,"impact":0到10,"sourceReliability":0到10},"credibleScoop":0到12,"saturationPenalty":0到15,"duplicatePenalty":0到10,"blackHorseSignals":["信息稀缺|搜索需求|个人利益|差异角度|上升迹象"]}]}。
eventKey 必须是“核心主体|核心动作或事实|对象或时间窗口”的语义指纹；只有同一主体、同一动作/事实且时间相容的报道才能给相同 eventKey。同公司不同发布、评论文章与新增事实必须分开。category 只能使用给定五类。地区按事件影响而不是媒体所在地。风险只标记不删除。score 是面向国内科技/互联网/职场公众号的相关度，不是社会真实热度。`;

function hasResearchTags(item) {
  try {
    const tags = JSON.parse(item.raw_json).aiTags;
    return Boolean(tags?.eventKey && tags?.preScores);
  } catch { return false; }
}

export async function tagBatch({ gateway, store, batchId, provider, limit, force = false, onProgress = () => {} }) {
  const batch = store.getBatch(batchId);
  if (!batch) throw new Error('批次不存在');
  const available = force ? batch.hotspots : batch.hotspots.filter((item) => !hasResearchTags(item));
  const requestedLimit = limit == null ? available.length : Math.max(1, Math.min(Number(limit) || 60, 500));
  const items = available.slice(0, requestedLimit);
  const providerConfig = gateway.config.providers[provider || gateway.config.defaultProvider];
  const chunkSize = providerConfig.maxOutputTokens <= 2048 ? 2 : 5;
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));
  const updatedIds = new Set();
  const calls = [];
  async function processChunk(chunk, label, depth = 0) {
    onProgress(`AI 语义打标 ${label}（${updatedIds.size}/${items.length} 条已完成）`);
    const result = await gateway.complete({ provider, purpose: 'hotspot-tagging', batchId, jsonMode: true,
      maxOutputTokens: Math.min(4200, providerConfig.maxOutputTokens), messages: [
        { role: 'system', content: TAG_SYSTEM, protected: true },
        { role: 'user', content: JSON.stringify(chunk.map(({ id, source, source_group, source_name, title, url, published_at, raw_json }) => {
          let raw = {}; try { raw = JSON.parse(raw_json); } catch {}
          return { id, source:source_group||source, title, url, publishedAt: published_at, channel:source_name||raw.feedLabel||raw.subreddit||raw.route||source };
        })), protected: true },
      ] });
    let parsed;
    try { parsed = parseJson(result.content); }
    catch (error) {
      const reason = result.finishReason === 'length' ? '模型达到输出上限，JSON 被截断' : `模型返回的 JSON 无效：${error.message}`;
      store.updateModelCall(result.callId, { status:'invalid_output', error:reason });
      if (chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);
        onProgress(`${reason}；自动拆分为 ${middle} + ${chunk.length-middle} 条重试`);
        await processChunk(chunk.slice(0,middle), `${label}.1`);
        await processChunk(chunk.slice(middle), `${label}.2`);
        return;
      }
      throw new Error(`${reason}；单条热点重试仍失败`);
    }
    const returnedIds=new Set();
    for (const tag of Array.isArray(parsed.items)?parsed.items:[]) {
      if (!chunk.some((item) => item.id === Number(tag.id))) continue;
      if(!String(tag.eventKey||'').trim()||!tag.preScores||typeof tag.preScores!=='object')continue;
      returnedIds.add(Number(tag.id));
      store.updateHotspotTags(Number(tag.id), {
        ...tag,
        eventKey: tag.eventKey,
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
      else throw new Error(`${reason}；缺失条目重试仍失败`);
    }
    calls.push({ model: result.model, compressed: result.context.compressed,
      inputTokens: result.usage.prompt_tokens ?? result.context.afterTokens,
      outputTokens: result.usage.completion_tokens ?? null });
  }
  // 并行打标：最多同时跑 4 批
  const parallel = 4;
  for (let i = 0; i < chunks.length; i += parallel) {
    const batch = chunks.slice(i, i + parallel);
    await Promise.all(batch.map((chunk, j) => processChunk(chunk, `${i + j + 1}/${chunks.length}`)));
  }
  onProgress(items.length ? `语义打标完成：${updatedIds.size}/${items.length}` : '本批热点已经全部完成语义打标');
  return { requested: items.length, updated:updatedIds.size, skipped: batch.hotspots.length - items.length, calls };
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
