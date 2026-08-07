import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { backup as backupSqlite } from 'node:sqlite';
import { Store } from './lib/core/store.mjs';
import { loadConfig } from './lib/core/config.mjs';
import { isInsideRoots } from './lib/artifacts/artifact-indexer.mjs';
import { JobManager } from './lib/jobs/job-manager.mjs';
import { ensureStarted } from './collectors/rsshub.mjs';
import { ModelGateway } from './lib/llm/gateway.mjs';
import { draftArticle, tagBatch } from './lib/llm/tasks.mjs';
import { isFreshForBatch } from './lib/llm/research-pipeline.mjs';
import { loadEnv } from './lib/core/env.mjs';
import { AiJobManager } from './lib/llm/ai-job-manager.mjs';
import { runEditorialTurn, runEditorialTurnStream } from './lib/llm/editorial-room.mjs';
import { clusterItems, preselection, scoreCards, selectSocialCandidates, ensureBatchEventCards } from './lib/llm/research-pipeline.mjs';
import { buildHotspotAtlas } from './lib/domain/hotspot-atlas.mjs';
import { fetchCandidateSource } from './lib/integrations/source-fetcher.mjs';
import { getImageWorkspace, saveImageMetadata, saveLocalImage, uploadImageToCdn,
  planImagePlaceholders, imageManifestFile } from './lib/llm/image-workflow.mjs';
import { inspectRepositoryViaRegistry as inspectRepository, repositoryFactMarkdown } from './lib/integrations/repository-inspector.mjs';
import { evaluateCardGate, evaluateEventCardGate, evaluateCustomCardGate } from './lib/domain/social-card-gate.mjs';
import { buildCustomFactSheet, customFactMarkdown, customSourceUrl } from './lib/domain/custom-fact-builder.mjs';
import { createRepositoryCandidate } from './lib/domain/repository-candidate.mjs';
import { runCustomSocialChatStream } from './lib/llm/custom-social-chat.mjs';
import { runTutorialChatStream } from './lib/llm/tutorial-chat.mjs';
import { extractLocalProjectPath, readLocalProjectViaRegistry as readLocalProject } from './lib/integrations/local-project-reader.mjs';
import { resolveSkillToolPolicy } from './lib/skills/pipeline-runtime.mjs';
import { attachInformationSearch } from './lib/integrations/information-search.mjs';
import { resolveArticleStageSkills, resolveEntryWriterSkill } from './lib/skills/entry-routing.mjs';
import { eventGroupsForCandidate, resolveEventAnalysis } from './lib/domain/event-fact-base.mjs';
import { loadSkillBundle } from './lib/llm/skill-runtime.mjs';
import { createZip } from './lib/artifacts/zip-bundle.mjs';
import { batchArticlesDir, batchTopicsDir, candidateArticleDir, candidateSocialCardDir } from './lib/core/workspace-paths.mjs';
import { getBatchDeleteImpact, deleteBatchPermanently } from './lib/domain/batch-deletion.mjs';
import { routeBreakingAnalysis } from './lib/llm/breaking-analysis-pipeline.mjs';
import { dailyFocusOptions } from './lib/llm/daily-pipeline.mjs';
import { SOCIAL_CARD_COMPOSITION_MODES, SOCIAL_CARD_LAYOUTS, describeCardLayouts, normalizeCardComposition } from './lib/llm/social-card-pipeline.mjs';
import { analyzeVisualComplexity, planArticleVisuals } from './lib/llm/visual-planner.mjs';
import { defaultTypesetTheme, TYPESET_THEMES } from './lib/llm/typeset-pipeline.mjs';
import { isResearchEligibleHotspot } from './lib/domain/hotspot-pipeline-scope.mjs';
import { buildBatchPipelineStatus } from './lib/domain/batch-pipeline-status.mjs';
import { handleContentRoutes } from './lib/http/routes/content-routes.mjs';
import { handleModelRoutes } from './lib/http/routes/model-routes.mjs';
import { handleSystemRoutes } from './lib/http/routes/system-routes.mjs';
import { handleMediaRoutes } from './lib/http/routes/media-routes.mjs';
import { handleArticleRoutes } from './lib/http/routes/article-routes.mjs';
import { handleSocialCardRoutes } from './lib/http/routes/social-card-routes.mjs';
import { handleThemeRoutes } from './lib/http/routes/theme-routes.mjs';
import { seedDemoData } from './lib/demo/seed.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
loadEnv(root);
const config = loadConfig(root);
// --demo / WORKBENCH_DEMO=1：无模型服务商时也能预览各视图，使用独立演示库，不污染真实数据。
const demo = process.argv.includes('--demo') || process.env.WORKBENCH_DEMO === '1';
const store = new Store(path.join(root, 'data', demo ? 'demo.db' : 'workbench.db'));
if (demo) {
  const seedResult = seedDemoData(store, { root });
  if (seedResult.seeded) console.log(`演示模式：已写入演示批次（${seedResult.todayBatchId} / ${seedResult.yesterdayBatchId}）`);
}
const recovered = store.recoverInterruptedWork();
if (Object.values(recovered).some(Number)) console.log(`已恢复上次中断状态：${JSON.stringify(recovered)}`);
const jobs = new JobManager(store, config, () => models);

