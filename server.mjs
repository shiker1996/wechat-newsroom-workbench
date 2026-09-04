import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { backup as backupSqlite } from 'node:sqlite';
import { Store } from './server/platform/core/store.mjs';
import { loadConfig } from './server/platform/core/config.mjs';
import { isInsideRoots } from './server/platform/artifacts/artifact-indexer.mjs';
import { CollectionJobManager } from './server/features/collection/index.mjs';
import { ensureStarted } from './plugins/rsshub/collector.mjs';
import { ModelGateway } from './server/platform/llm/gateway.mjs';
import { draftArticle } from './server/features/research/llm/tasks.mjs';
import { AiJobManager } from './server/platform/jobs/ai-job-manager.mjs';
import { BATCH_LEVEL_AI_JOB_TYPES, createAiJobHandlers } from './server/features/batches/index.mjs';
import { recordResearchFailure } from './server/features/research/index.mjs';
import { fetchCandidateSource } from './server/platform/integrations/source-fetcher.mjs';
import { getImageWorkspace, saveImageMetadata, saveLocalImage, uploadImageToCdn,
  planImagePlaceholders, imageManifestFile } from './server/features/articles/index.mjs';
import { inspectRepositoryViaRegistry as inspectRepository, repositoryFactMarkdown } from './server/platform/integrations/repository-inspector.mjs';
import { evaluateCardGate, evaluateClassifiedCardGate, evaluateEventCardGate, evaluateCustomCardGate, eventGroupsForCandidate, resolveEventAnalysis, socialStoryboardClassForContentClass } from './server/features/social-cards/index.mjs';
import { loadSkillBundle, setSkillConfigurationResolver } from './server/platform/llm/skill-runtime.mjs';
import { createZip } from './server/platform/artifacts/zip-bundle.mjs';
import { batchArticlesDir, batchTopicsDir, candidateArticleDir, candidateSocialCardDir } from './server/platform/core/workspace-paths.mjs';
import { getBatchDeleteImpact, deleteBatchPermanently } from './server/features/batches/index.mjs';
import { SOCIAL_CARD_COMPOSITION_MODES, SOCIAL_CARD_LAYOUTS, describeCardLayouts, normalizeCardComposition } from './server/features/social-cards/index.mjs';
import { analyzeVisualComplexity, planArticleVisuals, defaultTypesetTheme, TYPESET_THEMES } from './server/features/articles/index.mjs';
import { handleContentRoutes } from './server/platform/http/routes/content-routes.mjs';
import { handleModelRoutes } from './server/platform/http/routes/model-routes.mjs';
import { handleSystemRoutes } from './server/platform/http/routes/system-routes.mjs';
import { handleMediaRoutes } from './server/platform/http/routes/media-routes.mjs';
import { handleArticleRoutes } from './server/platform/http/routes/article-routes.mjs';
import { handleSocialCardRoutes } from './server/platform/http/routes/social-card-routes.mjs';
import { handleThemeRoutes } from './server/platform/http/routes/theme-routes.mjs';
import { handleBatchRoutes } from './server/platform/http/routes/batch-routes.mjs';
import { handleCandidateRoutes } from './server/platform/http/routes/candidate-routes.mjs';
import { handleTaskRoutes } from './server/platform/http/routes/task-routes.mjs';
import { createRouteHelpers, writeUtf8 } from './server/platform/http/route-helpers.mjs';
import { setToolConfigurationResolver } from './server/platform/tools/index.mjs';
import { ExtensionConfigurationService } from './server/platform/extensions/configuration-service.mjs';
import { modelProviderManifest } from './server/platform/extensions/model-provider-configuration.mjs';
import { syncModelProvidersToDatabase } from './server/platform/integrations/model-provider-settings.mjs';
import { seedDemoData } from './server/platform/demo/seed.mjs';
import { createLocalSecurity } from './server/platform/http/local-security.mjs';
import { APP_VERSION } from './server/platform/version.mjs';
import { acquireInstanceLock } from './server/platform/core/instance-lock.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig(root);
// --demo / WORKBENCH_DEMO=1：无模型服务商时也能预览各视图，使用独立演示库，不污染真实数据。
const demo = process.argv.includes('--demo') || process.env.WORKBENCH_DEMO === '1';
const instanceLock=acquireInstanceLock(root,{name:demo?'demo':'workbench'});
const store = new Store(path.join(root, 'data', demo ? 'demo.db' : 'workbench.db'));
// 模型提供商以数据库为唯一持久化来源；首次启动时从旧 config.local.json/.env 迁移。
syncModelProvidersToDatabase({root,config,repository:store.repositories.extensionSettings,cleanupLegacy:!demo});
const extensionConfigurationService=new ExtensionConfigurationService({root,repository:store.repositories.extensionSettings});
setToolConfigurationResolver((manifest)=>{
  return extensionConfigurationService.resolve({extensionType:'tool',extensionId:manifest.id,manifest});
});
setSkillConfigurationResolver((manifest)=>extensionConfigurationService.resolve({extensionType:'skill',extensionId:manifest.id,manifest}));
if (demo) {
  const seedResult = seedDemoData(store, { root });
  if (seedResult.seeded) console.log(`演示模式：已写入演示批次（${seedResult.todayBatchId} / ${seedResult.yesterdayBatchId}）`);
}
const recovered = store.recoverInterruptedWork();
if (Object.values(recovered).some(Number)) console.log(`已恢复上次中断状态：${JSON.stringify(recovered)}`);
const jobs = new CollectionJobManager(store, config, () => models);

