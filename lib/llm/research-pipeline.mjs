import fs from 'node:fs';
import path from 'node:path';

const CATEGORIES = ['🤖 AI/技术动态','📰 综合资讯','🏢 大厂战略','📈 行业趋势','💼 职场生态'];
const CATEGORY_PREFERENCE = { '🏢 大厂战略': 6, '🤖 AI/技术动态': 4, '📈 行业趋势': 3, '📰 综合资讯': 1, '💼 职场生态': 0 };
const P_BASE = { '🏢 大厂战略': 50, '🤖 AI/技术动态': 40, '📈 行业趋势': 30, '📰 综合资讯': 20, '💼 职场生态': 10 };
const H_BASE = { worker_social: 48, bigtech: 33, owned_experience: 35, controversial_return: 30, key_person_move: 33, github_tool: 25, ai_tool_test: 25, financing: 10, career_anxiety: 5, contrarian_bigtech: 35 };

function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
function parseJson(content) { return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
function parseModelJson(result, store) {
  try { return parseJson(result.content); }
  catch (error) {
    const reason = result.finishReason === 'length' ? '模型达到输出上限，JSON 被截断' : `模型返回的 JSON 无效：${error.message}`;
    store.updateModelCall(result.callId,{status:'invalid_output',error:reason});
    throw new Error(reason);
  }
}
function tagsOf(item) { try { return JSON.parse(item.raw_json).aiTags ?? {}; } catch { return {}; } }
function provenanceOf(item) {
  let raw={}; try { raw=JSON.parse(item.raw_json); } catch {}
  if(item.source_name) return {source:item.source_name,channel:raw.route||item.source_name};
  if((item.source_group==='rsshub'||item.source==='rsshub')&&raw.route) {
    const slug=String(raw.route).split('?')[0].split('/').filter(Boolean)[0]||'rsshub';
    const labels={latepost:'晚点 LatePost',huxiu:'虎嗅',techcrunch:'TechCrunch',anthropic:'Anthropic',jiemian:'界面新闻',readhub:'ReadHub',solidot:'Solidot',openai:'OpenAI','36kr':'36氪'};
    return {source:labels[slug]||`RSSHub · ${slug}`,channel:String(raw.route).split('?')[0]};
  }
  if(item.source_group==='reddit'||item.source==='reddit') return {source:'Reddit',channel:raw.subreddit?`r/${raw.subreddit}`:'Reddit'};
  return {source:item.source,channel:item.source};
}
function safeKey(value, id) { return String(value || `singleton-${id}`).trim().toLowerCase().replace(/\s+/g, ' '); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8'); fs.renameSync(temporary, filePath);
  const stat = fs.statSync(filePath);
  return { size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

export function isFreshForBatch(item, batchDate, maxAgeHours = 168) {
  const published = Date.parse(item.published_at || '');
  if (!Number.isFinite(published)) return true;
  const reference = Date.parse(`${batchDate}T23:59:59+08:00`);
  return published >= reference - maxAgeHours*60*60*1000 && published <= reference + 6*60*60*1000;
}

export function deterministicTimeliness(value, batchDate) {
  const published=Date.parse(value||''); const reference=Date.parse(`${batchDate}T23:59:59+08:00`);
  if(!Number.isFinite(published)||!Number.isFinite(reference)) return 0;
  const hours=(reference-published)/3600000;
  if(hours< -6) return 0; if(hours<=24) return 10; if(hours<=48) return 8; if(hours<=72) return 6; if(hours<=168) return 3; return 0;
}

function accountSnapshot(workspaceRoot) {
  const candidates = [
    ['账号上下文', path.join(workspaceRoot, '.agents', 'wechat-account-context.md')],
    ['兼容账号档案', path.join(workspaceRoot, '.agents', 'product-marketing.md')],
    ['作者资产', path.join(workspaceRoot, '.agents', 'wechat-author-assets.md')],
  ];
  const found = candidates.filter(([, file]) => fs.existsSync(file)).map(([label, file]) => ({ label, file, content: fs.readFileSync(file, 'utf8').slice(0, 16000) }));
  return found.length ? found : [{ label: '降级模式', file: '', content: '未找到账号或作者资产档案。使用公众号历史校准与默认读者：国内科技、互联网与职场读者；不得虚构作者经历。' }];
}

export function clusterItems(items) {
  const groups = new Map();
  for (const item of items) {
    const tags = tagsOf(item); const key = safeKey(tags.eventKey, item.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, tags });
  }
  return [...groups.values()].map((members, index) => {
    members.sort((a,b) => Number(b.item.score || 0) - Number(a.item.score || 0) || a.item.id - b.item.id);
    const lead = members[0]; const provenances=members.map(({item})=>provenanceOf(item));
    return {
      event_id: `E${String(index + 1).padStart(4,'0')}`,
      representative_title: lead.item.title,
      representativeHotspotId: lead.item.id,
      market_scope: lead.item.market_scope,
      china_relevance_score: clamp(lead.tags.chinaRelevance, 0, 12),
      china_relevance_reason: lead.tags.relevanceReason || '模型未提供具体理由，需编辑核验',
      global_exception: Boolean(lead.tags.globalException),
      topic_category: CATEGORIES.includes(lead.item.category) ? lead.item.category : '📰 综合资讯',
      keywords: [...new Set(members.flatMap((m) => m.tags.keywords || []))].slice(0, 8),
      source_count: new Set(provenances.map((source) => source.source)).size,
      report_count: members.length,
      peak_source_percentile: null,
      latest_time: members.map((m) => m.item.published_at).filter(Boolean).sort().at(-1) || null,
      cluster_confidence: members.length > 1 ? 'medium' : 'low',
      articles: members.map(({ item, tags },articleIndex) => ({ category_id: `G${String(item.id).padStart(5,'0')}`, hotspot_id: item.id,
        title: item.title, source: provenances[articleIndex].source, channel:provenances[articleIndex].channel, url: item.url, heat: item.score, time: item.published_at,
        risk_level: tags.riskLevel || '待评估' })),
      tags: lead.tags,
    };
  });
}

export function preselection(clusters, batchDate = new Date().toISOString().slice(0,10)) {
  return clusters.map((event) => {
    const p = event.tags.preScores ?? {};
    const parts = {
      conflict: clamp(p.conflict,0,20), audience: clamp(p.audience,0,20), informationGain: clamp(p.informationGain,0,15),
      emotion: clamp(p.emotion,0,15), timeliness: deterministicTimeliness(event.latest_time,batchDate), impact: clamp(p.impact,0,10),
      sourceReliability: clamp(p.sourceReliability,0,10),
    };
    const base = Object.values(parts).reduce((sum,n) => sum+n, 0);
    const categoryPreference = CATEGORY_PREFERENCE[event.topic_category] ?? 0;
    const credibleScoop = clamp(event.tags.credibleScoop,0,12);
    const saturationPenalty = clamp(event.tags.saturationPenalty,0,15);
    return { eventId:event.event_id, hotspotId:event.representativeHotspotId, title:event.representative_title,
      category:event.topic_category, marketScope:event.market_scope, chinaRelevance:event.china_relevance_score,
      riskLevel:event.tags.riskLevel || '待评估', riskReason:event.tags.riskReason || '', preScores:parts, base,
      categoryPreference, credibleScoop, saturationPenalty,
      blackHorseSignals:event.tags.blackHorseSignals || [], finalPreScore:base+categoryPreference+credibleScoop-saturationPenalty };
  }).sort((a,b) => b.finalPreScore-a.finalPreScore || b.credibleScoop-a.credibleScoop || b.preScores.informationGain-a.preScores.informationGain || a.title.localeCompare(b.title));
}

  export function choosePool(ranking, account) {
  const pillarCategories = {'AI 行业热点':['🤖 AI/技术动态','🏢 大厂/商业'],'大厂战略':['🏢 大厂/商业','🤖 AI/技术动态'],'开源与工程实践':['🤖 AI/技术动态','📱 产品/消费'],'技术认知':['📚 行业/趋势'],'程序员成长':['💼 职场/职业']};
  const contentPillars = account?.contentPillars || [];
  const focusedCats = new Set(contentPillars.flatMap(p => pillarCategories[p] || []));
  const bannedCats = new Set(['🌐 社会/舆论']);
  function eliminationReason(item) {
    const parts = [];
    if (item.marketScope === '国外' && (item.chinaRelevance || 0) <= 3) parts.push('市场范围为国外且国内相关度低');
    if (item.finalPreScore < 30) parts.push('综合预选得分过低(' + item.finalPreScore + '分)');
    if (item.saturationPenalty > 5) parts.push('同类饱和度较高(减值' + item.saturationPenalty + '分)');
    if ((item.preScores?.informationGain || 10) < 4) parts.push('信息增量不足');
    if (item.riskLevel === '高' || item.riskLevel === '较高') parts.push('风险等级: ' + (item.riskLevel || '') + ' ' + (item.riskReason || ''));
    if (bannedCats.has(item.category)) { item.finalPreScore -= 30; parts.push('话题分类与账号定位不匹配'); }
    else if (focusedCats.size > 0 && !focusedCats.has(item.category)) { item.finalPreScore -= 10; item.reRank = true; }
    if (!parts.length && item.preRank > 13) parts.push('综合排名第' + item.preRank + '，超出选题名额');
    if (!parts.length) parts.push('综合竞争力不足(预选分' + item.finalPreScore + ')');
    return parts.join('；');
  }
  ranking.forEach((item,index) => { item.preRank=index+1; item.poolRole='未入选'; item.eliminationReason=''; });
  const eligible = ranking.filter((item) => item.marketScope !== '国外' || item.chinaRelevance > 3);
  const core = eligible.slice(0,8);
  if (core.length < 8) core.push(...ranking.filter((item) => !core.includes(item)).slice(0,8-core.length));
  core.forEach((item) => item.poolRole='核心8条');
  const remaining = ranking.filter((item) => !core.includes(item));
  const black = [...remaining].sort((a,b) => b.blackHorseSignals.length-a.blackHorseSignals.length || b.finalPreScore-a.finalPreScore).slice(0,2);
  black.forEach((item) => item.poolRole='黑马2条');
  const backup = remaining.filter((item) => !black.includes(item)).slice(0,3);
  backup.forEach((item) => item.poolRole='候补3条');
  // 未入选的保留 eliminationReason
  for (const item of ranking) {
    if (item.poolRole === '未入选') item.eliminationReason = eliminationReason(item);
  }
  return { selected:[...core,...black], backup };
}

const BRAINSTORM_SYSTEM = `你是热点探索编辑。不得补造事实、作者经历、引语或数据。对输入候选生成临时探索卡，不代表作者最终立场。风险只标记不删除。
返回严格 JSON：{"items":[{"candidateId":字符串,"status":"PASS|NO_ANGLE","angle":字符串,"thesis":字符串,"hypotheses":[{"claim":字符串,"support":字符串,"counter":字符串,"verify":字符串,"readerValue":字符串}],"evidenceBoundary":字符串,"counterEvidence":字符串,"editorQuestion":字符串,"writeReadiness":"READY_PUBLIC_ANALYSIS|NEED_AUTHOR_INPUT|NEED_EXPERIMENT|SHORT_COMMENT_ONLY|SKIP","packaging":{"contentPillar":字符串,"readerJob":字符串,"mode":"搜索型|分享型|双栖型","titleDirection":字符串,"hook":字符串,"outline":[字符串],"practicalIncrement":字符串,"materialGaps":字符串},"bScores":{"angleUniqueness":0到5,"emotionSpread":0到5,"titleHook":0到5,"audienceRelevance":0到5,"factSupport":0到5},"hProfile":{"historicalType":"worker_social|bigtech|owned_experience|controversial_return|key_person_move|github_tool|ai_tool_test|financing|career_anxiety|contrarian_bigtech","fiveSenseCount":0到5,"fiveQuestionCount":0到5,"recommendationFit":0到10,"emotionTheme":0到10,"searchFriendly":0到5},"materialType":字符串,"format":"文章|贴图","recommendedSkill":字符串}]}。
每条只给2个互不等价命题和反证；outline只给3项。除标题外，每个字符串控制在80个汉字以内。没有可靠事实支撑时降低 factSupport 并写明待核验，不能用流畅包装掩盖证据缺口。不要输出 Markdown、解释或 JSON 之外的文字。`;

export async function brainstorm(gateway, store, selected, account, batchId, provider, onProgress) {
  const cards = [];
  const providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];
  const candidates=selected.map((item,index)=>({...item,candidateId:`C${String(index+1).padStart(3,'0')}`}));
  async function processGroup(group,label,retry=false) {
    onProgress(`探索脑暴 ${label}（已完成 ${cards.length}/${selected.length}）`);
    const result = await gateway.complete({ provider, purpose:'hotspot-brainstorm-explore', batchId, jsonMode:true,
      messages:[{role:'system',content:BRAINSTORM_SYSTEM,protected:true},
        {role:'user',content:`${retry?'【极简重试】每个字符串不超过40个汉字，严格闭合JSON。\n':''}【账号与作者资产】\n${account.map((x)=>`${x.label}:\n${x.content}`).join('\n\n')}\n\n【候选】\n${JSON.stringify(group)}`,protected:true}] ,
      maxOutputTokens:Math.min(6500,providerConfig.maxOutputTokens) });
    let parsed;
    try { parsed=parseModelJson(result,store); }
    catch(error) {
      if(group.length>1) {
        const middle=Math.ceil(group.length/2); onProgress(`脑暴输出被截断；自动拆分为 ${middle} + ${group.length-middle} 条重试`);
        await processGroup(group.slice(0,middle),`${label}.1`); await processGroup(group.slice(middle),`${label}.2`); return;
      }
      if(!retry) { onProgress('单张分析卡仍过长，切换极简结构重试'); await processGroup(group,`${label}.R`,true); return; }
      throw error;
    }
    for (const raw of parsed.items ?? []) {
      const source = group.find((item) => item.candidateId === raw.candidateId);
      if (source) cards.push({ ...raw, source });
    }
  }
  for(let i=0;i<candidates.length;i+=2) await processGroup(candidates.slice(i,i+2),`${Math.floor(i/2)+1}/${Math.ceil(candidates.length/2)}`);
  return cards;
}

const SYNTHESIS_SYSTEM = `你是热点综合研判器。比较全部临时包装后，只输出竞争修正，不直接计算最终总分。返回严格 JSON：{"items":[{"candidateId":字符串,"saturationPenalty":0到15,"audienceRelevance":0到5,"reason":字符串}],"metaNarratives":[字符串],"combination":{"primary":字符串,"stable":字符串,"darkHorse":字符串,"reason":字符串}}。S 是同类内容与角度饱和度（市场同类选题泛滥程度）。风险标签不构成淘汰理由。reason不超过40个汉字，metaNarratives最多3条且每条不超过50字。不要输出JSON之外的文字。`;

export async function synthesize(gateway, store, cards, batchId, provider, onProgress) {
  onProgress('执行全局竞争、受众与重复扫描');
  const compact = cards.map((card) => ({ candidateId:card.candidateId, title:card.source.title, category:card.source.category,
    poolRole:card.source.poolRole, angle:card.angle, thesis:card.thesis, packaging:card.packaging, bScores:card.bScores,
    riskLevel:card.source.riskLevel }));
  const providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];
  for(let attempt=0;attempt<2;attempt+=1) {
    const result = await gateway.complete({ provider, purpose:'hotspot-synthesis-provisional', batchId, jsonMode:true,
      maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens), messages:[{role:'system',content:SYNTHESIS_SYSTEM,protected:true},
        {role:'user',content:`${attempt?'极简重试：reason缩短到20字。\n':''}${JSON.stringify(compact)}`,protected:true}] });
    try { return parseModelJson(result,store); }
    catch(error) { if(attempt) throw error; onProgress('综合复排输出被截断，切换极简结构重试'); }
  }
}