function customArticleFingerprint(batchId,input={}) {
  const normalized={};
  for(const key of ['articleMode','skillId','topic','audience','thesis','environment','points','steps','prerequisites','expected_results','common_errors','limitations','materialUrls','localProjectPath']){
    const value=input[key];
    normalized[key]=Array.isArray(value)
      ? value.map((item)=>String(item||'').trim()).filter(Boolean)
      : String(value||'').trim().replace(/\r\n/g,'\n');
  }
  normalized.stageSkills=Object.fromEntries(Object.entries(input.stageSkills||{}).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,value])=>[key,String(value||'').trim()]));
  return crypto.createHash('sha256').update(JSON.stringify({batchId,...normalized})).digest('hex');
}
const models = new ModelGateway(config, store);
const aiJobs = new AiJobManager(store, models, config);
const artifactRoots = [config.workspaceRoot, ...config.contentRoots];
const publicRoot = path.join(root, 'public');
const execFileAsync = promisify(execFile);

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

async function binaryBody(request,maxBytes=100_000_000) {
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>maxBytes)throw new Error('备份包超过 100 MB 限制');chunks.push(chunk);}
  return Buffer.concat(chunks);
}

async function createWorkbenchBackup() {
  const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'write-assistant-backup-'));
  try {
    const dbFile=path.join(tempDir,'workbench.db');
    await backupSqlite(store.db,dbFile);
    const files=[{name:'data/workbench.db',path:dbFile}];
    for(const name of ['config.local.json','account-context.json']){
      const filePath=path.join(root,name);
      if(fs.existsSync(filePath))files.push({name,path:filePath});
    }
    for(const name of ['tool-plugin-settings.json','information-capability-slots.json']){
      const settingsFile=path.join(root,'data',name);
      if(fs.existsSync(settingsFile))files.push({name:`data/${name}`,path:settingsFile});
    }
    for(const name of ['skill-packages.json','skill-install-events.jsonl','tool-plugins.json','tool-plugin-install-events.jsonl',
      'remote-tool-plugins.json','remote-tool-plugin-events.jsonl']){
      const filePath=path.join(root,'data',name);
      if(fs.existsSync(filePath))files.push({name:`data/${name}`,path:filePath});
    }
    for(const directoryName of ['installed-skills','skill-package-archive','installed-tool-plugins','tool-plugin-archive']){
      const directory=path.join(root,'data',directoryName);
      if(fs.existsSync(directory)){
        const visit=(current)=>{
          for(const entry of fs.readdirSync(current,{withFileTypes:true})){
            const filePath=path.join(current,entry.name);
            if(entry.isDirectory())visit(filePath);
            else if(entry.isFile())files.push({name:path.relative(root,filePath).replaceAll('\\','/'),path:filePath});
          }
        };
        visit(directory);
      }
    }
    const writingSkillsRoot=path.join(root,'writing-skills');
    if(fs.existsSync(writingSkillsRoot)){
      for(const skill of fs.readdirSync(writingSkillsRoot,{withFileTypes:true}).filter((entry)=>entry.isDirectory())){
        const active=path.join(writingSkillsRoot,skill.name,'active.json');
        if(fs.existsSync(active))files.push({name:`writing-skills/${skill.name}/active.json`,path:active});
      }
    }
    const manifest={schemaVersion:1,createdAt:new Date().toISOString(),appVersion:'0.1.0',
      excludes:['.env','API tokens','node_modules','cache/log files'],
      files:files.map((file)=>({name:file.name,size:fs.statSync(file.path).size,
        sha256:crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex')}))};
    const manifestPath=path.join(tempDir,'manifest.json');
    fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2),'utf8');
    files.unshift({name:'manifest.json',path:manifestPath});
    if(!manifest.files.every((item)=>item.size>0&&item.sha256.length===64))throw new Error('备份完整性校验失败');
    return {buffer:createZip(files),manifest};
  } finally { fs.rmSync(tempDir,{recursive:true,force:true}); }
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
    const freshItems = batch.hotspots.filter((item) => !item.is_stale && isResearchEligibleHotspot(item));
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
  if (await handleModelRoutes({ request, response, pathname, root, config, store, models, body, json })) return;
  if (await handleThemeRoutes({ request, response, pathname, searchParams, json, store, body, models })) return;
  if (await handleContentRoutes({ request, response, pathname, searchParams, store, artifactRoots, mime, json })) return;
  if (await handleSystemRoutes({ request, response, pathname, searchParams, root, config, store, json, body,
    binaryBody, createWorkbenchBackup })) return;
  const mediaResult = await handleMediaRoutes({ request, response, pathname, searchParams, store, config, json, body, path, fs, os, mime, root, execFileAsync, isInsideRoots, getImageWorkspace, batchArticlesDir, saveLocalImage, uploadImageToCdn, articleWorkdir, models, planImagePlaceholders, writeUtf8, saveImageMetadata, imageManifestFile, aiJobs, planArticleVisuals, defaultTypesetTheme, TYPESET_THEMES, analyzeVisualComplexity });
  if (mediaResult !== false) return mediaResult;
  const articleResult = await handleArticleRoutes({ request, response, pathname, store, json, body, candidateEventGroups, fetchCandidateSource, config, root, runEditorialTurn, runEditorialTurnStream, writeUtf8, path, batchWorkdir, lockedBrief, draftArticle, models, aiJobs });
  if (articleResult !== false) return articleResult;
  const socialCardResult = await handleSocialCardRoutes({ request, response, pathname, searchParams, store, json, body, path, fs, root, config, mime, models, aiJobs, socialCardFiles, isInsideRoots, createZip, socialContentType, resolveEventAnalysisFor, socialCardGate, socialChannelMode, describeCardLayouts, SOCIAL_CARD_LAYOUTS, SOCIAL_CARD_COMPOSITION_MODES, normalizeCardComposition, loadSkillBundle, fetchCandidateSource, candidateEventGroups, candidateRepositoryUrl, inspectRepository, socialCardWorkdir, writeUtf8, repositoryFactMarkdown, evaluateCardGate });
  if (socialCardResult !== false) return socialCardResult;
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
        const tagged = batch.hotspots.filter((item) => !item.is_stale && isResearchEligibleHotspot(item)).filter((item) => {
          try { const tags = JSON.parse(item.raw_json).aiTags; return Boolean(tags?.eventKey && tags?.preScores); } catch { return false; }
        });
        const cardTotal = clusterItems(tagged).length;
        // 同日常规批次共享 topics 工作目录：本批还没有已打标事件时，目录里的卡属于其他批次，不能计入进度
        batch.event_cards = { count: cardTotal ? Math.min(cardCount, cardTotal) : 0, total: cardTotal };
      } catch { batch.event_cards = { count: 0, total: 0 }; }
      batch.pipeline_status = buildBatchPipelineStatus({
        hotspotCount: batch.ai_status.total,
        tagged: batch.ai_status.tagged,
        total: batch.ai_status.total,
        cardsCount: batch.event_cards.count,
        cardsTotal: batch.event_cards.total,
        latestResearch: batch.ai_status.latestResearch,
      });
    }
    return json(response, batch ? 200 : 404, batch ?? { error: '批次不存在' });
  }
  if (batchMatch && request.method === 'PATCH') {
    const input=await body(request);
    if(input.lifecycleStatus!=null){
      if(!['active','completed','archived'].includes(input.lifecycleStatus))return json(response,400,{error:'批次生命周期状态无效'});
      input.lifecycle_status=input.lifecycleStatus;
      delete input.lifecycleStatus;
    }
    const updated = store.updateBatch(decodeURIComponent(batchMatch[1]), input);
    return json(response, updated ? 200 : 404, updated ?? { error: '批次不存在' });
  }
  const batchDeleteImpactMatch = pathname.match(/^\/api\/batches\/([^/]+)\/delete-impact$/);
  if (batchDeleteImpactMatch && request.method === 'GET') {
    const impact = getBatchDeleteImpact(root, store, decodeURIComponent(batchDeleteImpactMatch[1]));
    return json(response, impact ? 200 : 404, impact ?? { error: '批次不存在' });
  }
  if (batchMatch && request.method === 'DELETE') {
    const batchId = decodeURIComponent(batchMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error: '批次不存在' });
    if ((batch.lifecycle_status || 'active') !== 'archived') return json(response, 409, { error: '只有已归档批次可以彻底删除，请先归档' });
    if (request.headers['x-admin-confirm'] !== 'DELETE-BATCH') return json(response, 400, { error: '缺少彻底删除确认头 x-admin-confirm: DELETE-BATCH' });
    const result = deleteBatchPermanently(root, store, batchId);
    return json(response, 200, { ok: true, ...result });
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
    if(!items.length){const eligible=batch.hotspots.filter(isResearchEligibleHotspot).filter((item)=>isFreshForBatch(item,batch.batch_date,batchMaxAgeHours(batch)));
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
    const eligible = batch.hotspots.filter(isResearchEligibleHotspot).filter((item) => isFreshForBatch(item,batch.batch_date,batchMaxAgeHours(batch)));
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
      maxAgeHours: batchMaxAgeHours(store.getBatch(decodeURIComponent(tagMatch[1]))), workspaceRoot: config.workspaceRoot });
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
  const dailyMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily$/);
  if (dailyMatch && request.method === 'GET') {
    const batchId=decodeURIComponent(dailyMatch[1]),batch=store.getBatch(batchId);
    if(!batch)return json(response,404,{error:'批次不存在'});
    let eventCards=[],focusOptions=[];
    try {
      const cardFile=path.join(batchWorkdir(batch),'sources','event-cards.json');
      if(fs.existsSync(cardFile)){
        eventCards=JSON.parse(fs.readFileSync(cardFile,'utf8'))?.items||[];
        const cardMap=new Map(eventCards.map((item)=>[item.event_id,item]));
        const eligible=batch.hotspots.filter(isResearchEligibleHotspot).filter((item)=>isFreshForBatch(item,batch.batch_date,batchMaxAgeHours(batch)));
        const clusters=clusterItems(eligible);
        for(const event of clusters)event.card=cardMap.get(event.event_id)||null;
        focusOptions=dailyFocusOptions(clusters);
      }
    } catch {}
    const documents=store.listDocuments(batchId).filter((item)=>item.kind==='daily-draft'||item.kind==='daily-final');
    const jobs=store.listAiRuns(batchId,30).filter((job)=>job.type==='daily').slice(0,5)
      .map((job)=>{let focuses=[];try{const parsed=JSON.parse(job.result_json||'{}');if(Array.isArray(parsed.focuses))focuses=parsed.focuses;}catch{}
      return {id:job.id,status:job.status,progress:job.progress,error:job.error,provider:job.provider,focuses,createdAt:job.created_at,updatedAt:job.updated_at};});
    return json(response,200,{batch:{id:batch.id,title:batch.title,batchDate:batch.batch_date,batchType:batch.batch_type},eventCards,focusOptions,documents,jobs});
  }
  if (dailyMatch && request.method === 'POST') {
    const batchId=decodeURIComponent(dailyMatch[1]),batch=store.getBatch(batchId);
    if(!batch)return json(response,404,{error:'批次不存在'});
    const input=await body(request);
    const requestedStages=input.stageSkills&&typeof input.stageSkills==='object'?input.stageSkills:{};
    const hasExplicitStages=Object.values(requestedStages).some((value)=>String(value||'').trim());
    const previousSnapshot=(input.useLatestSkill===true||hasExplicitStages)?null:store.findLatestGenerationSnapshot({
      batchId,candidateId:null,purposes:['daily'],
    });
    const stageSelections=previousSnapshot?null:await resolveArticleStageSkills({
      workspaceRoot:root,entryPoint:'batch-daily',requested:requestedStages,
    });
    return json(response,202,aiJobs.start({batchId,provider:previousSnapshot?null:input.provider,type:'daily',
      snapshotId:previousSnapshot?.id||null,stageSelections,
      focuses:Array.isArray(input.focuses)?input.focuses:[],focus:input.focus||null}));
  }
  const candidatesMatch = pathname.match(/^\/api\/batches\/([^/]+)\/candidates$/);
  function loadBatchEventCards(batch) {
  try {
    const cardFile = path.join(batchWorkdir(batch), 'sources', 'event-cards.json');
    if (!fs.existsSync(cardFile)) return null;
    const cardMap = new Map((JSON.parse(fs.readFileSync(cardFile, 'utf8'))?.items || []).map((item) => [item.event_id, item]));
    if (!cardMap.size) return null;
    const eligible = batch.hotspots.filter(isResearchEligibleHotspot).filter((item) => isFreshForBatch(item, batch.batch_date, batchMaxAgeHours(batch)));
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
  // 实现已下沉到 lib/domain/event-fact-base.mjs，供事件图文事实基座在管线侧复用
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
      const kind = searchParams.get('kind') || 'all';
      let candidates = store.listCandidates(batchId, track);
      if(track==='article'&&kind!=='all'){
        const independent=(item)=>['wechat-experience','wechat-tutorial'].includes(String(item.output_mode||''));
        candidates=candidates.filter((item)=>kind==='independent'?independent(item):kind==='hotspot'?!independent(item):true);
      }
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
        onThinking: (text) => send({ type: 'thinking', text }),
      });
      send({ type: 'done', data: { reply: result.reply, formUpdates: result.formUpdates, ready: result.ready, usage: result.usage, model: result.model } });
    } catch (error) {
      send({ type: 'error', error: error.message });
    }
    response.end(); return true;
  }
  // 手动添加仓库图文候选（工具图文）：输入 GitHub 仓库地址直接立项，核验与故事板走既有流程
  const repositorySocialMatch = pathname.match(/^\/api\/batches\/([^/]+)\/repository-candidates$/);
  if (repositorySocialMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(repositorySocialMatch[1]);
    if (!store.getBatch(batchId)) return json(response, 404, { error: '批次不存在' });
    const input = await body(request);
    try {
      const candidate = createRepositoryCandidate({ store, batchId, url: input.url, channel: input.channel });
      return json(response, 201, { candidate });
    } catch (error) {
      return json(response, 400, { error: `添加仓库图文失败：${error.message}` });
    }
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
              const toolPolicy = await resolveSkillToolPolicy({ workspaceRoot: root, skillId: 'custom-card-storyboard' });
        await attachInformationSearch({ fact, input, root, toolContext: { store, batchId, skillId: 'custom-card-storyboard', allowedCapabilities: toolPolicy.allowedCapabilities }, documentRoots: config.documentSearch?.roots || [] });
      const materialUrls = (fact.materials || []).map((item) => item.url);
      const hotspot = store.addManualHotspot(batch.id, { title: fact.topic, url: materialUrls[0] || null, materialUrls, notes: `自定义图文（${fact.content_type_label}）`, researchEligible:false });
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
  // 教程策划可按用户明确给出的目录读取本地项目；只读文本文件，跳过依赖、密钥与符号链接。
  if(pathname==='/api/tools/local-project/read'&&request.method==='POST'){
    const input=await body(request);
    try{
      const project=await readLocalProject(input.path,{toolContext:{store}});
      return json(response,200,{root:project.root,summary:project.summary,files:project.files.map(({path:sizePath,size,truncated})=>({path:sizePath,size,truncated})),skipped:project.skipped,truncated:project.truncated});
    }catch(error){return json(response,400,{error:`读取本地项目失败：${error.message}`});}
  }
  const tutorialChatMatch=pathname.match(/^\/api\/batches\/([^/]+)\/tutorial-chat\/stream$/);
  if(tutorialChatMatch&&request.method==='POST'){
    const batchId=decodeURIComponent(tutorialChatMatch[1]);
    if(!store.getBatch(batchId))return json(response,404,{error:'批次不存在'});
    const input=await body(request),draft=input.draft&&typeof input.draft==='object'?{...input.draft}:{};
    const tutorialMode=String(draft.articleMode||'').trim()==='tutorial'||/教程|项目|仓库/.test(String(input.answer||''));
    const detectedPath=tutorialMode?(String(draft.localProjectPath||'').trim()||extractLocalProjectPath(input.answer)):'';
    let projectContext=null,projectReadError='';
    if(detectedPath){
      draft.localProjectPath=detectedPath;
      try{
        const toolPolicy=await resolveSkillToolPolicy({workspaceRoot:root,skillId:'wechat-mp-tutorial'});
        projectContext=await readLocalProject(detectedPath,{toolContext:{store,batchId,
          skillId:'wechat-mp-tutorial',allowedCapabilities:toolPolicy.allowedCapabilities}});
      }
      catch(error){projectReadError=error.message;}
    }
    response.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no','connection':'keep-alive'});
    const send=(event)=>response.write(`${JSON.stringify(event)}\n`);
    try{
      const result=await runTutorialChatStream({gateway:models,store,provider:input.provider,batchId,draft,history:Array.isArray(input.history)?input.history:[],answer:String(input.answer||''),projectContext,projectReadError,onText:(text)=>send({type:'delta',text}),onThinking:(text)=>send({type:'thinking',text})});
      send({type:'done',data:{...result,project:projectContext?{root:projectContext.root,summary:projectContext.summary,files:projectContext.files.map((item)=>item.path),truncated:projectContext.truncated}:null,projectReadError}});
    }catch(error){send({type:'error',error:error.message});}
    response.end();return true;
  }
  // `/tutorials` 保留兼容；新入口统一称为自主写作。
  const tutorialMatch=pathname.match(/^\/api\/batches\/([^/]+)\/(?:custom-articles|tutorials)$/);
  if(tutorialMatch&&request.method==='GET'){
    const batchId=decodeURIComponent(tutorialMatch[1]);
    if(!store.getBatch(batchId))return json(response,404,{error:'批次不存在'});
    const projects=store.listCustomArticleProjects(batchId).map((item)=>{
      const projectStatus=item.document_id?'draft_ready'
        : item.job_status==='running'?'generating'
          : ['failed','interrupted'].includes(item.job_status)?'failed':'ready_to_generate';
      return {...item,project_status:projectStatus};
    });
    return json(response,200,projects);
  }
  if(tutorialMatch&&request.method==='POST'){
    const batchId=decodeURIComponent(tutorialMatch[1]),batch=store.getBatch(batchId);
    if(!batch)return json(response,404,{error:'批次不存在'});
    const input=await body(request);
    try{
      const articleMode=String(input.articleMode||'tutorial').trim()==='experience'?'experience':'tutorial';
      const recommendedSkillId=articleMode==='experience'?'wechat-mp-personal-writing':'wechat-mp-tutorial';
      const skillSelection=await resolveEntryWriterSkill({
        workspaceRoot:root,entryPoint:'independent-writing',contentType:articleMode,
        requestedSkillId:String(input.skillId||''),recommendedSkillId,
      });
      const stageSelections=await resolveArticleStageSkills({
        workspaceRoot:root,entryPoint:'independent-writing',
        requested:input.stageSkills&&typeof input.stageSkills==='object'?input.stageSkills:{},
      });
      const fingerprint=customArticleFingerprint(batchId,input);
      const requestId=String(input.creationRequestId||fingerprint).trim();
      let creation=store.findCustomArticleRequest(batchId,{requestId,fingerprint})
        ||store.createCustomArticleRequest({batchId,requestId,fingerprint});
      if(creation?.candidate_row_id){
        const candidate=store.getCandidate(creation.candidate_row_id);
        let job=creation.latest_job_id?aiJobs.get(creation.latest_job_id):null;
        if(candidate&&!job){
          job=aiJobs.start({batchId,candidateId:candidate.id,provider:input.provider,type:'tutorial',skillSelection,stageSelections});
          store.updateCustomArticleRequest(creation.id,{latestJobId:job.id});
        }
        if(candidate&&job)return json(response,200,{...job,candidate,reused:true});
      }
      let project=null;
      if(articleMode==='tutorial'&&String(input.localProjectPath||'').trim()){
        const toolPolicy=await resolveSkillToolPolicy({workspaceRoot:root,skillId:skillSelection.selectedSkill});
        project=await readLocalProject(input.localProjectPath,{toolContext:{store,batchId,
          skillId:skillSelection.selectedSkill,allowedCapabilities:toolPolicy.allowedCapabilities}});
      }
      const fact=await buildCustomFactSheet({input:{...input,content_type:articleMode==='experience'?'opinion':'tutorial',scenario:input.environment},root,hasUserMaterialContext:Boolean(project)});
      fact.article_mode=articleMode;
      fact.environment=String(input.environment||'').trim();
      fact.prerequisites=String(input.prerequisites||'').split(/\r?\n/).map((item)=>item.trim()).filter(Boolean);
      fact.expected_results=String(input.expected_results||'').split(/\r?\n/).map((item)=>item.trim()).filter(Boolean);
      fact.common_errors=String(input.common_errors||'').split(/\r?\n/).map((item)=>item.trim()).filter(Boolean);
      if(project){
        fact.local_project={root:project.root,files:project.files.map(({path:filePath,size,excerpt,truncated})=>({path:filePath,size,excerpt,truncated})),summary:project.summary,truncated:project.truncated};
      }
      if(articleMode==='tutorial'&&!fact.environment)throw new Error('请填写实际运行环境或版本边界');
      if(articleMode==='tutorial'&&fact.steps.length<2)throw new Error('教程步骤至少需要 2 步');
      if(articleMode==='experience'&&!fact.thesis)throw new Error('心得经验文章需要明确核心观点');
      if(articleMode==='experience'&&!fact.points.some((item)=>item.source_level==='author_experience'))throw new Error('心得经验文章至少需要一条【体验】要点');
      if(fact.materials.some((item)=>item.status!=='ok'))throw new Error(`素材抓取失败：${fact.materials.filter((item)=>item.status!=='ok').map((item)=>item.url).join('、')}`);
              const toolPolicy=await resolveSkillToolPolicy({workspaceRoot:root,skillId:skillSelection.selectedSkill});
        await attachInformationSearch({fact,input,root,toolContext:{store,batchId,skillId:skillSelection.selectedSkill,allowedCapabilities:toolPolicy.allowedCapabilities},documentRoots:config.documentSearch?.roots||[]});
      creation=store.findCustomArticleRequest(batchId,{requestId,fingerprint})||creation;
      if(creation?.candidate_row_id){
        const candidate=store.getCandidate(creation.candidate_row_id);
        let job=creation.latest_job_id?aiJobs.get(creation.latest_job_id):null;
        if(candidate&&!job){
          job=aiJobs.start({batchId,candidateId:candidate.id,provider:input.provider,type:'tutorial',skillSelection,stageSelections});
          store.updateCustomArticleRequest(creation.id,{latestJobId:job.id});
        }
        if(candidate&&job)return json(response,200,{...job,candidate,reused:true});
      }
      const materialUrls=fact.materials.map((item)=>item.url);
      const articleLabel=articleMode==='experience'?'心得经验':'使用教程';
      const hotspot=store.addManualHotspot(batchId,{title:fact.topic,url:materialUrls[0]||null,materialUrls,notes:`自主写作（${articleLabel}）`,researchEligible:false});
      store.addCandidates(batchId,[hotspot.id],{tracks:['article']});
      const candidate=store.listCandidates(batchId,'article').find((item)=>Number(item.hotspot_id)===Number(hotspot.id));
      if(!candidate)throw new Error('自主写作项目创建失败');
      store.updateCandidate(candidate.id,{angle:articleMode==='experience'?`经验分享：${fact.topic}`:`实操教程：${fact.topic}`,thesis:articleMode==='experience'?fact.thesis:`帮助 ${fact.audience||'目标读者'} 在 ${fact.environment} 完成 ${fact.topic}`,status:'locked'});
      store.updateCandidateTrack(candidate.id,'article',{status:'locked',pool_role:'自主写作',output_mode:articleMode==='experience'?'wechat-experience':'wechat-tutorial'});
      const experiences=fact.points.filter((item)=>item.source_level==='author_experience').map((item)=>item.text).join('\n');
      const facts=fact.points.filter((item)=>item.source_level!=='model_suggestion').map((item)=>item.text).join('\n');
      store.saveEditorial(candidate.id,{editor_question:'',confirmed_facts:facts,author_opinions:articleMode==='experience'?fact.thesis:'',confirmed_experiences:experiences,rejected_angles:'',open_questions:'',forbidden_claims:'不得将模型建议写成亲测或确定结果',next_action:'WRITE_NOW',experience_required:articleMode==='experience'||Boolean(experiences),brief_status:'LOCKED'});
      const dir=articleWorkdir(batch,candidate),factPath=path.join(dir,'01-tutorial-fact-base.json'),briefPath=path.join(dir,'article-brief.md');
      const factFile=writeUtf8(factPath,JSON.stringify(fact,null,2));
      const briefFile=writeUtf8(briefPath,`---\nbrief_status: LOCKED\ncandidate_id: ${candidate.candidate_id}\narticle_mode: ${articleMode}\nexperience_required: ${articleMode==='experience'||Boolean(experiences)}\nfinal_readiness: WRITE_NOW\n---\n\n# ${fact.topic}\n\n${articleMode==='experience'?`核心观点：${fact.thesis}`:`环境：${fact.environment}`}\n`);
      store.upsertArtifact({batchId,candidateId:candidate.id,track:'article',kind:'自主写作事实基座',name:'01-tutorial-fact-base.json',path:factPath,...factFile});
      store.upsertArtifact({batchId,candidateId:candidate.id,track:'article',kind:'锁定简报',name:'article-brief.md',path:briefPath,...briefFile});
      store.updateCustomArticleRequest(creation.id,{candidateId:candidate.id});
      const job=aiJobs.start({batchId,candidateId:candidate.id,provider:input.provider,type:'tutorial',skillSelection,stageSelections});
      store.updateCustomArticleRequest(creation.id,{latestJobId:job.id});
      return json(response,202,{...job,candidate:store.getCandidate(candidate.id)});
    }catch(error){return json(response,400,{error:`创建自主写作失败：${error.message}`});}
  }
  const tutorialRetryMatch=pathname.match(/^\/api\/candidates\/(\d+)\/custom-article-runs$/);
  if(tutorialRetryMatch&&request.method==='POST'){
    const candidate=store.getCandidate(Number(tutorialRetryMatch[1]));
    if(!candidate)return json(response,404,{error:'自主写作项目不存在'});
    if(!['wechat-experience','wechat-tutorial'].includes(candidate.output_mode))return json(response,409,{error:'该候选不是自主写作项目'});
    const input=await body(request);
    try{
      const creation=store.getCustomArticleRequestByCandidate(candidate.id);
      const explicitSkillId=String(input.skillId||'').trim();
      const requestedStages=input.stageSkills&&typeof input.stageSkills==='object'?input.stageSkills:{};
      const hasExplicitStages=Object.values(requestedStages).some((value)=>String(value||'').trim());
      const previousSnapshot=(input.useLatestSkill===true||explicitSkillId||hasExplicitStages)?null:store.findLatestGenerationSnapshot({
        batchId:candidate.batch_id,candidateId:candidate.id,purposes:['tutorial','personal-writing'],
      });
      const articleMode=candidate.output_mode==='wechat-experience'?'experience':'tutorial';
      const skillSelection=previousSnapshot?null:await resolveEntryWriterSkill({
        workspaceRoot:root,entryPoint:'independent-writing',contentType:articleMode,
        requestedSkillId:explicitSkillId,
        recommendedSkillId:articleMode==='experience'?'wechat-mp-personal-writing':'wechat-mp-tutorial',
      });
      const stageSelections=previousSnapshot?null:await resolveArticleStageSkills({
        workspaceRoot:root,entryPoint:'independent-writing',requested:requestedStages,
      });
      const job=aiJobs.start({batchId:candidate.batch_id,candidateId:candidate.id,provider:previousSnapshot?null:input.provider,
        type:'tutorial',snapshotId:previousSnapshot?.id||null,skillSelection,stageSelections});
      if(creation)store.updateCustomArticleRequest(creation.id,{latestJobId:job.id});
      return json(response,202,{...job,candidate});
    }catch(error){return json(response,400,{error:`重新执行自主写作失败：${error.message}`});}
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
  return false;
}

// Auto-start RSSHub on boot（演示模式跳过，避免拉起本地 RSSHub 进程）
if (!demo) {
  ensureStarted(config.rsshub, (msg) => console.log(msg)).then(running => {
    if (running) console.log('RSSHub 已启动并保持运行');
  }).catch(err => console.error('RSSHub 启动失败:', err.message));
}

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
  if (demo) console.log('演示模式：使用独立演示库 data/demo.db，无模型服务商也可浏览各视图。');
});
