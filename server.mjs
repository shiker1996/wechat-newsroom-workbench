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
import { clusterItems, scoreCards } from './lib/llm/research-pipeline.mjs';
import { buildHotspotAtlas } from './lib/hotspot-atlas.mjs';
import { fetchCandidateSource } from './lib/source-fetcher.mjs';
import { getImageWorkspace, saveImageMetadata, saveLocalImage, uploadImageToCdn,
  planImagePlaceholders, imageManifestFile } from './lib/image-workflow.mjs';

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
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
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
  response.writeHead(200, { 'content-type': mime[path.extname(filePath)] ?? 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
  return true;
}

function batchWorkdir(batch) {
  return path.join(config.workspaceRoot, 'topics', `${batch.batch_date}-orchestrated`);
}

function articleWorkdir(batch, candidate) {
  return path.join(config.workspaceRoot, 'articles', `${batch.batch_date}-${candidate.candidate_id.toLowerCase()}`);
}

function decorateBatch(batch) {
  if (!batch) return batch;
  let stale = 0;
  batch.hotspots = batch.hotspots.map((item) => {
    const is_stale = !isFreshForBatch(item,batch.batch_date,config.rsshub.maxAgeHours);
    if(is_stale) stale+=1;
    return {...item,is_stale};
  });
  batch.freshness={fresh:batch.hotspots.length-stale,stale,maxAgeHours:config.rsshub.maxAgeHours};
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
  const batchMatch = pathname.match(/^\/api\/batches\/([^/]+)$/);
  if (batchMatch && request.method === 'GET') {
    const batch = decorateBatch(store.getBatch(decodeURIComponent(batchMatch[1])));
    return json(response, batch ? 200 : 404, batch ?? { error: '批次不存在' });
  }
  if (batchMatch && request.method === 'PATCH') {
    const updated = store.updateBatch(decodeURIComponent(batchMatch[1]), await body(request));
    return json(response, updated ? 200 : 404, updated ?? { error: '批次不存在' });
  }
  const collectMatch = pathname.match(/^\/api\/batches\/([^/]+)\/collect$/);
  if (collectMatch && request.method === 'POST') {
    const input = await body(request);
    const sources = (input.sources ?? ['reddit', 'rsshub']).filter((item) => ['reddit', 'rsshub'].includes(item));
    if (!sources.length) return json(response, 400, { error: '没有可执行的数据源' });
    return json(response, 202, jobs.startCollection(decodeURIComponent(collectMatch[1]), sources));
  }
  const overviewMatch = pathname.match(/^\/api\/batches\/([^/]+)\/overview$/);
  if (overviewMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(overviewMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error: '批次不存在' });
    const eligible = batch.hotspots.filter((item) => isFreshForBatch(item,batch.batch_date,config.rsshub.maxAgeHours));
    const taggedCount = eligible.filter((item) => { try { const tags=JSON.parse(item.raw_json).aiTags; return Boolean(tags?.eventKey&&tags?.relevanceReason&&tags?.preScores); } catch { return false; } }).length;
    const atlas = buildHotspotAtlas({ clusters:clusterItems(eligible), totalArticles:eligible.length, taggedCount,
      excludedStale:batch.hotspots.length-eligible.length });
    // Try to enrich atlas keywords with existing hotword summaries from artifacts
    try {
      const artifactDir = path.join(config.workspaceRoot, 'topics', `${batch.batch_date}-orchestrated`, 'sources');
      const hsFile = path.join(artifactDir, 'hotword-summaries.json');
      if (fs.existsSync(hsFile)) {
        const hsData = JSON.parse(fs.readFileSync(hsFile, 'utf8'));
        if (hsData?.items?.length) {
          const summaryMap = new Map();
          for (const item of hsData.items) summaryMap.set(item.hotword?.toLowerCase(), item.summary);
          for (const kw of atlas.keywords) {
            const s = summaryMap.get(kw.name.toLowerCase());
            if (s && !kw.summary) kw.summary = s;
          }
        }
      }
    } catch (e) { /* hotword summaries not available yet — non-blocking */ }
    return json(response, 200, atlas);
  }
  const hotwordSummaryMatch = pathname.match(/^\/api\/batches\/([^/]+)\/hotword-summary\/(.+)$/);
  if (hotwordSummaryMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(hotwordSummaryMatch[1]);
    const hotword = decodeURIComponent(hotwordSummaryMatch[2]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error: '批次不存在' });
    const eligible = batch.hotspots.filter((item) => isFreshForBatch(item,batch.batch_date,config.rsshub.maxAgeHours));
    const clusters = clusterItems(eligible);
    const matchedEvents = clusters.filter(event => (event.keywords||[]).some(kw => kw.toLowerCase() === hotword.toLowerCase()));
    if (!matchedEvents.length) return json(response, 404, { error: '该热词没有匹配事件' });
    try {
      const input = [{ hotword, related_event_count: matchedEvents.length, related_articles: matchedEvents.flatMap(e => e.articles.map(a => ({ event_id: e.event_id, title: a.title, source: a.source }))) }];
      const providerConfig = models.config.providers[models.config.defaultProvider];
      const result = await models.complete({
        purpose: 'hotword-summary', batchId, jsonMode: true,
        maxOutputTokens: Math.min(2000, providerConfig.maxOutputTokens),
        messages: [
          { role: 'system', content: '你是热词综述生成器。请为以下热词生成一段综合性的跨事件摘要（中文，200字以内），说明核心叙事、多来源视角、对国内科技/互联网受众的意义。返回 JSON：{"hotword":"...","summary":"...","event_count":N}', protected: true },
          { role: 'user', content: JSON.stringify(input), protected: true },
        ],
      });
      let summary;
      try { summary = JSON.parse(result.content.trim().replace(/^```(?:json)?\\s*/i, '').replace(/\\s*```$/, '')).summary; } catch { summary = ''; }
      if (!summary) return json(response, 500, { error: '模型输出无效' });
      const artifactDir = path.join(config.workspaceRoot, 'topics', `${batch.batch_date}-orchestrated`, 'sources');
      const hsFile = path.join(artifactDir, 'hotword-summaries.json');
      let hsData = { generated_at: new Date().toISOString(), items: [] };
      try { if (fs.existsSync(hsFile)) hsData = JSON.parse(fs.readFileSync(hsFile, 'utf8')); } catch {}
      hsData.items = hsData.items.filter(item => item.hotword?.toLowerCase() !== hotword.toLowerCase());
      hsData.items.push({ hotword, summary, event_count: matchedEvents.length });
      hsData.generated_at = new Date().toISOString();
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(hsFile, JSON.stringify(hsData, null, 2));
      store.updateModelCall(result.callId, { status: 'done', inputTokens: result.usage?.prompt_tokens, outputTokens: result.usage?.completion_tokens });
      return json(response, 200, { summary, event_count: matchedEvents.length });
    } catch (e) {
      return json(response, 500, { error: '生成失败：' + e.message });
    }
  }
  const tagMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/tag$/);
  if (tagMatch && request.method === 'POST') {
    const input = await body(request);
    if (input.background === true) return json(response, 202, aiJobs.start({ batchId:decodeURIComponent(tagMatch[1]),
      provider:input.provider,type:input.force?'retag':'tag',force:Boolean(input.force) }));
    const result = await tagBatch({ gateway: models, store, batchId: decodeURIComponent(tagMatch[1]),
      provider: input.provider, limit: input.limit, force:Boolean(input.force) });
    return json(response, 200, result);
  }
  const researchMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/research$/);
  if (researchMatch && request.method === 'POST') {
    const input=await body(request);
    return json(response,202,aiJobs.start({batchId:decodeURIComponent(researchMatch[1]),provider:input.provider,type:'research'}));
  }
  const candidatesMatch = pathname.match(/^\/api\/batches\/([^/]+)\/candidates$/);
  if (candidatesMatch && request.method === 'GET') {
    return json(response, 200, store.listCandidates(decodeURIComponent(candidatesMatch[1])));
  }
  if (candidatesMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(candidatesMatch[1]);
    const input = await body(request);
    if (!Array.isArray(input.hotspotIds)) return json(response, 400, { error: 'hotspotIds 必须是数组' });
    return json(response, 201, store.addCandidates(batchId, input.hotspotIds));
  }
  const compositeMatch = pathname.match(/^\/api\/batches\/([^/]+)\/candidates\/composite$/);
  if (compositeMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(compositeMatch[1]);
    const input = await body(request);
    if (!Array.isArray(input.hotspotIds) || input.hotspotIds.length < 2) return json(response, 400, { error: '综合选题至少需要 2 个热点' });
    const composite = store.createCompositeCandidate(batchId, input.hotspotIds, input);
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
  const candidateMatch = pathname.match(/^\/api\/candidates\/(\d+)$/);
  if (candidateMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(candidateMatch[1]));
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
  const editorialMatch = pathname.match(/^\/api\/candidates\/(\d+)\/editorial$/);
  if (editorialMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(editorialMatch[1]));
    return json(response, candidate ? 200 : 404, candidate?.editorial ?? { error: '候选不存在' });
  }
  const editorialAiMatch=pathname.match(/^\/api\/candidates\/(\d+)\/ai\/editorial$/);
  if(editorialAiMatch&&request.method==='POST') {
    const input=await body(request); const answer=String(input.answer||'');
    const candidateId=Number(editorialAiMatch[1]); const candidate=store.getCandidate(candidateId);
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const suppliedUrl=(answer.match(/https?:\/\/[^\s<>"']+/i)||[])[0]?.replace(/[，。；、)）\]]+$/,'');
    if(suppliedUrl)await fetchCandidateSource({store,candidateId,root,force:true,urlOverride:suppliedUrl});
    else if(!candidate.source_document)await fetchCandidateSource({store,candidateId,root});
    return json(response,200,await runEditorialTurn({gateway:models,store,candidateId,provider:input.provider,answer}));
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
      if(suppliedUrl)await fetchCandidateSource({store,candidateId,root,force:true,urlOverride:suppliedUrl});
      else if(!candidate.source_document)await fetchCandidateSource({store,candidateId,root});
      const result=await runEditorialTurnStream({gateway:models,store,candidateId,provider:input.provider,answer,webSearch:true,onText:(text)=>send({type:'delta',text})});
      send({type:'done',data:{candidate:result.candidate,editorial:result.editorial,usage:result.usage,model:result.model}});
    } catch(error) {
      send({type:'error',error:error.message});
    }
    response.end();return true;
  }
  const sourceMatch=pathname.match(/^\/api\/candidates\/(\d+)\/source$/);
  if(sourceMatch&&request.method==='POST') {
    const input=await body(request); const candidateId=Number(sourceMatch[1]);
    if(!store.getCandidate(candidateId))return json(response,404,{error:'候选不存在'});
    return json(response,200,await fetchCandidateSource({store,candidateId,root,force:Boolean(input.force)}));
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
    const mode = input.mode === 'preview' ? 'preview' : 'local';
    return json(response, 202, aiJobs.start({ batchId, candidateId: candidate.id,
      provider: input.provider, type: 'typeset', mode }));
  }
  const documentsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/documents$/);
  if (documentsMatch && request.method === 'GET') {
    return json(response, 200, store.listDocuments(decodeURIComponent(documentsMatch[1])));
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
    const targetDir = candidate ? articleWorkdir(batch, candidate) : path.join(config.workspaceRoot, 'articles', batch.batch_date);
    const filePath = path.join(targetDir, fileName);
    const file = writeUtf8(filePath, String(input.content ?? ''));
    const document = store.saveDocument({ batchId, candidateId: candidate?.id ?? null, kind: input.kind,
      title: input.title ?? '', content: String(input.content ?? ''), filePath, status: input.status ?? 'draft' });
    store.upsertArtifact({ batchId, kind: input.kind === 'final' ? '文章终稿' : '文章初稿', name: fileName, path: filePath, ...file });
    store.updateBatch(batchId, { stage: input.kind === 'final' ? 'review' : 'drafting', status: 'running' });
    return json(response, 200, document);
  }
  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && request.method === 'GET') {
    const job = jobs.get(jobMatch[1]) ?? aiJobs.get(jobMatch[1]);
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
  if (request.method === 'GET' && pathname === '/api/articles/stats') {
    return json(response, 200, store.articleStats());
  }
  if (request.method === 'GET' && pathname === '/api/logs') {
    const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500);
    const logType = searchParams.get('type') || undefined;
    return json(response, 200, store.listLogs({ limit, logType }));
  }
  const artifactMatch = pathname.match(/^\/api\/artifacts\/(\d+)\/content$/);
  if (artifactMatch && request.method === 'GET') {
    const artifact = store.getArtifact(Number(artifactMatch[1]));
    if (!artifact || !isInsideRoots(artifact.file_path, artifactRoots) || !fs.existsSync(artifact.file_path)) {
      return json(response, 404, { error: '产物不存在或不在允许目录内' });
    }
    response.writeHead(200, { 'content-type': mime[path.extname(artifact.file_path)] ?? 'text/plain; charset=utf-8' });
    return fs.createReadStream(artifact.file_path).pipe(response);
  }
  if (request.method === 'GET' && pathname === '/api/system/health') {
    const [reddit, rsshub] = await Promise.all([checkReddit(config.reddit), checkRssHub(config.rsshub)]);
    return json(response, 200, { reddit, rsshub, node: process.version, now: new Date().toISOString() });
  }
  if (request.method === 'GET' && pathname === '/api/subscriptions') {
    return json(response, 200, listSubscriptions(config,store.listSubscriptionHealth()));
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