export function scoreCards(cards, synthesis) {
  const corrections = new Map((synthesis.items ?? []).map((item) => [item.candidateId,item]));
  return cards.filter((card) => card.status !== 'NO_ANGLE').map((card) => {
    const b = card.bScores ?? {}; const hp = card.hProfile ?? {}; const correction = corrections.get(card.candidateId) ?? {};
    const audience = correction.audienceRelevance == null ? clamp(b.audienceRelevance,0,5) : clamp(correction.audienceRelevance,0,5);
    const bParts = [clamp(b.angleUniqueness,0,5),clamp(b.emotionSpread,0,5),clamp(b.titleHook,0,5),audience,clamp(b.factSupport,0,5)];
    const B = bParts.reduce((s,n)=>s+n,0)*4;
    const H = clamp((H_BASE[hp.historicalType] ?? 10) + clamp(hp.fiveSenseCount,0,5)*2 + clamp(hp.fiveQuestionCount,0,5)*5 + clamp(hp.recommendationFit,0,10) + clamp(hp.emotionTheme,0,10) + clamp(hp.searchFriendly,0,5),0,100);
    const P = clamp((P_BASE[card.source.category] ?? 20) + (card.source.category === '🏢 大厂战略' ? card.source.credibleScoop/12*50 : 0),0,100);
    const S = clamp(correction.saturationPenalty,0,15); const D=0;
    const F = clamp(H*.60+B*.25+P*.15-S,0,100);
    return { ...card, h:H, b:B, p:P, s:S, d:D, f:Number(F.toFixed(1)), bParts,
      synthesisReason:correction.reason || '', audienceRelevance:audience };
  }).sort((a,b) => b.f-a.f || a.candidateId.localeCompare(b.candidateId)).map((item,index) => ({...item,finalRank:index+1}));
}

