import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { loadConfig } from './lib/config.mjs';
import { indexArtifacts, isInsideRoots } from './lib/artifact-indexer.mjs';
import { JobManager } from './lib/job-manager.mjs';
import { checkReddit } from './collectors/reddit.mjs';
import { checkRssHub, ensureStarted, testSubscription } from './collectors/rsshub.mjs';
import { addSubscription, listSubscriptions, removeSubscription, subscriptionTestInput, updateSubscription } from './lib/subscriptions.mjs';
import { ModelGateway } from './lib/llm/gateway.mjs';
import { draftArticle, tagBatch } from './lib/llm/tasks.mjs';
import { isFreshForBatch } from './lib/llm/research-pipeline.mjs';
import { loadEnv } from './lib/env.mjs';
import { AiJobManager } from './lib/ai-job-manager.mjs';
import { runEditorialTurn, runEditorialTurnStream } from './lib/llm/editorial-room.mjs';
import { clusterItems, preselection, scoreCards, selectSocialCandidates, ensureBatchEventCards } from './lib/llm/research-pipeline.mjs';
import { buildHotspotAtlas } from './lib/hotspot-atlas.mjs';
import { fetchCandidateSource } from './lib/source-fetcher.mjs';
import { getImageWorkspace, saveImageMetadata, saveLocalImage, uploadImageToCdn,
  planImagePlaceholders, imageManifestFile } from './lib/image-workflow.mjs';
import { inspectRepository, repositoryFactMarkdown } from './lib/repository-inspector.mjs';
import { evaluateCardGate, evaluateEventCardGate, evaluateCustomCardGate } from './lib/social-card-gate.mjs';
import { buildCustomFactSheet, customFactMarkdown, customSourceUrl } from './lib/custom-fact-builder.mjs';
import { runCustomSocialChatStream } from './lib/llm/custom-social-chat.mjs';
import { eventGroupsForCandidate, resolveEventAnalysis } from './lib/event-fact-base.mjs';
import { loadSkillBundle } from './lib/llm/skill-runtime.mjs';
import { createZip } from './lib/zip-bundle.mjs';
import { getGitHubApiHealth } from './lib/github-api.mjs';
import { imageArtifactPreviewHtml, injectPhonePreviewStyles, isImageArtifact } from './lib/artifact-preview.mjs';
import { batchArticlesDir, batchTopicsDir, candidateArticleDir, candidateSocialCardDir } from './lib/workspace-paths.mjs';
import { routeBreakingAnalysis } from './lib/llm/breaking-analysis-pipeline.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
loadEnv(root);
const config = loadConfig(root);
const store = new Store(path.join(root, 'data', 'workbench.db'));
const recovered = store.recoverInterruptedWork();
if (Object.values(recovered).some(Number)) console.log(`已恢复上次中断状态：${JSON.stringify(recovered)}`);
const jobs = new JobManager(store, config);
const models = new ModelGateway(config, store);
const aiJobs = new AiJobManager(store, models, config);
const artifactRoots = [config.workspaceRoot, ...config.contentRoots];
const publicRoot = path.join(root, 'public');

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

function json(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function body(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 12_000_000) throw new Error('请求体过大');
  }
  return text ? JSON.parse(text) : {};
}