const models = new ModelGateway(config, store,(id,provider)=>extensionConfigurationService.resolve({extensionType:'model-provider',extensionId:id,manifest:modelProviderManifest(id,provider)}));
const aiJobs = new AiJobManager(store, models, config, {
  batchLevelTypes: BATCH_LEVEL_AI_JOB_TYPES,
  handlers: createAiJobHandlers({ store, gateway: models, config, log: (job, message) => aiJobs.log(job, message), onThinking: (job, delta) => aiJobs.recordThinking(job, delta) }),
  onFailure: ({ job, error }) => {
    if (job.type === 'research' || (job.type === 'auto' && job.phase === 'research')) recordResearchFailure({ store, job, error });
  },
});
const artifactRoots = [config.workspaceRoot, ...config.contentRoots];
const publicRoot = path.join(root, 'public');
const execFileAsync = promisify(execFile);
const localSecurity = createLocalSecurity();
const CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-src 'self'";

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
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const chunk of request) {
    text += decoder.decode(chunk, { stream: true });
    if (text.length > 12_000_000) throw new Error('请求体过大');
  }
  text += decoder.decode();
  return text ? JSON.parse(text) : {};
}

function serveStatic(response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(publicRoot, relative);
  const relativeToPublic = path.relative(publicRoot, filePath);
  if (relativeToPublic.startsWith('..') || path.isAbsolute(relativeToPublic) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  response.writeHead(200, { 'content-type': mime[path.extname(filePath)] ?? 'application/octet-stream', 'cache-control':'no-store' });
  const source=fs.createReadStream(filePath);
  source.once('error',(error)=>{console.error(error);if(!response.headersSent)response.writeHead(404);if(!response.writableEnded)response.end();});
  response.once('close',()=>{if(!source.destroyed)source.destroy();});
  source.pipe(response);
  return true;
}

function batchWorkdir(batch) {
  return batchTopicsDir(config.workspaceRoot, batch);
}

function candidateEventGroups(candidate, contentLimit = 2000) {
  return eventGroupsForCandidate({ store, workspaceRoot: config.workspaceRoot, candidate, contentLimit, defaultMaxAgeHours: config.rsshub.maxAgeHours });
}

function resolveEventAnalysisFor(candidate) {
  return resolveEventAnalysis({ store, workspaceRoot: config.workspaceRoot, candidate, defaultMaxAgeHours: config.rsshub.maxAgeHours });
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
      'remote-tool-plugins.json','remote-tool-plugin-events.jsonl','collector-plugins.json','collector-plugin-events.jsonl']){
      const filePath=path.join(root,'data',name);
      if(fs.existsSync(filePath))files.push({name:`data/${name}`,path:filePath});
    }
    for(const directoryName of ['installed-skills','skill-package-archive','installed-tool-plugins','tool-plugin-archive','installed-collector-plugins']){
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
    const manifest={schemaVersion:1,createdAt:new Date().toISOString(),appVersion:APP_VERSION,
      excludes:['.env','API tokens','node_modules','cache/log files','data/browser-profiles（登录 Cookie 与会话）'],
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

function socialCardFiles(batch,candidate){const dir=socialCardWorkdir(batch,candidate);const names=['fact-sheet.md','repository-fact-sheet.json','card-plan.json','copy.txt','my-design.html','ai-beautified.html','layout-report.json','delivery-report.json','ai-beautify-report.json','social-card-skill-manifest.json','social-card-stage-executions.json'];const files=names.filter((name)=>fs.existsSync(path.join(dir,name))).map((name)=>({name,path:path.join(dir,name)}));for(const [folder,prefix] of [['output','output/'],['ai-beautified-output','ai-beautified-output/']]){const output=path.join(dir,folder);if(fs.existsSync(output))for(const name of fs.readdirSync(output).filter((name)=>name.toLowerCase().endsWith('.png')).sort())files.push({name:`${prefix}${name}`,path:path.join(output,name)});}return {dir,files};}

function candidateRepositoryUrl(candidate) {
  if (/^https:\/\/github\.com\//i.test(candidate.url||'')) return candidate.url;
  return (candidate.hotspots||[]).find((item)=>/^https:\/\/github\.com\//i.test(item.url||''))?.url||'';
}

function socialContentType(candidate) {
  const classified = String(candidate?.content_class || '').trim();
  const mode=candidate?.tracks?.find((item)=>item.track==='social_cards')?.output_mode||'';
  if (classified === 'open_source_technology' || classified === 'open_source_trend') return 'event';
  if (classified === 'github_project') return 'repository';
  // 历史上手动添加仓库的 content_class 可能落成默认值 news_event；
  // 工具图文输出模式仍然是明确的仓库路由，兼容这些旧候选。
  if (mode.includes('tool-cards')) return 'repository';
  if(mode.includes('event-cards'))return 'event';
  if(mode.includes('custom-cards'))return 'custom';
  if(mode.includes('technology-cards'))return 'event';
  if(mode.includes('trend-cards'))return 'event';
  if (classified === 'news_event') return 'event';
  return 'repository';
}
// 渠道与内容形态都编码在 candidate_tracks.output_mode：xiaohongshu-* 走小红书渲染分支，其余走公众号
function socialChannelMode(candidate) {
  const mode=candidate?.tracks?.find((item)=>item.track==='social_cards')?.output_mode||'';
  return mode.startsWith('xiaohongshu')?'xiaohongshu':'wechat';
}
function socialCardGate(candidate, contentType, facts, editorial, eventAnalysis) {
  if(contentType==='event') {
    const storyboardClass=socialStoryboardClassForContentClass(candidate?.content_class);
    if(storyboardClass==='technology'||storyboardClass==='trend')return evaluateClassifiedCardGate(candidate,storyboardClass,eventAnalysis,editorial);
    return evaluateEventCardGate(candidate,eventAnalysis,editorial);
  }
  if(contentType==='custom')return evaluateCustomCardGate(candidate,facts,editorial);
  return evaluateCardGate(candidate,facts,editorial);
}

function researchPointsBrief(points) {
  const items = Array.isArray(points) ? points : [];
  return items.length
    ? items.map((item) => {
      const boundary = item.evidence_boundary && typeof item.evidence_boundary === 'object' ? JSON.stringify(item.evidence_boundary) : item.evidence_boundary;
      return `- ${item.label || (item.scope === 'inter_event' ? '事件间关系' : '事件内研判')}：${item.statement || item.question || item.relationship_statement || ''}${item.event_title ? `（涉及：${item.event_title}）` : ''}${item.expected ? `；基线/预期：${item.expected}` : ''}${item.observed ? `；观察：${item.observed}` : ''}${item.gap ? `；落差：${item.gap}` : ''}${item.difference ? `；差异：${item.difference}` : ''}${item.impact ? `；影响：${item.impact}` : ''}${item.supporting_facts?.length ? `；支撑事实：${item.supporting_facts.join('；')}` : ''}${boundary ? `；证据边界：${boundary}` : ''}`;
    }).join('\n')
    : '暂无；成稿时不得自行补写未被作者采用的研判点。';
}

function lockedBrief(candidate, editorial) {
  return `---
brief_status: LOCKED
candidate_id: ${candidate.candidate_id}
distribution_lane: ${candidate.distribution_lane || '推荐池'}
reader_stake: ${candidate.reader_stake || ''}
experience_required: ${editorial.experience_required ? 'true' : 'false'}
decision_source: explicit-user
final_readiness: WRITE_NOW
---

# ${candidate.hotspot_title}

## 采用的研判拓展点

${researchPointsBrief(editorial.adopted_research_points)}

## 采用的研判主线

${editorial.research_basis.trim()}

## 锁定命题

${candidate.thesis.trim()}

## 推荐角度

${candidate.angle.trim() || '未单独填写，以锁定命题为准。'}

## 分发与读者利益

- 分发池：${candidate.distribution_lane || '推荐池'}
- 读者利益：${candidate.reader_stake || '待明确'}

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
  if (request.method === 'GET' && pathname === '/api/security/session') {
    return json(response, 200, { csrfToken: localSecurity.csrfToken });
  }
  if (request.method === 'POST' && pathname === '/api/security/confirmation') {
    const input = await body(request);
    try { return json(response, 201, { token: localSecurity.issue(input.action), expiresInMs: 60_000 }); }
    catch { return json(response, 400, { code: 'CONFIRMATION_ACTION_INVALID', error: '敏感操作类型无效' }); }
  }
  if (request.method === 'GET' && pathname === '/api/overview') {
    return json(response, 200, store.overview());
  }
  if (await handleModelRoutes({ request, response, pathname, root, config, store, models, body, json })) return;
  if (await handleThemeRoutes({ request, response, pathname, searchParams, json, store, body, models })) return;
  if (await handleContentRoutes({ request, response, pathname, searchParams, store, artifactRoots, mime, json, body, root, models })) return;
  if (await handleSystemRoutes({ request, response, pathname, searchParams, root, config, store, json, body,
    binaryBody, createWorkbenchBackup, models })) return;
  const mediaResult = await handleMediaRoutes({ request, response, pathname, searchParams, store, config, json, body, path, fs, os, mime, root, execFileAsync, isInsideRoots, getImageWorkspace, batchArticlesDir, saveLocalImage, uploadImageToCdn, articleWorkdir, models, planImagePlaceholders, writeUtf8, saveImageMetadata, imageManifestFile, aiJobs, planArticleVisuals, defaultTypesetTheme, TYPESET_THEMES, analyzeVisualComplexity });
  if (mediaResult !== false) return mediaResult;
  const articleResult = await handleArticleRoutes({ request, response, pathname, store, json, body, candidateEventGroups, fetchCandidateSource, config, root, writeUtf8, path, batchWorkdir, lockedBrief, draftArticle, models, aiJobs, localSecurity });
  if (articleResult !== false) return articleResult;
  const socialCardResult = await handleSocialCardRoutes({ request, response, pathname, searchParams, store, json, body, path, fs, root, config, mime, models, aiJobs, socialCardFiles, isInsideRoots, createZip, socialContentType, resolveEventAnalysisFor, socialCardGate, socialChannelMode, describeCardLayouts, SOCIAL_CARD_LAYOUTS, SOCIAL_CARD_COMPOSITION_MODES, normalizeCardComposition, loadSkillBundle, fetchCandidateSource, candidateEventGroups, candidateRepositoryUrl, inspectRepository, socialCardWorkdir, writeUtf8, repositoryFactMarkdown, evaluateCardGate });
   if (socialCardResult !== false) return socialCardResult;
   const routeHelpers = createRouteHelpers({ store, config, batchWorkdir });
   const batchResult = await handleBatchRoutes({ request, response, pathname, searchParams, root, store, jobs, body, json,
     batchWorkdir, decorateBatch: routeHelpers.decorateBatch, batchMaxAgeHours: routeHelpers.batchMaxAgeHours, config });
   if (batchResult !== false) return batchResult;
   const candidateResult = await handleCandidateRoutes({ request, response, pathname, searchParams, root, config, store, body, json, models, aiJobs, localSecurity,
     batchWorkdir, articleWorkdir, socialCardWorkdir, writeUtf8, candidateRepositoryUrl, candidateEventGroups: routeHelpers.candidateEventGroups,
     attachEventConclusions: routeHelpers.attachEventConclusions, evaluateCustomCardGate });
   if (candidateResult !== false) return candidateResult;
   const taskResult = await handleTaskRoutes({ request, response, pathname, searchParams, store, body, json, aiJobs, jobs, models, root, config,
     batchWorkdir, batchMaxAgeHours: routeHelpers.batchMaxAgeHours });
   if (taskResult !== false) return taskResult;
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
    response.setHeader('content-security-policy', CONTENT_SECURITY_POLICY);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    const boundaryError = localSecurity.validateBoundary(request);
    if (boundaryError) return json(response, boundaryError.status, boundaryError);
    request.localSecurity = localSecurity;
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
    else { console.error(error); json(response, 500, { code: 'INTERNAL_ERROR', error: '服务器处理请求失败' }); }
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

let shuttingDown=false;
function shutdown(signal){
  if(shuttingDown)return;shuttingDown=true;
  console.log(`收到 ${signal}，正在安全关闭工作台`);
  server.close(()=>{try{store.close();}finally{instanceLock.release();process.exit(0);}});
  setTimeout(()=>process.exit(1),10_000).unref();
}
process.once('SIGINT',()=>shutdown('SIGINT'));
process.once('SIGTERM',()=>shutdown('SIGTERM'));