function markdownAgenda(scored) {
  return `# 编辑议题卡（探索阶段）\n\n> 临时包装不代表作者最终立场。进入成稿前必须完成编辑会并锁定 article-brief.md。\n\n${scored.map((c) => `## ${c.candidateId} · ${c.source.title}\n\n- 原分类：${c.source.category}\n- 入池身份：${c.source.poolRole}\n- 合规风险：${c.source.riskLevel} ${c.source.riskReason || ''}\n- 表面新闻：${c.source.title}\n- 临时角度：${c.angle}\n- 临时命题：${c.thesis}\n- 事实边界：${c.evidenceBoundary || '待核验'}\n- 反证/替代解释：${c.counterEvidence || '待补充'}\n- 写作就绪度：${c.writeReadiness}\n- 当前关键问题：${c.editorQuestion}\n\n### 可验证命题\n${(c.hypotheses||[]).map((h,i)=>`${i+1}. **${h.claim}**\n   - 支持：${h.support}\n   - 反证：${h.counter}\n   - 待核验：${h.verify}\n   - 读者价值：${h.readerValue}`).join('\n')}\n\n### 临时包装\n- 内容支柱：${c.packaging?.contentPillar || '探索项'}\n- 读者任务：${c.packaging?.readerJob || '待明确'}\n- 模式：${c.packaging?.mode || '待定'}\n- 标题方向：${c.packaging?.titleDirection || ''}\n- 开头钩子：${c.packaging?.hook || ''}\n- 实用增量：${c.packaging?.practicalIncrement || '暂无'}\n- 素材缺口：${c.packaging?.materialGaps || '待核验'}\n\n---`).join('\n\n')}`;
}