function serveStatic(response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(publicRoot, relative);
  if (!filePath.startsWith(publicRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  response.writeHead(200, { 'content-type': mime[path.extname(filePath)] ?? 'application/octet-stream', 'cache-control':'no-store' });
  fs.createReadStream(filePath).pipe(response);
  return true;
}

function batchWorkdir(batch) {
  return batchTopicsDir(config.workspaceRoot, batch);
}

function articleWorkdir(batch, candidate) {
  return candidateArticleDir(config.workspaceRoot, batch, candidate);
}

function socialCardWorkdir(batch, candidate) {
  return candidateSocialCardDir(config.workspaceRoot, batch, candidate);
}

function socialCardFiles(batch,candidate){const dir=socialCardWorkdir(batch,candidate);const names=['fact-sheet.md','repository-fact-sheet.json','card-plan.json','copy.txt','my-design.html','layout-report.json','delivery-report.json','social-card-skill-manifest.json','social-card-stage-executions.json'];const files=names.filter((name)=>fs.existsSync(path.join(dir,name))).map((name)=>({name,path:path.join(dir,name)}));const output=path.join(dir,'output');if(fs.existsSync(output))for(const name of fs.readdirSync(output).filter((name)=>name.toLowerCase().endsWith('.png')).sort())files.push({name:`output/${name}`,path:path.join(output,name)});return {dir,files};}

function candidateRepositoryUrl(candidate) {
  if (/^https:\/\/github\.com\//i.test(candidate.url||'')) return candidate.url;
  return (candidate.hotspots||[]).find((item)=>/^https:\/\/github\.com\//i.test(item.url||''))?.url||'';
}

function socialContentType(candidate) {
  const mode=candidate?.tracks?.find((item)=>item.track==='social_cards')?.output_mode||'';
  if(mode.includes('event-cards'))return 'event';
  if(mode.includes('custom-cards'))return 'custom';
  return 'repository';
}
// 渠道与内容形态都编码在 candidate_tracks.output_mode：xiaohongshu-* 走小红书渲染分支，其余走公众号
function socialChannelMode(candidate) {
  const mode=candidate?.tracks?.find((item)=>item.track==='social_cards')?.output_mode||'';
  return mode.startsWith('xiaohongshu')?'xiaohongshu':'wechat';
}
function socialCardGate(candidate, contentType, facts, editorial, eventAnalysis) {
  if(contentType==='event')return evaluateEventCardGate(candidate,eventAnalysis,editorial);
  if(contentType==='custom')return evaluateCustomCardGate(candidate,facts,editorial);
  return evaluateCardGate(candidate,facts,editorial);
}

function batchMaxAgeHours(batch) {
  return Number(batch?.max_age_hours) || config.rsshub.maxAgeHours;
}

function decorateBatch(batch) {
  if (!batch) return batch;
  let stale = 0;
  const maxAgeHours = batchMaxAgeHours(batch);
  batch.hotspots = batch.hotspots.map((item) => {
    const is_stale = !isFreshForBatch(item,batch.batch_date,maxAgeHours);
    if(is_stale) stale+=1;
    return {...item,is_stale};
  });
  batch.freshness={fresh:batch.hotspots.length-stale,stale,maxAgeHours};
  // 打标进度只统计有效窗口内的热点：旧闻归档不参与打标与研判，不应计入分母
  if (batch.ai_status) {
    const freshItems = batch.hotspots.filter((item) => !item.is_stale);
    batch.ai_status = { ...batch.ai_status,
      tagged: freshItems.filter((item) => { try { return Boolean(JSON.parse(item.raw_json).aiTags?.eventKey); } catch { return false; } }).length,
      total: freshItems.length };
  }
  return batch;
}

function writeUtf8(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
  const stat = fs.statSync(filePath);
  return { size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

function lockedBrief(candidate, editorial) {
  return `---
brief_status: LOCKED
candidate_id: ${candidate.candidate_id}
experience_required: ${editorial.experience_required ? 'true' : 'false'}
decision_source: explicit-user
final_readiness: WRITE_NOW
---

# ${candidate.hotspot_title}

## 锁定命题

${candidate.thesis.trim()}

## 推荐角度

${candidate.angle.trim() || '未单独填写，以锁定命题为准。'}

## 已确认公共事实

${editorial.confirmed_facts.trim() || '暂无；成稿前必须建立事实基座。'}

## 已确认作者观点

${editorial.author_opinions.trim() || candidate.thesis.trim()}

## 已确认实践及证据

${editorial.confirmed_experiences.trim() || '本题不依赖作者亲身实践。'}

## 反证、失败或适用边界

${editorial.rejected_angles.trim() || '暂无已确认反证；成稿核验时补充。'}

## 禁止扩写

${editorial.forbidden_claims.trim() || '不得把未核验线索写成事实，不得虚构作者经历。'}
`;
}

async function api(request, response, url) {
  const { pathname, searchParams } = url;
  if (request.method === 'GET' && pathname === '/api/overview') {
    return json(response, 200, store.overview());
  }
  if (request.method === 'GET' && pathname === '/api/models') {
    return json(response, 200, { ...models.listProviders(), calls: store.listModelCalls(50) });
  }
  if (request.method === 'POST' && pathname === '/api/models/test') {
    const input = await body(request);
    const result = await models.complete({ provider: input.provider, purpose: 'connection-test', maxOutputTokens: 16,
      messages: [{ role: 'user', content: '只回复 OK', protected: true }] });
    return json(response, 200, { provider: result.provider, model: result.model, reply: result.content,
      latencyTokens: result.usage, compressed: result.context.compressed });
  }
  if (request.method === 'GET' && pathname === '/api/batches') {
    return json(response, 200, store.listBatches(Number(searchParams.get('limit') ?? 60)));
  }
  if (request.method === 'POST' && pathname === '/api/batches') {
    const input = await body(request);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') ? input.date : new Date().toISOString().slice(0, 10);
    return json(response, 201, store.createBatch({ date, title: input.title || `${date} 每日选题`, note: input.note }));
  }
  if (request.method === 'POST' && pathname === '/api/batches/breaking') {
    const input=await body(request);
    const date=/^\d{4}-\d{2}-\d{2}$/.test(input.date??'')?input.date:new Date().toISOString().slice(0,10);
    try {
      return json(response,201,store.createBreakingBatch({
        date,title:input.title,note:input.note,
        urls:Array.isArray(input.urls)?input.urls:String(input.urls||'').split(/\r?\n/),
        requestedTracks:Array.isArray(input.requestedTracks)?input.requestedTracks:['article'],
      }));
    } catch(error) {
      return json(response,400,{error:error.message});
    }
  }
  const batchMatch = pathname.match(/^\/api\/batches\/([^/]+)$/);
  if (batchMatch && request.method === 'GET') {
    const batch = decorateBatch(store.getBatch(decodeURIComponent(batchMatch[1])));
    if (batch) {
      // 事件卡进度：已生成卡数 vs 当前已打标事件数（用于抽屉的四环节步骤条）
      try {
        const cardFile = path.join(batchWorkdir(batch), 'sources', 'event-cards.json');
        const cardCount = fs.existsSync(cardFile) ? (JSON.parse(fs.readFileSync(cardFile, 'utf8'))?.items || []).length : 0;
        const tagged = batch.hotspots.filter((item) => !item.is_stale).filter((item) => {
          try { const tags = JSON.parse(item.raw_json).aiTags; return Boolean(tags?.eventKey && tags?.preScores); } catch { return false; }
        });
        const cardTotal = clusterItems(tagged).length;
        // 同日常规批次共享 topics 工作目录：本批还没有已打标事件时，目录里的卡属于其他批次，不能计入进度
        batch.event_cards = { count: cardTotal ? Math.min(cardCount, cardTotal) : 0, total: cardTotal };
      } catch { batch.event_cards = { count: 0, total: 0 }; }
    }
    return json(response, batch ? 200 : 404, batch ?? { error: '批次不存在' });
  }
  if (batchMatch && request.method === 'PATCH') {
    const updated = store.updateBatch(decodeURIComponent(batchMatch[1]), await body(request));
    return json(response, updated ? 200 : 404, updated ?? { error: '批次不存在' });
  }
  const collectMatch = pathname.match(/^\/api\/batches\/([^/]+)\/collect$/);
  if (collectMatch && request.method === 'POST') {
    const input = await body(request);
    const sources = [...new Set((input.sources ?? ['reddit', 'rsshub', 'github']).filter((item) => ['reddit', 'rsshub', 'github'].includes(item)))];
    if (!sources.length) return json(response, 400, { error: '没有可执行的数据源' });
    const batchId = decodeURIComponent(collectMatch[1]);
    let maxAgeHours = null;
    if (input.maxAgeHours != null) {
      maxAgeHours = Number(input.maxAgeHours);
      if (![24, 48, 72, 120, 168].includes(maxAgeHours)) return json(response, 400, { error: '时间范围只支持 1、2、3、5、7 天' });
      store.updateBatch(batchId, { max_age_hours: maxAgeHours });
    }
    return json(response, 202, jobs.startCollection(batchId, sources, maxAgeHours));
  }
  const overviewMatch = pathname.match(/^\/api\/batches\/([^/]+)\/overview$/);
  const rankingMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ranking$/);
  const socialRankingMatch = pathname.match(/^\/api\/batches\/([^/]+)\/social-ranking$/);
  if (socialRankingMatch && request.method === 'GET') {
    const batchId=decodeURIComponent(socialRankingMatch[1]);const batch=store.getBatch(batchId);
    if(!batch)return json(response,404,{error:'批次不存在'});
    const file=path.join(batchWorkdir(batch),'sources','social-card-ranking.json');
    let items=[];try{items=JSON.parse(fs.readFileSync(file,'utf8')).items||[];}catch{}
    if(!items.length){const eligible=batch.hotspots.filter((item)=>isFreshForBatch(item,batch.batch_date,batchMaxAgeHours(batch)));
      const tagged=eligible.filter((item)=>{try{const tags=JSON.parse(item.raw_json||'{}').aiTags;return tags?.eventKey&&tags?.preScores;}catch{return false;}});
      if(tagged.length)items=selectSocialCandidates(preselection(clusterItems(tagged),batch.batch_date),tagged.length,true).map((item,index)=>({...item,socialRank:index+1,selected:index<10&&item.eligible}));}
    const candidates=store.listCandidates(batchId,'social_cards');const inPoolIds=new Set(candidates.map((item)=>item.hotspot_id));
    return json(response,200,items.map((item)=>({...item,inPool:inPoolIds.has(item.hotspotId)})));
  }
  if (rankingMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(rankingMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error: '批次不存在' });
    const items = batch.hotspots
      .filter((item) => !item.is_stale)
      .map((item) => {
        const raw = (() => { try { return JSON.parse(item.raw_json || '{}'); } catch { return {}; } })();
        const tags = raw.aiTags || {};
        const preScores = tags.preScores || {};
        const base = ['conflict','audience','informationGain','emotion','timeliness','impact','sourceReliability']
          .reduce((s, k) => s + (preScores[k] || 0), 0);
        const finalPreScore = base + (tags.categoryPreference || 0) + (tags.credibleScoop || 0) - (tags.saturationPenalty || 0);
        return {
          hotspotId: item.id, title: item.title, category: item.category, marketScope: item.market_scope,
          riskLevel: tags.riskLevel || item.category, score: finalPreScore,
          eliminationReason: raw.eliminationReason || '',
          inPool: false
        };
      })
      .sort((a, b) => b.score - a.score)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));
    // Mark items that are in the candidate pool
    const candidates = store.listCandidates(batchId);
    const inPoolIds = new Set(candidates.map((c) => c.hotspot_id));
    for (const item of items) { if (inPoolIds.has(item.hotspotId)) item.inPool = true; }
    return json(response, 200, items);
  }

  if (overviewMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(overviewMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error: '批次不存在' });
    const eligible = batch.hotspots.filter((item) => isFreshForBatch(item,batch.batch_date,batchMaxAgeHours(batch)));
    const taggedCount = eligible.filter((item) => { try { const tags=JSON.parse(item.raw_json).aiTags; return Boolean(tags?.eventKey&&tags?.relevanceReason&&tags?.preScores); } catch { return false; } }).length;
    const atlas = buildHotspotAtlas({ clusters:clusterItems(eligible), totalArticles:eligible.length, taggedCount,
      excludedStale:batch.hotspots.length-eligible.length });
    // Attach event cards generated by the research pipeline
    try {
      const cardFile = path.join(batchWorkdir(batch), 'sources', 'event-cards.json');
      if (fs.existsSync(cardFile)) {
        const cardData = JSON.parse(fs.readFileSync(cardFile, 'utf8'));
        const cardMap = new Map((cardData?.items || []).map((item) => [item.event_id, item]));
        for (const event of atlas.events || []) {
          const card = cardMap.get(event.event_id);
          if (card) event.card = card;
        }
        // 关系图事件节点同样挂上事件摘要，前端优先展示 conclusion 而非热点标题
        for (const node of atlas.graph?.nodes || []) {
          if (node.type !== 'event') continue;
          const card = cardMap.get(String(node.id).replace(/^event:/, ''));
          if (card?.conclusion) node.summary = card.conclusion;
        }
      }
    } catch (e) { /* event cards not available yet — non-blocking */ }
    return json(response, 200, atlas);
  }

  const similarMatch=pathname.match(/^\/api\/candidates\/(\d+)\/similar$/);
  if (similarMatch && request.method === 'GET') {
    return json(response, 200, store.findSimilarArticles(Number(similarMatch[1])));
  }
  const similarSocialMatch=pathname.match(/^\/api\/candidates\/(\d+)\/similar-social$/);
  if (similarSocialMatch && request.method === 'GET') {
    return json(response, 200, store.findSimilarSocialCards(Number(similarSocialMatch[1])));
  }
  const tagMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/tag$/);
  if (tagMatch && request.method === 'POST') {
    const input = await body(request);
    if (input.background === true) return json(response, 202, aiJobs.start({ batchId:decodeURIComponent(tagMatch[1]),
      provider:input.provider,type:input.force?'retag':'tag',force:Boolean(input.force) }));
    const result = await tagBatch({ gateway: models, store, batchId: decodeURIComponent(tagMatch[1]),
      provider: input.provider, limit: input.limit, force:Boolean(input.force),
      maxAgeHours: batchMaxAgeHours(store.getBatch(decodeURIComponent(tagMatch[1]))) });
    try {
      const cardResult = await ensureBatchEventCards({ gateway: models, store, batchId: decodeURIComponent(tagMatch[1]),
        provider: input.provider, workspaceRoot: config.workspaceRoot, maxAgeHours: batchMaxAgeHours(store.getBatch(decodeURIComponent(tagMatch[1]))), regenerate: Boolean(input.force) });
      result.eventCards = { total: cardResult.total, generated: cardResult.generated, cached: cardResult.cached, failed: cardResult.failed.length };
    } catch (error) { result.eventCards = { error: error.message }; }
    return json(response, 200, result);
  }
  const researchMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/research$/);
  if (researchMatch && request.method === 'POST') {
    const input=await body(request),batchId=decodeURIComponent(researchMatch[1]),batch=store.getBatch(batchId);
    if(!batch)return json(response,404,{error:'批次不存在'});
    return json(response,202,aiJobs.start({batchId,provider:input.provider,type:batch.batch_type==='breaking'?'breaking-analysis':'research'}));
  }
  const autoMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/auto$/);
  if (autoMatch && request.method === 'POST') {
    const input=await body(request),batchId=decodeURIComponent(autoMatch[1]),batch=store.getBatch(batchId);
    if(!batch)return json(response,404,{error:'批次不存在'});
    return json(response,202,aiJobs.start({batchId,provider:input.provider,type:'auto'}));
  }
  const eventCardsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/event-cards$/);
  if (eventCardsMatch && request.method === 'POST') {
    const input=await body(request),batchId=decodeURIComponent(eventCardsMatch[1]),batch=store.getBatch(batchId);
    if(!batch)return json(response,404,{error:'批次不存在'});
    return json(response,202,aiJobs.start({batchId,provider:input.provider,type:'event-cards',force:Boolean(input.force)}));
  }
  const candidatesMatch = pathname.match(/^\/api\/batches\/([^/]+)\/candidates$/);
  function loadBatchEventCards(batch) {
  try {
    const cardFile = path.join(batchWorkdir(batch), 'sources', 'event-cards.json');
    if (!fs.existsSync(cardFile)) return null;
    const cardMap = new Map((JSON.parse(fs.readFileSync(cardFile, 'utf8'))?.items || []).map((item) => [item.event_id, item]));
    if (!cardMap.size) return null;
    const eligible = batch.hotspots.filter((item) => isFreshForBatch(item, batch.batch_date, batchMaxAgeHours(batch)));
    const hotspotCard = new Map();
    for (const event of clusterItems(eligible)) {
      const card = cardMap.get(event.event_id);
      if (!card) continue;
      for (const article of event.articles) if (article.hotspot_id) hotspotCard.set(article.hotspot_id, card);
    }
    return hotspotCard;
  } catch { return null; }
}

  // 选题与事件为一对多：候选的关联热点分属哪些事件，哪些事件就是本选题的关联事件；
  // 原文绑定在事件下：每个事件携带其全部热点的原文抓取快照。contentLimit 控制快照正文截断。
  // 实现已下沉到 lib/event-fact-base.mjs，供事件图文事实基座在管线侧复用
  function candidateEventGroups(candidate, contentLimit = 2000) {
    return eventGroupsForCandidate({ store, workspaceRoot: config.workspaceRoot, candidate, contentLimit, defaultMaxAgeHours: config.rsshub.maxAgeHours });
  }

  // 事件图文统一取数：突发批次用突发分析，日常批次（热点全景加入图文池）用事件卡合成
  function resolveEventAnalysisFor(candidate) {
    return resolveEventAnalysis({ store, workspaceRoot: config.workspaceRoot, candidate, defaultMaxAgeHours: config.rsshub.maxAgeHours });
  }

  function candidateEventCard(candidate) {
    return candidateEventGroups(candidate).map((group) => group.card).find(Boolean) || null;
  }

  function attachEventConclusions(candidates, batchId) {
  const batch = store.getBatch(batchId);
  if (!batch) return;
  const hotspotCard = loadBatchEventCards(batch);
  if (!hotspotCard) return;
  for (const candidate of candidates) {
    if (candidate.pool_role === '议题综合') continue;
    const hotspotIds = candidate.composite ? store.candidateHotspots(candidate.id).map((h) => h.id) : [candidate.hotspot_id];
    const card = hotspotIds.map((id) => hotspotCard.get(id)).find(Boolean);
    if (card?.conclusion) candidate.event_conclusion = card.conclusion;
  }
}


  if (candidatesMatch && request.method === 'GET') {
    try {
      const batchId = decodeURIComponent(candidatesMatch[1]);
      const track = searchParams.get('track') || 'article';
      const candidates = store.listCandidates(batchId, track);
      // 重叠标注需要成员热点：综合候选取 candidate_hotspots 全量成员，单热点候选取自身
      for (const candidate of candidates) {
        candidate.member_hotspot_ids = candidate.composite
          ? store.candidateHotspots(candidate.id).map((item) => item.id)
          : [candidate.hotspot_id].filter(Boolean);
      }
      if (track === 'article') attachEventConclusions(candidates, batchId);
      return json(response, 200, candidates);
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  const breakingAnalysisMatch=pathname.match(/^\/api\/batches\/([^/]+)\/ai\/breaking-analysis$/);
  if(breakingAnalysisMatch&&request.method==='POST'){
    const input=await body(request),batchId=decodeURIComponent(breakingAnalysisMatch[1]),batch=store.getBatch(batchId);
    if(!batch)return json(response,404,{error:'批次不存在'});
    if(batch.batch_type!=='breaking')return json(response,400,{error:'只有突发专题可以执行该分析'});
    return json(response,202,aiJobs.start({batchId,provider:input.provider,type:'breaking-analysis'}));
  }
  const breakingResultMatch=pathname.match(/^\/api\/batches\/([^/]+)\/breaking-analysis$/);
  if(breakingResultMatch&&request.method==='GET'){
    const result=store.getBreakingAnalysis(decodeURIComponent(breakingResultMatch[1]));
    return json(response,result?200:404,result||{error:'尚未生成突发分析'});
  }
  const breakingMaterialsMatch=pathname.match(/^\/api\/batches\/([^/]+)\/breaking-materials$/);
  if(breakingMaterialsMatch&&request.method==='POST'){
    try{
      const input=await body(request);
      const urls=Array.isArray(input.urls)?input.urls:String(input.urls||'').split(/\r?\n/);
      return json(response,201,{materials:store.addBreakingMaterials(decodeURIComponent(breakingMaterialsMatch[1]),urls)});
    }catch(error){return json(response,400,{error:error.message});}
  }
  const breakingRouteMatch=pathname.match(/^\/api\/batches\/([^/]+)\/breaking-analysis\/route$/);
  if(breakingRouteMatch&&request.method==='POST'){
    try{
      const input=await body(request);
      return json(response,200,routeBreakingAnalysis({store,batchId:decodeURIComponent(breakingRouteMatch[1]),tracks:input.tracks}));
    }catch(error){return json(response,400,{error:error.message});}
  }
  if (candidatesMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(candidatesMatch[1]);
    const input = await body(request);
    if (!Array.isArray(input.hotspotIds)) return json(response, 400, { error: 'hotspotIds 必须是数组' });
    const tracks = Array.isArray(input.tracks) && input.tracks.length ? input.tracks : ['article'];
    const added=store.addCandidates(batchId, input.hotspotIds, { tracks });
    if(tracks.includes('social_cards')&&input.socialScoreDetails&&input.hotspotIds.length===1){
      const candidate=added.find((item)=>Number(item.hotspot_id)===Number(input.hotspotIds[0]));
      if(candidate)store.saveSocialScore(candidate.id,input.socialScoreDetails);
    }
    return json(response, 201, store.listCandidates(batchId, input.track || tracks[0]));
  }
  const compositeMatch = pathname.match(/^\/api\/batches\/([^/]+)\/candidates\/composite$/);
  if (compositeMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(compositeMatch[1]);
    const input = await body(request);
    if (!Array.isArray(input.hotspotIds) || input.hotspotIds.length < 2) return json(response, 400, { error: '综合选题至少需要 2 个热点' });
    const composite = store.createCompositeCandidate(batchId, input.hotspotIds, input);
    // 图文池分流：含 GitHub 仓库的综合候选走工具图文（默认 wechat-tool-cards），纯新闻事件走事件图文
    if ((Array.isArray(input.tracks) ? input.tracks : []).includes('social_cards') && composite && !candidateRepositoryUrl(composite)) {
      store.updateCandidateTrack(composite.id, 'social_cards', { output_mode: 'wechat-event-cards' });
      store.saveCardEditorial(composite.id, { ...store.getCardEditorial(composite.id), output_mode: 'wechat-event-cards' });
    }
    // Auto-score composite candidate via brainstrom-light
    try {
      if (composite && models) {
        const providerConfig = models.config.providers[models.config.defaultProvider];
        const hotInfo = (composite.hotspots||[]).slice(0, 5).map(h => `- ${h.title || '(无标题)'}（${h.source || '未知来源'}）`).join('\n');
        const result = await models.complete({
          purpose: 'composite-score', batchId, jsonMode: true,
          maxOutputTokens: Math.min(3000, providerConfig.maxOutputTokens),
          messages: [{
            role: 'system', protected: true,
            content: `你是热点探索编辑。对综合选题生成临时评分。返回严格JSON：{"bScores":{"angleUniqueness":0-5,"emotionSpread":0-5,"titleHook":0-5,"audienceRelevance":0-5,"factSupport":0-5},"hProfile":{"historicalType":"worker_social|bigtech|owned_experience|controversial_return|key_person_move|github_tool|ai_tool_test|financing|career_anxiety|contrarian_bigtech","fiveSenseCount":0-5,"fiveQuestionCount":0-5,"recommendationFit":0-10,"emotionTheme":0-10,"searchFriendly":0-5},"angle":"30字角度","thesis":"30字命题"}`
          }, {
            role: 'user', protected: true,
            content: `综合选题标题：${composite.hotspot_title}\n含以下热点信息：\n${hotInfo}\n请生成评分和角度。`
          }]
        });
        let parsed;
        try { parsed = JSON.parse(result.content.trim().replace(/^\`\`\`(?:json)?\\s*/i, '').replace(/\\s*\`\`\`$/, '')); } catch { parsed = null; }
        if (parsed) {
          const firstCategory = (composite.hotspots||[]).find(h => h.category)?.category || '';
          const card = {
            bScores: parsed.bScores || {},
            hProfile: parsed.hProfile || { historicalType: 'bigtech', fiveSenseCount: 0, fiveQuestionCount: 0, recommendationFit: 0, emotionTheme: 0, searchFriendly: 0 },
            angle: parsed.angle || '', thesis: parsed.thesis || '',
            source: { title: composite.hotspot_title, category: firstCategory, riskLevel: '待评估', poolRole: '综合选题', hotspotId: null }
          };
          const scored = scoreCards([card], { items: [] });
          if (scored.length) {
            store.updateCandidate(composite.id, {
              h_score: scored[0].h, b_score: scored[0].b, p_score: scored[0].p.toFixed(1),
              s_score: scored[0].s, d_score: scored[0].d, f_score: scored[0].f,
              angle: parsed.angle || '', thesis: parsed.thesis || '',
              status: 'scored'
            });
          }
        }
      }
    } catch (e) { /* auto-scoring best-effort */ }
    return json(response, 201, store.getCandidate(composite.id));
  }
  // 自定义图文创建前的对话式策划（无状态：草稿与历史由前端全量传入，仅返回表单更新）
  const customSocialChatMatch = pathname.match(/^\/api\/batches\/([^/]+)\/custom-social-chat\/stream$/);
  if (customSocialChatMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(customSocialChatMatch[1]);
    if (!store.getBatch(batchId)) return json(response, 404, { error: '批次不存在' });
    const input = await body(request);
    response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', 'connection': 'keep-alive' });
    const send = (event) => response.write(`${JSON.stringify(event)}\n`);
    try {
      const result = await runCustomSocialChatStream({
        gateway: models, store, provider: input.provider, batchId,
        draft: input.draft && typeof input.draft === 'object' ? input.draft : {},
        history: Array.isArray(input.history) ? input.history.slice(-40) : [],
        answer: String(input.answer || ''),
        onText: (text) => send({ type: 'delta', text }),
      });
      send({ type: 'done', data: { reply: result.reply, formUpdates: result.formUpdates, ready: result.ready, usage: result.usage, model: result.model } });
    } catch (error) {
      send({ type: 'error', error: error.message });
    }
    response.end(); return true;
  }
  // 创建自定义图文候选（待办 1+6：非仓库类图文，首批教程/清单/观点，渠道编码进 output_mode）
  const customSocialMatch = pathname.match(/^\/api\/batches\/([^/]+)\/custom-social-candidates$/);
  if (customSocialMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(customSocialMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error: '批次不存在' });
    const input = await body(request);
    const outputMode = String(input.channel || '').trim() === 'xiaohongshu' ? 'xiaohongshu-custom-cards' : 'wechat-custom-cards';
    try {
      const fact = await buildCustomFactSheet({ input, root });
      const materialUrls = (fact.materials || []).map((item) => item.url);
      const hotspot = store.addManualHotspot(batch.id, { title: fact.topic, url: materialUrls[0] || null, materialUrls, notes: `自定义图文（${fact.content_type_label}）` });
      if (!hotspot) throw new Error('手工热点创建失败');
      store.addCandidates(batch.id, [hotspot.id], { tracks: ['social_cards'] });
      const candidate = store.listCandidates(batch.id, 'social_cards').find((item) => Number(item.hotspot_id) === Number(hotspot.id));
      if (!candidate) throw new Error('自定义图文候选创建失败');
      store.updateCandidate(candidate.id, { angle: fact.topic, thesis: fact.thesis || fact.topic });
      store.updateCandidateTrack(candidate.id, 'social_cards', { status: 'pooled', pool_role: '自定义图文', output_mode: outputMode });
      store.saveCardEditorial(candidate.id, { ...store.getCardEditorial(candidate.id), output_mode: outputMode, recommended_pages: fact.expected_pages, target_reader: fact.audience, status: 'DISCUSS' });
      const saved = store.saveRepositoryFactSheet(candidate.id, { repository: '', sourceUrl: customSourceUrl(candidate.id), status: 'ok', data: fact, checkedAt: fact.built_at });
      const dir = socialCardWorkdir(store.getBatch(batch.id), candidate);
      const jsonPath = path.join(dir, 'custom-fact-sheet.json'); const mdPath = path.join(dir, 'fact-sheet.md');
      const jsonFile = writeUtf8(jsonPath, JSON.stringify(fact, null, 2)); const mdFile = writeUtf8(mdPath, customFactMarkdown(fact));
      store.upsertArtifact({ batchId: batch.id, kind: '自定义事实基座', name: path.basename(jsonPath), path: jsonPath, ...jsonFile });
      store.upsertArtifact({ batchId: batch.id, kind: '图文事实清单', name: path.basename(mdPath), path: mdPath, ...mdFile });
      const editorial = store.getCardEditorial(candidate.id);
      return json(response, 201, { candidate: store.getCandidate(candidate.id), facts: saved, gate: evaluateCustomCardGate(candidate, saved, editorial) });
    } catch (error) {
      return json(response, 400, { error: `创建自定义图文失败：${error.message}` });
    }
  }
  const candidateMatch = pathname.match(/^\/api\/candidates\/(\d+)$/);
  if (candidateMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(candidateMatch[1]));
    if (candidate) {
      candidate.events = candidateEventGroups(candidate);
      const card = candidate.events.map((group) => group.card).find(Boolean);
      if (card) candidate.event_card = card;
    }
    return json(response, candidate ? 200 : 404, candidate ?? { error: '候选不存在' });
  }
  if (candidateMatch && request.method === 'PATCH') {
    const candidate = store.updateCandidate(Number(candidateMatch[1]), await body(request));
    return json(response, candidate ? 200 : 404, candidate ?? { error: '候选不存在' });
  }
  if (candidateMatch && request.method === 'DELETE') {
    store.deleteCandidate(Number(candidateMatch[1]));
    return json(response, 200, { ok: true });
  }
  const cardEditorialMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-editorial$/);
  const socialCardsMatch = pathname.match(/^\/api\/candidates\/(\d+)\/social-cards$/);
  if(socialCardsMatch&&request.method==='GET'){
    const candidate=store.getCandidate(Number(socialCardsMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});const batch=store.getBatch(candidate.batch_id);const workspace=socialCardFiles(batch,candidate);
    const read=(name,fallback='')=>{const file=path.join(workspace.dir,name);if(!fs.existsSync(file))return fallback;return fs.readFileSync(file,'utf8');};
    const parse=(name,fallback)=>{try{return JSON.parse(read(name));}catch{return fallback;}};
    const images=workspace.files.filter((file)=>file.name.startsWith('output/')).map((file,index)=>({index:index+1,name:path.basename(file.name),url:`/api/candidates/${candidate.id}/social-cards/files/${encodeURIComponent(file.name)}`,downloadUrl:`/api/candidates/${candidate.id}/social-cards/files/${encodeURIComponent(file.name)}?download=1`,size:fs.statSync(file.path).size}));
    return json(response,200,{candidateId:candidate.id,code:candidate.candidate_id,title:candidate.hotspot_title,ready:images.length>0,images,copy:read('copy.txt'),facts:read('fact-sheet.md'),cardPlan:parse('card-plan.json',{}),layout:parse('layout-report.json',{}),delivery:parse('delivery-report.json',{}),htmlUrl:fs.existsSync(path.join(workspace.dir,'my-design.html'))?`/api/candidates/${candidate.id}/social-cards/files/my-design.html`:'',bundleUrl:images.length?`/api/candidates/${candidate.id}/social-cards/download`:''});
  }
  const socialCardFileMatch=pathname.match(/^\/api\/candidates\/(\d+)\/social-cards\/files\/(.+)$/);
  if(socialCardFileMatch&&request.method==='GET'){
    const candidate=store.getCandidate(Number(socialCardFileMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});const batch=store.getBatch(candidate.batch_id);const workspace=socialCardFiles(batch,candidate);const relative=decodeURIComponent(socialCardFileMatch[2]);const file=path.resolve(workspace.dir,relative);
    if(!isInsideRoots(file,[workspace.dir])||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(response,404,{error:'图文产物不存在'});const headers={'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'};if(searchParams.get('download')==='1')headers['content-disposition']=`attachment; filename="${path.basename(file).replace(/"/g,'')}"`;response.writeHead(200,headers);return fs.createReadStream(file).pipe(response);
  }
  const socialCardDownloadMatch=pathname.match(/^\/api\/candidates\/(\d+)\/social-cards\/download$/);
  if(socialCardDownloadMatch&&request.method==='GET'){
    const candidate=store.getCandidate(Number(socialCardDownloadMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});const batch=store.getBatch(candidate.batch_id);const workspace=socialCardFiles(batch,candidate);if(!workspace.files.length)return json(response,404,{error:'暂无可下载图文产物'});const zip=createZip(workspace.files);response.writeHead(200,{'content-type':'application/zip','content-disposition':`attachment; filename="${candidate.candidate_id.toLowerCase()}-social-cards.zip"`,'content-length':zip.length});return response.end(zip);
  }
  if (cardEditorialMatch && request.method === 'GET') {
    const candidate=store.getCandidate(Number(cardEditorialMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const editorial=store.getCardEditorial(candidate.id); const facts=store.getRepositoryFactSheet(candidate.id); const score=store.getSocialScore(candidate.id);
    const contentType=socialContentType(candidate),eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    const gate=socialCardGate(candidate,contentType,facts,editorial,eventAnalysis);
    return json(response,200,{candidate,editorial,facts,score,contentType,channelMode:socialChannelMode(candidate),eventAnalysis,gate});
  }
  if (cardEditorialMatch && request.method === 'PUT') {
    const candidate=store.getCandidate(Number(cardEditorialMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const editorial=store.saveCardEditorial(candidate.id,await body(request)); const facts=store.getRepositoryFactSheet(candidate.id);
    const contentType=socialContentType(candidate),eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    return json(response,200,{editorial,contentType,gate:socialCardGate(candidate,contentType,facts,editorial,eventAnalysis)});
  }
  // 渠道切换：只换 output_mode 的渠道前缀（wechat-* ↔ xiaohongshu-*），类型部分不动，轨道与卡片决策同步
  const cardChannelMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-channel$/);
  if (cardChannelMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(cardChannelMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const input=await body(request);
    const channel=String(input.channel||'').trim();
    if(!['wechat','xiaohongshu'].includes(channel))return json(response,400,{error:'channel 必须是 wechat 或 xiaohongshu'});
    const track=candidate.tracks?.find((item)=>item.track==='social_cards');
    const currentMode=track?.output_mode||store.getCardEditorial(candidate.id).output_mode||'wechat-tool-cards';
    const typeSuffix=String(currentMode).replace(/^(wechat|xiaohongshu)-/,'');
    const nextMode=`${channel}-${typeSuffix}`;
    if(nextMode!==currentMode){
      store.updateCandidateTrack(candidate.id,'social_cards',{output_mode:nextMode});
      store.saveCardEditorial(candidate.id,{...store.getCardEditorial(candidate.id),output_mode:nextMode});
    }
    const updated=store.getCandidate(candidate.id);
    return json(response,200,{outputMode:nextMode,channelMode:channel,hasPlan:Boolean(JSON.parse(store.getCardEditorial(candidate.id).card_plan_json||'[]').length),candidate:updated});
  }
  const cardEditorialAiMatch = pathname.match(/^\/api\/candidates\/(\d+)\/ai\/card-editorial$/);
  if (cardEditorialAiMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(cardEditorialAiMatch[1])); if(!candidate)return json(response,404,{error:'候选不存在'});
    const contentType=socialContentType(candidate),facts=store.getRepositoryFactSheet(candidate.id);
    let eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    if(contentType==='repository'&&!facts?.data?.sourceUrl)return json(response,409,{error:'请先完成仓库事实核验'});
    if(contentType==='event'){
      if(!eventAnalysis?.analysis?.eventSummary)return json(response,409,{error:'该事件尚无事件卡，请先在热点全景运行事件研判'});
      // 日常批次事件候选可能尚未抓取来源，生成故事板前自动补抓
      if(!(eventAnalysis.analysis.sources||[]).some((item)=>item.status==='ok')){
        const hotspots=candidateEventGroups(candidate).flatMap((group)=>group.hotspots);
        if(hotspots.length){try{await fetchCandidateSource({store,sourceFetch:config.sourceFetch,candidateId:candidate.id,root,force:false,hotspots});}catch{}}
        eventAnalysis=resolveEventAnalysisFor(candidate);
      }
    }
    if(contentType==='custom'&&facts?.data?.kind!=='custom')return json(response,409,{error:'请先填写自定义事实基座'});
    const input=await body(request); const current=store.getCardEditorial(candidate.id); const providerConfig=models.config.providers[input.provider||models.config.defaultProvider];
    try {
      const socialSkill=loadSkillBundle({workspaceRoot:root,skillName:'xiaohongshu-article-generator'});
      if(socialSkill.fallback)throw new Error('项目图文生成技能缺失');
      // 小红书渠道开放数据卡/对比卡/步骤卡/时间卡/场景卡/亮点卡版式，公众号维持基础块
      const xhsChannel=socialChannelMode(candidate)==='xiaohongshu';
      const cardBlockTypes=xhsChannel?'text|list|note|stats|compare|steps|timeline|scenes|highlight':'text|list|note';
      const repoBlockTypes=xhsChannel?'text|list|code|note|stats|compare|steps|timeline|scenes|highlight':'text|list|code|note';
      const eventSystem=`${socialSkill.prompt}\n\n## 当前运行阶段：突发事实基座到事件卡片故事板
只依据已确认事实、带来源的未核实主张、时间线和来源审计规划卡片。不得把 claims 写成事实；每个关键事实就近写明“来源 N”，未核实内容必须使用“声称/据其发布/尚未获独立证实”等边界表达。
返回严格 JSON：{"target_reader":"","pain_point":"","tool_positioning":"事件内容定位","must_highlight":"","must_disclose":"来源和未核实边界","getting_started":"","forbidden_claims":"","recommended_pages":4到10,"card_plan":[{"kind":"cover|what-happened|timeline|evidence|positions|impact|risk|ending","title":"具体页标题","goal":"用一句话说明本页的生成目标（仅供内部生成阶段使用，不会展示在卡片上），不要写成学习目标。错误示例：'读者能...'、'读者理解...'、'读者了解...'、'本页旨在...'；正确示例：'该主张仅来自单一社交媒体账号，尚未获独立证实。'、'三方回应否认了核心指控。'","evidence":["来源 N 支持的内容"],"content_blocks":[{"type":"${cardBlockTypes}","title":"可选小标题","content":"每块不超过160字，禁止出现'让读者...'、'本页旨在...'等指令描述"}]}]}。封面只呈现已支持的核心冲突；至少一页说明事实边界；若存在多方回应则单独成页；结尾不得诱导网暴。`;
      const repositorySystem=`${socialSkill.prompt}\n\n## 当前运行阶段：README 到卡片故事板
只依据已核验仓库事实和 README 生成图文决策，不得虚构体验、效果、性能、价格、权限或数字。故事板必须让读者明确回答：它是什么、解决什么具体问题、核心功能如何工作、怎样开始、适合谁、有什么限制。禁止用 GitHub topics 代替功能解释。返回严格 JSON：{"target_reader":"","pain_point":"","tool_positioning":"","must_highlight":"","must_disclose":"","getting_started":"","forbidden_claims":"","recommended_pages":4到7,"card_plan":[{"kind":"cover|problem|capability|quickstart|scenario|limitation|ending","title":"具体、有信息量的页标题","goal":"用一句话说明本页的生成目标（仅供内部生成阶段使用，不会展示在卡片上），不要写成学习目标。错误示例：'读者能...'、'读者理解...'、'读者了解...'、'本页旨在...'；正确示例：'复制命令即可安装该组件，无需额外配置。'、'相比手动实现，这个库把底层样板代码封装成一条链式 API。'","evidence":["直接支持内容的 README 或仓库事实"],"content_blocks":[{"type":"${repoBlockTypes}","title":"可选小标题","content":"文字，或 list 类型使用换行分隔；单块不超过 160 字，禁止出现'让读者...'、'本页旨在...'等指令描述"}]}]}。每页 2–4 个内容块，能力页必须写出 README 中的具体能力和工作方式，快速上手页保留真实命令，限制页明确未核验项。must_disclose 必须说明“基于项目文档整理，未实际运行”以及未知权限、网络和成熟度。`;
      const customSystem=`${socialSkill.prompt}\n\n## 当前运行阶段：自定义事实基座到卡片故事板
只依据自定义事实基座规划卡片，不得虚构体验、效果、数字或收益。体验真实性三来源等级是硬约束：source_level=author_experience 的要点可以写成第一人称亲历；user_material 必须保留来源归属；model_suggestion 只能表述为建议或参考，禁止写成亲测、效果或收益。按内容类型组织故事线：教程（cover→场景与痛点→step 分步页→注意事项→ending）；清单（cover→筛选标准→item 条目页→边界→ending）；观点（cover→核心论点→highlight 论据页→反方与边界→ending）。返回严格 JSON：{"target_reader":"","pain_point":"","tool_positioning":"内容定位","must_highlight":"","must_disclose":"来源等级与体验边界","getting_started":"","forbidden_claims":"","recommended_pages":4到10,"card_plan":[{"kind":"cover|highlight|step|item|boundary|ending","title":"具体、有信息量的页标题","goal":"用一句话说明本页的生成目标（仅供内部生成阶段使用，不会展示在卡片上），不要写成学习目标。错误示例：'读者能...'、'本页旨在...'；正确示例：'三步完成配置，第二步最容易漏。'","evidence":["事实基座中支持本页的要点，标注来源等级"],"content_blocks":[{"type":"${cardBlockTypes}","title":"可选小标题","content":"每块不超过160字，禁止出现'让读者...'、'本页旨在...'等指令描述"}]}]}。至少一页说明事实边界与限制（boundary）；model_suggestion 要点不得单独成页充当卖点。must_disclose 必须写明体验性表述来自作者确认、建议性内容未实测。`;
      const storyboardSystem=contentType==='event'?eventSystem:contentType==='custom'?customSystem:repositorySystem;
      const storyboardChannelDirective=socialChannelMode(candidate)==='xiaohongshu'
        ?'\n小红书渠道要求：页型与公众号一致（375×667），每页 2–4 个内容块；封面钩子更口语化、带好奇心；结尾页引导收藏与评论互动。除 text/list/note 外，内容块的 type 还可以使用以下版式：stats 数据卡（items:[{"num":"数字","label":"含义"}]，2–4 个，数字必须来自事实基座）、compare 对比卡（headers:["列名"],rows:[["单元格"]]，用于多方立场或产品对比）、steps 步骤卡（items:[{"title":"步骤名","content":"简述"}]，用于教程分步）、timeline 时间卡（items:[{"time":"时间","title":"事件","content":"简述"}]，用于事件时间线）、scenes 场景卡（items:[{"title":"场景","content":"简述"}]，2–3 个横排）、highlight 亮点卡（title+content，用于本页核心卖点）。使用这些版式时内容必须写入 items/headers/rows 字段，不要写入块的 content 字段。按内容选择合适版式，不要整篇都是纯文本块。'
        :'\n公众号渠道要求：页面为 9:16 长页，每页 2–4 个内容块；标题偏信息密度，结尾页引导收藏与转发。';
      const result=await models.complete({provider:input.provider,purpose:'social-card-editorial',batchId:candidate.batch_id,candidateId:candidate.id,jsonMode:true,maxOutputTokens:Math.min(6000,providerConfig.maxOutputTokens),messages:[
        {role:'system',protected:true,content:storyboardSystem+storyboardChannelDirective},
        {role:'user',protected:true,content:JSON.stringify(contentType==='event'?{topic:candidate.hotspot_title,channel_mode:current.output_mode,event_analysis:eventAnalysis.analysis}:contentType==='custom'?{topic:candidate.hotspot_title,channel_mode:current.output_mode,custom_facts:facts.data}:{topic:candidate.hotspot_title,channel_mode:current.output_mode,repository_facts:facts.data})}
      ]});
      const parsed=JSON.parse(result.content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
      const maxPages=contentType==='repository'?7:10;
      const cardPlan = (Array.isArray(parsed.card_plan) ? parsed.card_plan.slice(0,maxPages) : []).map((page) => {
        const instructionPatterns = [/^让读者(?:一眼)?知道/,/^让读者/,/^读者(?:能|会|可以|理解|了解|知道)/,/^本页(?:旨在|希望|要|应该|目的(?:是|为))?/,/^这一页(?:旨在|希望|要|应该|目的(?:是|为))?/,/^本卡(?:旨在|希望|要|应该|目的(?:是|为))?/,/^本章节(?:旨在|希望|要|应该|目的(?:是|为))?/,/^请/];
        const clean = (text) => { if(typeof text!=='string')return text; let s=text.trim(); for(const re of instructionPatterns)s=s.replace(re,'').trim(); return s.replace(/^[，。；、:：\s]+/,'').trim(); };
        return { ...page, title:clean(page.title), goal:clean(page.goal), evidence:(Array.isArray(page.evidence)?page.evidence:[]).map(clean), content_blocks:(Array.isArray(page.content_blocks)?page.content_blocks:[]).map((b)=>({...b,title:clean(b.title),content:clean(b.content)})) };
      });
      const asText=(value,fallback='')=>typeof value==='string'?value.trim():value==null?fallback:Array.isArray(value)?value.map((item)=>typeof item==='string'?item:JSON.stringify(item)).join('\n'):JSON.stringify(value);
      const editorial=store.saveCardEditorial(candidate.id,{...current,
        target_reader:asText(parsed.target_reader,current.target_reader),pain_point:asText(parsed.pain_point,current.pain_point),
        tool_positioning:asText(parsed.tool_positioning,current.tool_positioning),must_highlight:asText(parsed.must_highlight,current.must_highlight),
        must_disclose:asText(parsed.must_disclose,current.must_disclose),getting_started:asText(parsed.getting_started,current.getting_started),
        forbidden_claims:asText(parsed.forbidden_claims,current.forbidden_claims),
        recommended_pages:Math.max(4,Math.min(maxPages,Number(parsed.recommended_pages)||cardPlan.length||6)),card_plan_json:JSON.stringify(cardPlan),status:'AI_READY'});
      const gate=socialCardGate(candidate,contentType,facts,editorial,eventAnalysis); return json(response,200,{editorial,gate,cardPlan,contentType,eventAnalysis});
    } catch(error) { return json(response,502,{error:`AI 图文决策失败：${error.message}`}); }
  }
  const repositoryInspectMatch = pathname.match(/^\/api\/candidates\/(\d+)\/repository\/inspect$/);
  if (repositoryInspectMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(repositoryInspectMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    if(socialContentType(candidate)==='event')return json(response,409,{error:'事件型图文使用突发事实基座，不执行仓库核验'});
    if(socialContentType(candidate)==='custom')return json(response,409,{error:'自定义图文使用自定义事实基座，不执行仓库核验'});
    const sourceUrl=candidateRepositoryUrl(candidate); if(!sourceUrl)return json(response,409,{error:'该候选没有可核验的 GitHub 仓库地址'});
    try {
      const fact=await inspectRepository(sourceUrl,{cacheDir:path.join(root,'data','github-cache')}); const saved=store.saveRepositoryFactSheet(candidate.id,{repository:fact.repository,sourceUrl:fact.sourceUrl,status:'ok',data:fact,checkedAt:fact.stars.checkedAt});
      const score=store.getSocialScore(candidate.id);
      const batch=store.getBatch(candidate.batch_id); const dir=socialCardWorkdir(batch,candidate); const jsonPath=path.join(dir,'repository-fact-sheet.json'); const mdPath=path.join(dir,'fact-sheet.md');
      const jsonFile=writeUtf8(jsonPath,JSON.stringify(fact,null,2)); const mdFile=writeUtf8(mdPath,repositoryFactMarkdown(fact));
      store.upsertArtifact({batchId:batch.id,kind:'仓库事实基座',name:path.basename(jsonPath),path:jsonPath,...jsonFile});
      store.upsertArtifact({batchId:batch.id,kind:'图文事实清单',name:path.basename(mdPath),path:mdPath,...mdFile});
      const editorial=store.getCardEditorial(candidate.id); return json(response,200,{facts:saved,score,gate:evaluateCardGate(candidate,saved,editorial)});
    } catch(error) {
      store.saveRepositoryFactSheet(candidate.id,{sourceUrl,status:'failed',data:{},error:error.message,checkedAt:new Date().toISOString()});
      return json(response,502,{error:`仓库核验失败：${error.message}`});
    }
  }
  const cardLockMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-lock$/);
  if (cardLockMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(cardLockMatch[1])); if(!candidate)return json(response,404,{error:'候选不存在'});
    const editorial=store.getCardEditorial(candidate.id),facts=store.getRepositoryFactSheet(candidate.id),contentType=socialContentType(candidate);
    const gate=socialCardGate(candidate,contentType,facts,editorial,contentType==='event'?resolveEventAnalysisFor(candidate):null);
    if(!gate.ready)return json(response,409,{error:`CARD GATE 未通过：${gate.issues.join('；')}`,gate});
    store.saveCardEditorial(candidate.id,{...editorial,status:'LOCKED'});
    store.updateCandidateTrack(candidate.id,'social_cards',{status:'locked',locked_at:new Date().toISOString()});
    return json(response,200,{ok:true,gate,track:store.listCandidateTracks(candidate.id).find((item)=>item.track==='social_cards')});
  }
  const socialGenerateMatch = pathname.match(/^\/api\/candidates\/(\d+)\/ai\/social-card$/);
  if (socialGenerateMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(socialGenerateMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const input=await body(request);
    return json(response,202,aiJobs.start({batchId:candidate.batch_id,candidateId:candidate.id,provider:input.provider,type:'social-card'}));
  }
  const editorialMatch = pathname.match(/^\/api\/candidates\/(\d+)\/editorial$/);
  if (editorialMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(editorialMatch[1]));
    return json(response, candidate ? 200 : 404, candidate?.editorial ?? { error: '候选不存在' });
  }

  const docContentMatch=pathname.match(/^\/api\/documents\/(\d+)\/content$/);
  if (docContentMatch && request.method === "GET") {
    const doc = store.getDocumentContent(Number(docContentMatch[1]));
    if (!doc) return json(response, 404, { error: "?????" });
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return response.end(doc.content || doc.title || "");
  }


  // 编辑会自治：AI 在 fetchEvents 中列出需要原文的事件，系统抓取并把结果写入对话
  async function autoFetchEditorialEvents(candidate, fetchEvents) {
    const ids = (Array.isArray(fetchEvents) ? fetchEvents : []).map(String).slice(0, 3);
    if (!ids.length) return '';
    const groups = candidateEventGroups(candidate).filter((group) => ids.includes(group.event_id));
    const notes = [];
    for (const group of groups) {
      try {
        const r = await fetchCandidateSource({ store, sourceFetch: config.sourceFetch, candidateId: candidate.id, root, force: false, hotspots: group.hotspots });
        notes.push(`已自动抓取「${group.title}」的原文：${r.ok}/${r.count} 个来源成功`);
      } catch (error) {
        notes.push(`「${group.title}」原文抓取失败：${error.message}`);
      }
    }
    if (notes.length) store.addEditorialMessage(candidate.id, 'assistant', notes.join('\n'));
    return notes.join('\n');
  }

  const editorialAiMatch=pathname.match(/^\/api\/candidates\/(\d+)\/ai\/editorial$/);
  if(editorialAiMatch&&request.method==='POST') {
    const input=await body(request); const answer=String(input.answer||'');
    const candidateId=Number(editorialAiMatch[1]); const candidate=store.getCandidate(candidateId);
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const suppliedUrl=(answer.match(/https?:\/\/[^\s<>"']+/i)||[])[0]?.replace(/[，。；、)）\]]+$/,'');
    if(suppliedUrl)await fetchCandidateSource({store,sourceFetch:config.sourceFetch,candidateId,root,force:true,urlOverride:suppliedUrl});
    const result=await runEditorialTurn({gateway:models,store,candidateId,provider:input.provider,answer,events:candidateEventGroups(candidate,12000)});
    const fetchNote=await autoFetchEditorialEvents(candidate,result.fetchEvents);
    if(fetchNote)result.reply=[result.reply,fetchNote].filter(Boolean).join('\n\n');
    return json(response,200,result);
  }
  const editorialStreamMatch=pathname.match(/^\/api\/candidates\/(\d+)\/ai\/editorial\/stream$/);
  if(editorialStreamMatch&&request.method==='POST') {
    const input=await body(request);const answer=String(input.answer||'');
    const candidateId=Number(editorialStreamMatch[1]);const candidate=store.getCandidate(candidateId);
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const suppliedUrl=(answer.match(/https?:\/\/[^\s<>"']+/i)||[])[0]?.replace(/[，。；、）\]]+$/,'');
    response.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no','connection':'keep-alive'});
    const send=(event)=>response.write(`${JSON.stringify(event)}\n`);
    try {
      if(suppliedUrl)await fetchCandidateSource({store,sourceFetch:config.sourceFetch,candidateId,root,force:true,urlOverride:suppliedUrl});
      const result=await runEditorialTurnStream({gateway:models,store,candidateId,provider:input.provider,answer,webSearch:true,events:candidateEventGroups(candidate,12000),onText:(text)=>send({type:'delta',text})});
      const fetchNote=await autoFetchEditorialEvents(candidate,result.fetchEvents);
      if(fetchNote)send({type:'delta',text:'\n\n'+fetchNote});
      send({type:'done',data:{candidate:result.candidate,editorial:result.editorial,usage:result.usage,model:result.model}});
    } catch(error) {
      send({type:'error',error:error.message});
    }
    response.end();return true;
  }
  const sourceMatch=pathname.match(/^\/api\/candidates\/(\d+)\/source$/);
  if(sourceMatch&&request.method==='POST') {
    const input=await body(request); const candidateId=Number(sourceMatch[1]);
    const candidate=store.getCandidate(candidateId);
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const force=Boolean(input.force);
    // 支持按单个热点或单个事件抓取；默认抓取本选题全部关联事件下的热点原文
    if (input.hotspotId != null) {
      const hotspot=candidateEventGroups(candidate).flatMap((group)=>group.hotspots).find((h)=>h.id===Number(input.hotspotId));
      if(!hotspot)return json(response,404,{error:'该热点不属于本选题的关联事件'});
      return json(response,200,await fetchCandidateSource({store,sourceFetch:config.sourceFetch,candidateId,root,force,hotspots:[hotspot]}));
    }
    if (input.eventId) {
      const group=candidateEventGroups(candidate).find((g)=>g.event_id===String(input.eventId));
      if(!group)return json(response,404,{error:'该事件不属于本选题'});
      return json(response,200,await fetchCandidateSource({store,sourceFetch:config.sourceFetch,candidateId,root,force,hotspots:group.hotspots}));
    }
    const seen=new Set(); const all=[];
    for(const group of candidateEventGroups(candidate))for(const hotspot of group.hotspots) {
      if(!seen.has(hotspot.id)){seen.add(hotspot.id);all.push(hotspot);}
    }
    if(all.length)return json(response,200,await fetchCandidateSource({store,sourceFetch:config.sourceFetch,candidateId,root,force,hotspots:all}));
    return json(response,200,await fetchCandidateSource({store,sourceFetch:config.sourceFetch,candidateId,root,force}));
  }
  if (editorialMatch && request.method === 'PUT') {
    const candidateId = Number(editorialMatch[1]);
    if (!store.getCandidate(candidateId)) return json(response, 404, { error: '候选不存在' });
    return json(response, 200, store.saveEditorial(candidateId, await body(request)));
  }
  const lockMatch = pathname.match(/^\/api\/candidates\/(\d+)\/lock$/);
  if (lockMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(lockMatch[1]));
    if (!candidate) return json(response, 404, { error: '候选不存在' });
    const editorial = candidate.editorial;
    if (!candidate.thesis.trim()) return json(response, 409, { error: '请先填写并保存锁定命题' });
    if (editorial.next_action !== 'WRITE_NOW') return json(response, 409, { error: 'next_action 必须是 WRITE_NOW' });
    if (editorial.open_questions.trim()) return json(response, 409, { error: '仍有未解决问题，不能锁定简报' });
    if (editorial.experience_required && !editorial.confirmed_experiences.trim()) {
      return json(response, 409, { error: '本题依赖亲身实践，但尚未填写已确认实践' });
    }
    const batch = store.getBatch(candidate.batch_id);
    const filePath = path.join(batchWorkdir(batch), candidate.candidate_id, 'article-brief.md');
    const file = writeUtf8(filePath, lockedBrief(candidate, editorial));
    store.saveEditorial(candidate.id, { ...editorial, brief_status: 'LOCKED' });
    store.updateCandidate(candidate.id, { status: 'locked' });
    store.updateBatch(batch.id, { stage: 'drafting', status: 'running' });
    store.upsertArtifact({ batchId: batch.id, kind: '锁定简报', name: 'article-brief.md', path: filePath, ...file });
    return json(response, 200, { candidate: store.getCandidate(candidate.id), filePath });
  }
  const draftMatch = pathname.match(/^\/api\/candidates\/(\d+)\/ai\/draft$/);
  if (draftMatch && request.method === 'POST') {
    const input = await body(request);
    const result = await draftArticle({ gateway: models, store, candidateId: Number(draftMatch[1]),
      provider: input.provider, instructions: input.instructions, existingDraft: input.existingDraft });
    return json(response, 200, { content: result.content, provider: result.provider, model: result.model,
      usage: result.usage, context: { beforeTokens: result.context.beforeTokens,
        afterTokens: result.context.afterTokens, compressed: result.context.compressed } });
  }
  const articleMatch = pathname.match(/^\/api\/candidates\/(\d+)\/ai\/article$/);
  if (articleMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(articleMatch[1]));
    if (!candidate) return json(response, 404, { error: '候选不存在' });
    const input = await body(request);
    return json(response, 202, aiJobs.start({ batchId: candidate.batch_id, candidateId: candidate.id,
      provider: input.provider, type: 'article' }));
  }
  const imageWorkspaceMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images$/);
  if (imageWorkspaceMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(imageWorkspaceMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id);
    return json(response, 200, getImageWorkspace(articleWorkdir(batch, candidate)));
  }
  const imagePlanMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images\/plan$/);
  if (imagePlanMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(imagePlanMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const finalPath = path.join(workdir, '09-FINAL.md');
    if (!fs.existsSync(finalPath)) return json(response, 409, { error:'缺少 09-FINAL.md，请先完成成稿链' });
    const input = await body(request); const provider = input.provider || models.config.defaultProvider;
    const providerConfig = models.config.providers[provider];
    if (!providerConfig) return json(response, 400, { error:'未知模型服务商' });
    const original = fs.readFileSync(finalPath, 'utf8');
    const content = await planImagePlaceholders({ gateway:models, store, batchId:batch.id, candidateId:candidate.id,
      provider, markdown:original, maxOutputTokens:Math.min(3000, providerConfig.maxOutputTokens) });
    const file = writeUtf8(finalPath, content);
    const existing = store.listDocuments(batch.id).find((item) => item.candidate_row_id === candidate.id && item.kind === 'final');
    store.saveDocument({ batchId:batch.id, candidateId:candidate.id, kind:'final', title:existing?.title || candidate.hotspot_title,
      content, filePath:finalPath, status:'finalized' });
    store.upsertArtifact({ batchId:batch.id, kind:'文章终稿', name:'09-FINAL.md', path:finalPath, ...file });
    return json(response, 200, getImageWorkspace(workdir));
  }
  const imageLocalMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images\/([^/]+)\/local$/);
  if (imageLocalMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(imageLocalMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const id = decodeURIComponent(imageLocalMatch[2]); const item = getImageWorkspace(workdir).items.find((entry) => entry.id === id);
    if (!item?.localPath || !isInsideRoots(item.localPath, [workdir]) || !fs.existsSync(item.localPath)) return json(response, 404, { error:'本地图片不存在' });
    response.writeHead(200, { 'content-type':item.mimeType || mime[path.extname(item.localPath)] || 'application/octet-stream', 'cache-control':'no-store' });
    return fs.createReadStream(item.localPath).pipe(response);
  }
  const imageItemMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images\/([^/]+)$/);
  if (imageItemMatch && ['PUT','POST'].includes(request.method)) {
    const candidate = store.getCandidate(Number(imageItemMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const id = decodeURIComponent(imageItemMatch[2]); const input = await body(request);
    const item = request.method === 'POST' ? saveLocalImage(workdir, id, input) : saveImageMetadata(workdir, id, input);
    const manifestPath = imageManifestFile(workdir); const stat = fs.statSync(manifestPath);
    store.upsertArtifact({ batchId:batch.id, kind:'配图资产清单', name:path.basename(manifestPath), path:manifestPath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
    return json(response, 200, item);
  }
  const imageCdnMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images\/([^/]+)\/cdn$/);
  if (imageCdnMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(imageCdnMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const item = await uploadImageToCdn(workdir, decodeURIComponent(imageCdnMatch[2]));
    const manifestPath = imageManifestFile(workdir); const stat = fs.statSync(manifestPath);
    store.upsertArtifact({ batchId:batch.id, kind:'配图资产清单', name:path.basename(manifestPath), path:manifestPath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
    return json(response, 200, item);
  }
  const typesetMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/typeset$/);
  if (typesetMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(typesetMatch[1]);
    const input = await body(request);
    const candidate = store.getCandidate(Number(input.candidateId));
    if (!candidate || candidate.batch_id !== batchId) return json(response, 404, { error: '候选不存在或不属于当前批次' });
    return json(response, 202, aiJobs.start({ batchId, candidateId: candidate.id,
      provider: input.provider, type: 'typeset' }));
  }
  const documentsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/documents$/);
  if (documentsMatch && request.method === 'GET') {
    const batchId=decodeURIComponent(documentsMatch[1]); const cId=searchParams.get('candidateId'); const kind=searchParams.get('kind'); if(cId&&kind){var doc=store.getDocument(batchId,Number(cId),kind);if(!doc&&kind==='draft'){var arts=store.listArtifacts({batchId:batchId});var da=arts.find(function(a){return a.kind==='文章初稿'&&a.file_path&&a.file_path.toLowerCase().includes(cId.toLowerCase());});if(da&&require('fs').existsSync(da.file_path)){doc={title:da.name,content:require('fs').readFileSync(da.file_path,'utf-8')};}}return json(response,doc?200:404,doc||{error:'文档不存在'});} return json(response,200,store.listDocuments(batchId));
  }
  if (documentsMatch && request.method === 'PUT') {
    const batchId = decodeURIComponent(documentsMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error: '批次不存在' });
    const input = await body(request);
    const candidate = input.candidateId ? store.getCandidate(Number(input.candidateId)) : null;
    if (input.candidateId && !candidate) return json(response, 404, { error: '候选不存在' });
    if (!['draft','final'].includes(input.kind)) return json(response, 400, { error: '文稿类型必须是 draft 或 final' });
    const fileName = input.kind === 'final' ? '09-FINAL.md' : '04-draft.md';
    const targetDir = candidate ? articleWorkdir(batch, candidate) : batchArticlesDir(config.workspaceRoot, batch);
    const filePath = path.join(targetDir, fileName);
    const file = writeUtf8(filePath, String(input.content ?? ''));
    const document = store.saveDocument({ batchId, candidateId: candidate?.id ?? null, kind: input.kind,
      title: input.title ?? '', content: String(input.content ?? ''), filePath, status: input.status ?? 'draft' });
    store.upsertArtifact({ batchId, kind: input.kind === 'final' ? '文章终稿' : '文章初稿', name: fileName, path: filePath, ...file });
    store.updateBatch(batchId, { stage: input.kind === 'final' ? 'review' : 'drafting', status: 'running' });
    return json(response, 200, document);
  }
  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (request.method === 'GET' && pathname === '/api/jobs') {
    return json(response, 200, store.listRecentRuns(Number(searchParams.get('limit') ?? 40)));
  }
  const candidateTracksMatch = pathname.match(/^\/api\/candidates\/(\d+)\/tracks$/);
  if (candidateTracksMatch && request.method === 'POST') {
    return json(response,409,{error:'文章池与图文池使用独立评分，不支持候选跨池添加'});
  }
  const candidateTrackMatch = pathname.match(/^\/api\/candidates\/(\d+)\/tracks\/([^/]+)$/);
  if (candidateTrackMatch && request.method === 'DELETE') {
    try {
      const result = store.removeCandidateTrack(Number(candidateTrackMatch[1]), decodeURIComponent(candidateTrackMatch[2]));
      return json(response, result ? 200 : 404, result ?? { error: '候选不存在' });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  if (jobMatch && request.method === 'GET') {
    const persistedSource = /^source:(\d+)$/.exec(jobMatch[1]);
    const job = jobs.get(jobMatch[1]) ?? aiJobs.get(jobMatch[1])
      ?? (persistedSource ? store.getSourceRun(Number(persistedSource[1])) : null);
    return json(response, job ? 200 : 404, job ?? { error: '任务不存在或服务已重启' });
  }
  if (request.method === 'GET' && pathname === '/api/hotspots') {
    return json(response, 200, store.listHotspots({
      q: searchParams.get('q') ?? '', source: searchParams.get('source') ?? '',
      date: searchParams.get('date') ?? '', limit: Number(searchParams.get('limit') ?? 200),
    }));
  }
  if (request.method === 'GET' && pathname === '/api/artifacts') {
    return json(response, 200, store.listArtifacts({
      limit: Number(searchParams.get('limit') ?? 300),
      batchId: searchParams.get('batch_id') || undefined
    }));
  }
  if (request.method === 'POST' && pathname === '/api/artifacts/reindex') {
    return json(response, 200, { indexed: indexArtifacts(store, artifactRoots) });
  }
  
  if (request.method === 'GET' && pathname === '/api/articles') {
    const week = searchParams.get('week') || undefined;
    const month = searchParams.get('month') || undefined;
    return json(response, 200, store.listFinalArticles({ week, month }));
  }

  if (request.method === 'GET' && pathname === '/api/calendar') {
    const month = searchParams.get('month') || undefined;
    return json(response, 200, store.listCalendarContent({ month }));
  }

if (request.method === 'GET' && pathname === '/api/articles/stats') {
    return json(response, 200, store.articleStats());
  }
  if (request.method === 'GET' && pathname === '/api/logs') {
    const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500);
    const logType = searchParams.get('type') || undefined;
    return json(response, 200, store.listLogs({ limit, logType }));
  }
  const artifactPreviewMatch = pathname.match(/^\/api\/artifacts\/(\d+)\/preview$/);
  if (artifactPreviewMatch && request.method === 'GET') {
    const artifact = store.getArtifact(Number(artifactPreviewMatch[1]));
    if (!artifact || !isInsideRoots(artifact.file_path, artifactRoots) || !fs.existsSync(artifact.file_path)) {
      return json(response, 404, { error: '产物不存在或不在允许目录内' });
    }
    if (isImageArtifact(artifact.file_path)) {
      response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
      return response.end(imageArtifactPreviewHtml(`/api/artifacts/${artifact.id}/content`, artifact.name));
    }
    response.writeHead(302, { location:`/api/artifacts/${artifact.id}/content` });
    return response.end();
  }
  const artifactMatch = pathname.match(/^\/api\/artifacts\/(\d+)\/content$/);
  if (artifactMatch && request.method === 'GET') {
    const artifact = store.getArtifact(Number(artifactMatch[1]));
    if (!artifact || !isInsideRoots(artifact.file_path, artifactRoots) || !fs.existsSync(artifact.file_path)) {
      return json(response, 404, { error: '产物不存在或不在允许目录内' });
    }
    const extension = path.extname(artifact.file_path).toLowerCase();
    if (extension === '.html' && searchParams.get('preview') === 'phone') {
      response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
      return response.end(injectPhonePreviewStyles(fs.readFileSync(artifact.file_path, 'utf8')));
    }
    response.writeHead(200, { 'content-type': mime[extension] ?? 'text/plain; charset=utf-8' });
    return fs.createReadStream(artifact.file_path).pipe(response);
  }
  if (request.method === 'GET' && pathname === '/api/system/health') {
    const [reddit, rsshub] = await Promise.all([checkReddit(config.reddit), checkRssHub(config.rsshub)]);
    return json(response, 200, { reddit, rsshub, github:getGitHubApiHealth(), node: process.version, now: new Date().toISOString() });
  }
  if (request.method === 'GET' && pathname === '/api/subscriptions') {
    return json(response, 200, listSubscriptions(config,store.listSubscriptionHealth()));
  }
  if (request.method === 'GET' && pathname === '/api/subscriptions/health-history') {
    return json(response, 200, store.listSubscriptionHealthHistory({
      days: Number(searchParams.get('days') ?? 14),
      limit: Number(searchParams.get('limit') ?? 500),
    }));
  }
  if (request.method === 'POST' && pathname === '/api/subscriptions/test') {
    const input = subscriptionTestInput(await body(request));
    return json(response, 200, await testSubscription(config.rsshub, input));
  }
  if (request.method === 'POST' && pathname === '/api/subscriptions') {
    addSubscription(root, config, await body(request));
    return json(response, 201, listSubscriptions(config,store.listSubscriptionHealth()));
  }
  if (request.method === 'PATCH' && pathname === '/api/subscriptions') {
    updateSubscription(root, config, await body(request));
    return json(response, 200, listSubscriptions(config,store.listSubscriptionHealth()));
  }
  if (request.method === 'DELETE' && pathname === '/api/subscriptions') {
    removeSubscription(root, config, await body(request));
    return json(response, 200, listSubscriptions(config,store.listSubscriptionHealth()));
  }
  return false;
}

// Auto-start RSSHub on boot
ensureStarted(config.rsshub, (msg) => console.log(msg)).then(running => {
  if (running) console.log('RSSHub 已启动并保持运行');
}).catch(err => console.error('RSSHub 启动失败:', err.message));

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`);
    if (url.pathname.startsWith('/api/')) {
      const handled = await api(request, response, url);
      if (handled === false) json(response, 404, { error: '接口不存在' });
      return;
    }
    if (!serveStatic(response, url.pathname)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  } catch (error) {
    if(response.headersSent){if(!response.writableEnded)response.end();}
    else json(response, 500, { error: error.message });
  }
});

server.on('error', async (error) => {
  if (error.code === 'EADDRINUSE') {
    const address = `http://127.0.0.1:${config.port}`;
    try {
      const response = await fetch(`${address}/api/overview`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        console.log(`公众号工作台已经在运行：${address}`);
        process.exitCode = 0;
        return;
      }
    } catch {}
    console.error(`端口 ${config.port} 已被其它程序占用。请在 config.local.json 中修改 port 后重试。`);
    process.exitCode = 1;
    return;
  }
  console.error(`工作台启动失败：${error.message}`);
  process.exitCode = 1;
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`公众号工作台已启动：http://127.0.0.1:${config.port}`);
});