function markdownRanked(scored, synthesis) {
  const grade = (f) => f>=85?'S+':f>=70?'S':f>=55?'A+':f>=40?'A':f>=25?'B':'C';
  return `# 综合选题研判报告（临时排名，待编辑会确认）\n\n## 爆款总榜\n\n| # | 身份 | 分类 | 选题 | H | B | P | S | F | 等级 | 风险 |\n|---:|---|---|---|---:|---:|---:|---:|:---:|---|\n${scored.map((c)=>`| ${c.finalRank} | ${c.source.poolRole} | ${c.source.category} | ${c.source.title.replace(/\|/g,'/')} | ${c.h} | ${c.b} | ${c.p.toFixed(1)} | ${c.s} | ${c.f} | ${grade(c.f)} | ${c.source.riskLevel} |`).join('\n')}\n\n## 综合研判\n\n### 元叙事\n${(synthesis.metaNarratives||[]).map((x)=>`- ${x}`).join('\n') || '- 暂无明确跨题元叙事'}\n\n### 组合推荐\n- 主推：${synthesis.combination?.primary || '待定'}\n- 稳定：${synthesis.combination?.stable || '待定'}\n- 黑马：${synthesis.combination?.darkHorse || '待定'}\n- 理由：${synthesis.combination?.reason || ''}\n\n## 逐条评分\n\n${scored.map((c)=>`### #${c.finalRank} ${c.candidateId} · ${c.source.title}\n- H/B/P/S/F：${c.h}/${c.b}/${c.p.toFixed(1)}/${c.s}/${c.f}\n- 脑暴五项：${c.bParts.join('/')}\n- 核心角度：${c.angle}\n- 临时命题：${c.thesis}\n- 受众与竞争校正：${c.synthesisReason || '无额外校正'}\n- 合规风险：${c.source.riskLevel} ${c.source.riskReason || ''}\n- 推荐技能：${c.recommendedSkill || 'wechat-mp-deep-dive'}\n`).join('\n')}\n\n*评分公式：F = H×60% + B×25% + P×15% - S*\n`;
}

function overviewHtml(clusters) {
  const payload = clusters.map(({tags,representativeHotspotId,...event})=>event);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>热点全量事件聚类</title><style>body{font:14px/1.65 system-ui;background:#f4f0e6;color:#17201e;margin:0;padding:32px}main{max-width:1100px;margin:auto}h1{font:700 34px Georgia,serif}.note{border-left:5px solid #e44b3f;padding:12px;background:#fff}.event{background:#fff;border:1px solid #d8d0c0;margin:12px 0;padding:18px}.event b{color:#c53b31}.links a{display:block;color:#355f55;margin:4px 0}</style><main><h1>热点全量事件聚类</h1><p class="note">展示本批采集覆盖结构，不等于真实舆情热度或事实可信度。共 ${payload.reduce((s,e)=>s+e.report_count,0)} 条报道、${payload.length} 个事件。</p>${payload.sort((a,b)=>b.source_count-a.source_count||b.report_count-a.report_count).map((e)=>`<article class="event"><b>${e.source_count} 个来源 / ${e.report_count} 条报道</b><h2>${esc(e.representative_title)}</h2><p>${esc(e.topic_category)} · ${esc(e.market_scope)} · 国内相关度 ${e.china_relevance_score}/12</p><p>${esc(e.china_relevance_reason)}</p><div class="links">${e.articles.map((a)=>a.url?`<a href="${esc(a.url)}">${esc(a.source)} · ${esc(a.title)}</a>`:`<span>${esc(a.source)} · ${esc(a.title)}</span>`).join('')}</div></article>`).join('')}</main></html>`;
}

const GENERIC_WORDS_HOTWORD = new Set(['ai','公司','发布','消息','最新','回应','宣布','科技','行业','全球','技术','产品','平台','企业','市场','今日','新闻']);

const HOTWORD_SUMMARIZE_SYSTEM = `你是热词综述生成器。你会看到一批按热词聚合的事件簇报道，每个热词对应多篇来自不同来源的文章，它们围绕同一议题但可能涉及多个子事件。
请为每个热词生成一段综合性的跨事件摘要（中文，200字以内），要求：
1. 说明该热词下正在发生什么核心叙事
2. 提及该热词相关的多篇文章的不同视角和来源
3. 指出多篇文章之间如何互补或存在分歧
4. 总结对国内科技/互联网受众的意义
5. 语言凝练，适合作为综合选题的依据

返回 JSON 数组：
[{"hotword":"热词","summary":"跨事件综述...","event_count":3}]`;

export async function summarizeHotWords({ gateway, store, clusters, batchId, provider, onProgress }) {
  const providerConfig = gateway.config.providers[provider || gateway.config.defaultProvider];
  // Build hotword -> events mapping from cluster keywords
  const hotwordEvents = new Map();
  for (const event of clusters) {
    const keywords = event.keywords || [];
    for (const kw of keywords) {
      const word = String(kw).trim().toLowerCase();
      if (!word || GENERIC_WORDS_HOTWORD.has(word)) continue;
      if (!hotwordEvents.has(word)) hotwordEvents.set(word, { hotword: kw, events: new Map() });
      const group = hotwordEvents.get(word);
      if (!group.events.has(event.event_id)) {
        group.events.set(event.event_id, {
          event_id: event.event_id,
          representative_title: event.representative_title,
          source_count: event.source_count,
          report_count: event.report_count,
          articles: event.articles.map(a => ({ title: a.title, source: a.source })),
        });
      }
    }
  }
  // Sort by event count, take top 15
  const sorted = [...hotwordEvents.values()]
    .map(g => ({ hotword: g.hotword, events: [...g.events.values()], event_count: g.events.size }))
    .sort((a, b) => b.event_count - a.event_count)
    .slice(0, 20);
  const allSummaries = [];
  const chunkSize = 5;
  for (let i = 0; i < sorted.length; i += chunkSize) {
    const chunk = sorted.slice(i, i + chunkSize);
    const label = `${i+1}-${Math.min(i+chunkSize, sorted.length)}/${sorted.length}`;
    onProgress(`热词综述生成 ${label}`);
    const input = chunk.map(g => ({
      hotword: g.hotword,
      related_event_count: g.events.length,
      related_articles: g.events.flatMap(e => e.articles.map(a => ({
        event_id: e.event_id, title: a.title, source: a.source,
      }))),
    }));
    const result = await gateway.complete({
      provider, purpose: 'hotword-summary', batchId, jsonMode: true,
      maxOutputTokens: Math.min(3200, providerConfig.maxOutputTokens),
      messages: [
        { role: 'system', content: HOTWORD_SUMMARIZE_SYSTEM, protected: true },
        { role: 'user', content: JSON.stringify(input), protected: true },
      ],
    });
    let parsed;
    try { parsed = JSON.parse(result.content.trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '')); }
    catch { parsed = []; }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.summary) {
          allSummaries.push({ hotword: item.hotword, summary: item.summary, event_count: item.event_count || 0 });
        }
      }
    }
    store.updateModelCall(result.callId, {
      status: 'done',
      inputTokens: result.usage.prompt_tokens ?? result.context.afterTokens,
      outputTokens: result.usage.completion_tokens ?? null,
    });
  }
  // Build lookup map
  const summaryMap = new Map();
  for (const s of allSummaries) summaryMap.set(s.hotword.toLowerCase(), s.summary);
  // Attach to clusters for atlas building
  for (const event of clusters) {
    const wordSummaries = [];
    for (const kw of (event.keywords || [])) {
      const s = summaryMap.get(kw.toLowerCase());
      if (s) wordSummaries.push({ hotword: kw, summary: s });
    }
    if (wordSummaries.length) event.hotword_summaries = wordSummaries;
  }
  onProgress(`热词综述生成完成：${allSummaries.length}/${sorted.length} 个热词`);
  return { summaries: summaryMap, all: allSummaries };
}

export async function runResearchPipeline({ gateway, store, batchId, provider, workspaceRoot, maxAgeHours = 168, onProgress = () => {} }) {
  const batch = store.getBatch(batchId); if (!batch) throw new Error('批次不存在');
  if (!batch.hotspots.length) throw new Error('当前批次没有热点，请先完成采集');
  const eligibleHotspots=batch.hotspots.filter((item)=>isFreshForBatch(item,batch.batch_date,maxAgeHours));
  const staleCount=batch.hotspots.length-eligibleHotspots.length;
  if(staleCount) onProgress(`已排除 ${staleCount} 条超过 ${maxAgeHours} 小时的旧闻；仍保留在历史档案`);
  if(!eligibleHotspots.length) throw new Error('当前批次没有处于有效时间窗口内的热点');
  const missing = eligibleHotspots.filter((item) => !tagsOf(item).eventKey || !tagsOf(item).preScores).length;
  if (missing) throw new Error(`仍有 ${missing} 条热点缺少完整语义标注，请先执行“打标”`);
  const workdir = path.join(workspaceRoot, 'topics', `${batch.batch_date}-orchestrated`);
  const sourcesDir = path.join(workdir, 'sources');
  onProgress('冻结账号上下文与作者资产');
  const account = accountSnapshot(workspaceRoot);
  const snapshotText = `# 账号上下文快照\n\n生成时间：${new Date().toISOString()}\n\n${account.map((x)=>`## ${x.label}\n来源：${x.file || '降级模式'}\n\n${x.content}`).join('\n\n')}`;
  const snapshotPath = path.join(sourcesDir,'account-context-snapshot.md'); writeFile(snapshotPath,snapshotText);
  onProgress('生成全量语义事件聚类');
  const clusters = clusterItems(eligibleHotspots);
  if (clusters.reduce((sum,event)=>sum+event.report_count,0) !== eligibleHotspots.length) throw new Error('事件聚类门禁失败：报道数不守恒');
  const phaseG = { generated_at:new Date().toISOString(), excluded_stale_count:staleCount, items:eligibleHotspots.map((item)=>({category_id:`G${String(item.id).padStart(5,'0')}`, hotspot_id:item.id,title:item.title,source:item.source,url:item.url,published_at:item.published_at,topic_category:item.category,market_scope:item.market_scope,...tagsOf(item)})) };
  const clustersJson = { generated_at:new Date().toISOString(), total_articles:eligibleHotspots.length,excluded_stale_count:staleCount,total_events:clusters.length,events:clusters.map(({tags,representativeHotspotId,...event})=>event) };
  writeFile(path.join(sourcesDir,'phase-G-output.json'),JSON.stringify(phaseG,null,2));
  writeFile(path.join(sourcesDir,'event-clusters.json'),JSON.stringify(clustersJson,null,2));
  writeFile(path.join(workdir,'hotspot-overview.html'),overviewHtml(clusters));
  onProgress('生成热词跨事件综述');
  const hotwordResult = await summarizeHotWords({gateway,store,clusters,batchId,provider,onProgress});
  writeFile(path.join(sourcesDir,'hotword-summaries.json'),JSON.stringify({generated_at:new Date().toISOString(),items:hotwordResult.all},null,2));
  onProgress('执行全量预评估并选择核心8条 + 黑马2条');
  const pool = choosePool(ranking, account);
  writeFile(path.join(sourcesDir,'preselection-ranking.json'),JSON.stringify({generated_at:new Date().toISOString(),items:ranking},null,2));
  store.saveEliminationReasons(batchId,ranking);
  const cards = await brainstorm(gateway,store,pool.selected,account,batchId,provider,onProgress);
  if (!cards.length) throw new Error('探索脑暴没有返回有效候选');
  const synthesis = await synthesize(gateway,store,cards,batchId,provider,onProgress);
  const scored = scoreCards(cards,synthesis);
  if (!scored.length) throw new Error('全部候选均为 NO_ANGLE，请检查标注或更换批次');
  onProgress('写入临时总榜、编辑议题卡与选题池');
  writeFile(path.join(workdir,'editorial-agenda.md'),markdownAgenda(scored));
  writeFile(path.join(workdir,'topics-ranked.md'),markdownRanked(scored,synthesis));
  store.saveAnalyzedCandidates(batchId,scored.map((item)=>({hotspotId:item.source.hotspotId,poolRole:item.source.poolRole,riskLevel:item.source.riskLevel,
    angle:item.angle,thesis:item.thesis,editorQuestion:item.editorQuestion,h:item.h,b:item.b,p:item.p,s:item.s,d:item.d,f:item.f})));
  const artifacts = [
    ['账号上下文快照','account-context-snapshot.md',snapshotPath],['Phase G 语义标注','phase-G-output.json',path.join(sourcesDir,'phase-G-output.json')],
    ['全量事件聚类','event-clusters.json',path.join(sourcesDir,'event-clusters.json')],['热词综述','hotword-summaries.json',path.join(sourcesDir,'hotword-summaries.json')],
    ['全量预选排名','preselection-ranking.json',path.join(sourcesDir,'preselection-ranking.json')],
    ['热点全景','hotspot-overview.html',path.join(workdir,'hotspot-overview.html')],['编辑议题卡','editorial-agenda.md',path.join(workdir,'editorial-agenda.md')],
    ['临时选题总榜','topics-ranked.md',path.join(workdir,'topics-ranked.md')],
  ];
  for (const [kind,name,file] of artifacts) { const stat=fs.statSync(file); store.upsertArtifact({batchId,kind,name,path:file,size:stat.size,modifiedAt:stat.mtime.toISOString()}); }
  store.updateBatch(batchId,{stage:'editorial',status:'review'});
  onProgress(`热点研判完成：${clusters.length} 个事件，${scored.length} 条编辑候选`);
  return { articles:eligibleHotspots.length, excludedStale:staleCount, events:clusters.length, selected:scored.length, top:scored.slice(0,3).map((x)=>({candidateId:x.candidateId,title:x.source.title,f:x.f})) };
}
