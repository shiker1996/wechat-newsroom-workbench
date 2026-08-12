import { executeCapability } from '../../tools/capability-runtime.mjs';
import { createStoreExecutionLogger } from '../../tools/execution-log.mjs';
import { generateArticleImage } from '../../llm/article-image-generator.mjs';
import { registerGeneratedSlotImage } from '../../llm/image-workflow.mjs';

// capability-call: diagram.mermaid.render, diagram.echarts.render

export async function handleMediaRoutes(context) {
  const { request, response, pathname, searchParams, store, config, json, body, path, fs, os, mime, root, execFileAsync, isInsideRoots, getImageWorkspace, batchArticlesDir, saveLocalImage, uploadImageToCdn, articleWorkdir, models, planImagePlaceholders, writeUtf8, saveImageMetadata, imageManifestFile, aiJobs, planArticleVisuals, defaultTypesetTheme, TYPESET_THEMES, analyzeVisualComplexity } = context;
  const dailyImageMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/images$/);
  if (dailyImageMatch && request.method === 'GET') {
    const batch = store.getBatch(decodeURIComponent(dailyImageMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    return json(response, 200, { ...getImageWorkspace(path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily')), planned:true });
  }
  const dailyImageGenerateMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/images\/([^/]+)\/generate$/);
  if (dailyImageGenerateMatch && request.method === 'POST') {
    const batch = store.getBatch(decodeURIComponent(dailyImageGenerateMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    const id = decodeURIComponent(dailyImageGenerateMatch[2]);
    const item = getImageWorkspace(workdir).items.find((entry) => entry.id === id);
    if (!item?.generate) return json(response, 400, { error:'该占位未标记为可生成' });
    try {
      const { localPath } = await generateArticleImage({ workspaceRoot:root, workdir, slotId:id, generate:item.generate, ratio:item.ratio });
      const updated = registerGeneratedSlotImage(workdir, id, localPath);
      const manifestPath = imageManifestFile(workdir); const stat = fs.statSync(manifestPath);
      store.upsertArtifact({ batchId:batch.id, kind:'配图资产清单', name:path.basename(manifestPath), path:manifestPath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
      return json(response, 200, updated);
    } catch (error) {
      return json(response, 422, { error:`配图生成失败：${error.message}` });
    }
  }
  const dailyImageItemMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/images\/([^/]+)$/);
  if (dailyImageItemMatch && request.method === 'POST') {
    const batch = store.getBatch(decodeURIComponent(dailyImageItemMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    return json(response, 200, saveLocalImage(workdir, decodeURIComponent(dailyImageItemMatch[2]), await body(request)));
  }
  const dailyImageLocalMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/images\/([^/]+)\/local$/);
  if (dailyImageLocalMatch && request.method === 'GET') {
    const batch = store.getBatch(decodeURIComponent(dailyImageLocalMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    const item = getImageWorkspace(workdir).items.find((entry) => entry.id === decodeURIComponent(dailyImageLocalMatch[2]));
    if (!item?.localPath || !isInsideRoots(item.localPath, [workdir]) || !fs.existsSync(item.localPath)) return json(response, 404, { error:'本地图片不存在' });
    response.writeHead(200, { 'content-type':item.mimeType || mime[path.extname(item.localPath)] || 'application/octet-stream', 'cache-control':'no-store' });
    return fs.createReadStream(item.localPath).pipe(response);
  }
  const dailyImageCdnMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/images\/([^/]+)\/cdn$/);
  if (dailyImageCdnMatch && request.method === 'POST') {
    const batch = store.getBatch(decodeURIComponent(dailyImageCdnMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    return json(response, 200, await uploadImageToCdn(workdir, decodeURIComponent(dailyImageCdnMatch[2]), {
      authorizedExternalWrite:true,store,batchId:batch.id,skillId:'wechat-article-typeset',
    }));
  }
  const dailyCoverGenerateMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/cover\/generate$/);
  if (dailyCoverGenerateMatch && request.method === 'POST') {
    const batch = store.getBatch(decodeURIComponent(dailyCoverGenerateMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    if (!store.getDocument(batch.id, null, 'daily-final')) return json(response, 409, { error:'缺少早报终稿，请先完成批次早报' });
    const input = await body(request);
    return json(response, 202, aiJobs.start({ batchId:batch.id, candidateId:null, provider:input.provider||null, type:'cover-image', theme:input.theme||'auto' }));
  }
  const dailyCoverLocalMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/cover\/local$/);
  if (dailyCoverLocalMatch && request.method === 'GET') {
    const batch = store.getBatch(decodeURIComponent(dailyCoverLocalMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    const coverPath = path.join(workdir, 'images', 'cover.png');
    if (!isInsideRoots(coverPath, [workdir]) || !fs.existsSync(coverPath)) return json(response, 404, { error:'封面图不存在' });
    response.writeHead(200, { 'content-type':'image/png', 'cache-control':'no-store' });
    return fs.createReadStream(coverPath).pipe(response);
  }
  const dailyCoverMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/cover$/);
  if (dailyCoverMatch && request.method === 'GET') {
    const batch = store.getBatch(decodeURIComponent(dailyCoverMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    const coverPath = path.join(workdir, 'images', 'cover.png');
    if (!fs.existsSync(coverPath)) return json(response, 200, { exists:false });
    const stat = fs.statSync(coverPath);
    const doc = store.getDocument(batch.id, null, 'daily-final');
    return json(response, 200, { exists:true, size:stat.size, modifiedAt:stat.mtime.toISOString(), title:doc?.title || '批次早报' });
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
  const imageGenerateMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images\/([^/]+)\/generate$/);
  if (imageGenerateMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(imageGenerateMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const id = decodeURIComponent(imageGenerateMatch[2]);
    const item = getImageWorkspace(workdir).items.find((entry) => entry.id === id);
    if (!item?.generate) return json(response, 400, { error:'该占位未标记为可生成' });
    try {
      const { localPath } = await generateArticleImage({ workspaceRoot: root, workdir, slotId: id, generate: item.generate, ratio: item.ratio });
      const updated = registerGeneratedSlotImage(workdir, id, localPath);
      const manifestPath = imageManifestFile(workdir); const stat = fs.statSync(manifestPath);
      store.upsertArtifact({ batchId:batch.id, kind:'配图资产清单', name:path.basename(manifestPath), path:manifestPath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
      return json(response, 200, updated);
    } catch (error) {
      return json(response, 422, { error:`配图生成失败：${error.message}` });
    }
  }
  const coverGenerateMatch = pathname.match(/^\/api\/candidates\/(\d+)\/cover\/generate$/);
  if (coverGenerateMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(coverGenerateMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id);
    if (!store.getDocument(batch.id, candidate.id, 'final')) return json(response, 409, { error:'缺少成稿终稿，请先完成成稿链' });
    const input = await body(request);
    return json(response, 202, aiJobs.start({ batchId:batch.id, candidateId:candidate.id, provider:input.provider||null, type:'cover-image', theme:input.theme||'auto' }));
  }
  const coverLocalMatch = pathname.match(/^\/api\/candidates\/(\d+)\/cover\/local$/);
  if (coverLocalMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(coverLocalMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const coverPath = path.join(workdir, 'images', 'cover.png');
    if (!isInsideRoots(coverPath, [workdir]) || !fs.existsSync(coverPath)) return json(response, 404, { error:'封面图不存在' });
    response.writeHead(200, { 'content-type':'image/png', 'cache-control':'no-store' });
    return fs.createReadStream(coverPath).pipe(response);
  }
  const coverMatch = pathname.match(/^\/api\/candidates\/(\d+)\/cover$/);
  if (coverMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(coverMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const coverPath = path.join(workdir, 'images', 'cover.png');
    if (!fs.existsSync(coverPath)) return json(response, 200, { exists:false });
    const stat = fs.statSync(coverPath);
    const doc = store.getDocument(batch.id, candidate.id, 'final');
    return json(response, 200, { exists:true, size:stat.size, modifiedAt:stat.mtime.toISOString(), title:doc?.title || candidate.hotspot_title || '' });
  }
  const imageCdnMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images\/([^/]+)\/cdn$/);
  if (imageCdnMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(imageCdnMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const item = await uploadImageToCdn(workdir, decodeURIComponent(imageCdnMatch[2]), {
      authorizedExternalWrite:true,store,batchId:batch.id,candidateId:candidate.id,
    });
    const manifestPath = imageManifestFile(workdir); const stat = fs.statSync(manifestPath);
    store.upsertArtifact({ batchId:batch.id, kind:'配图资产清单', name:path.basename(manifestPath), path:manifestPath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
    return json(response, 200, item);
  }
  const typesetMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/typeset$/);
  if (typesetMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(typesetMatch[1]);
    const input = await body(request);
    const daily=input.documentKind==='daily-final';
    const candidate = daily?null:store.getCandidate(Number(input.candidateId));
    if ((!daily&&(!candidate||candidate.batch_id!==batchId))||(daily&&!store.getDocument(batchId,null,'daily-final'))) return json(response, 404, { error: '待排版文稿不存在或不属于当前批次' });
    const previousSnapshot=input.useLatestSkill===true?null:store.findLatestGenerationSnapshot({
      batchId,candidateId:candidate?.id??null,purposes:['typeset'],
    });
    return json(response, 202, aiJobs.start({ batchId, candidateId: candidate?.id??null,documentKind:daily?'daily-final':null,
      provider:previousSnapshot?null:input.provider,type:'typeset',theme:input.theme,snapshotId:previousSnapshot?.id||null }));
  }
  const documentsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/documents$/);
  if (documentsMatch && request.method === 'GET') {
    const batchId=decodeURIComponent(documentsMatch[1]); const cId=searchParams.get('candidateId'); const kind=searchParams.get('kind'); if(cId&&kind){var doc=store.getDocument(batchId,cId==='daily'?null:Number(cId),kind);if(!doc&&kind==='draft'){var arts=store.listArtifacts({batchId:batchId});var da=arts.find(function(a){return a.kind==='文章初稿'&&a.file_path&&a.file_path.toLowerCase().includes(cId.toLowerCase());});if(da&&fs.existsSync(da.file_path)){doc={title:da.name,content:fs.readFileSync(da.file_path,'utf-8')};}}return json(response,doc?200:404,doc||{error:'文档不存在'});} return json(response,200,store.listDocuments(batchId));
  }
  const visualPlanMatch = pathname.match(/^\/api\/batches\/([^/]+)\/visual-plan$/);
  if (visualPlanMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(visualPlanMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const input = await body(request);
    const daily = input.documentKind === 'daily-final';
    const candidate = daily ? null : store.getCandidate(Number(input.candidateId));
    if (!daily && (!candidate || candidate.batch_id !== batchId)) return json(response, 404, { error:'文章不存在或不属于当前批次' });
    const markdown = String(input.content || '');
    if (!markdown.trim()) return json(response, 400, { error:'文章内容为空' });
    const provider = input.provider || models.config.defaultProvider;
    const providerConfig = models.config.providers[provider];
    if (!providerConfig) return json(response, 400, { error:'未知模型服务商' });
    const workdir = daily ? path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily') : articleWorkdir(batch, candidate);
    const factCandidates = daily
      ? ['01-news-items.json']
      : ['02-fact-base.json', '01-tutorial-fact-base.json', 'article-brief.md'];
    const factBase = factCandidates.map((name) => path.join(workdir, name)).find((file) => fs.existsSync(file));
    const result = await planArticleVisuals({
      gateway:models, provider, batchId, candidateId:candidate?.id ?? null, markdown,
      factBase:factBase ? fs.readFileSync(factBase, 'utf8') : '',
      preferences:store.visualDecisionStats(),
      maxOutputTokens:Math.min(5000, providerConfig.maxOutputTokens), workspaceRoot:config.workspaceRoot,
    });
    const theme = defaultTypesetTheme(daily ? { category:'📰 综合资讯' } : candidate);
    return json(response, 200, { ...result, theme, themeLabel:TYPESET_THEMES[theme]?.label || theme });
  }
  if (pathname === '/api/visual-decisions' && request.method === 'POST') {
    const input = await body(request);
    const batch = store.getBatch(String(input.batchId || ''));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const candidate = input.candidateId ? store.getCandidate(Number(input.candidateId)) : null;
    if (input.candidateId && (!candidate || candidate.batch_id !== batch.id)) return json(response, 404, { error:'文章不存在' });
    return json(response, 200, store.saveVisualDecision({
      batchId:batch.id, candidateId:candidate?.id ?? null, visualType:input.visualType,
      action:input.action, heading:input.heading, purpose:input.purpose,
    }));
  }
  if (pathname === '/api/visual-preview' && request.method === 'POST') {
    const input = await body(request);
    const type = input.type === 'mermaid' || input.type === 'echarts' ? input.type : '';
    const code = String(input.code || '').trim();
    if (!type || !code) return json(response, 400, { error:'图表类型或代码为空' });
    if (type === 'mermaid' && !/^(?:flowchart\s+(?:TB|LR)|sequenceDiagram|stateDiagram-v2)\b/i.test(code)) return json(response, 400, { error:'支持 flowchart、sequenceDiagram 和 stateDiagram-v2' });
    if (type === 'echarts') {
      try { JSON.parse(code); } catch { return json(response, 400, { error:'ECharts 配置必须是严格 JSON' }); }
    }
    const complexity = analyzeVisualComplexity(type, code);
    if (!complexity.mobileReady) return json(response, 422, { error:`移动端复杂度门禁未通过：${complexity.warning}` });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-preview-'));
    try {
      const source = path.join(tempDir, 'input.md');
      const output = path.join(tempDir, 'output.md');
      const imageDir = path.join(tempDir, 'images');
      const tokensPath = path.join(tempDir, 'tokens.json');
      fs.writeFileSync(source, `\`\`\`${type}\n${code}\n\`\`\`\n`, 'utf8');
      const themeTokens = TYPESET_THEMES[input.theme]?.tokens || {};
      fs.writeFileSync(tokensPath, JSON.stringify({ ...themeTokens, ...(input.tokens || {}), colors:{ ...(themeTokens.colors || {}), ...(input.tokens?.colors || {}) } }), 'utf8');
      const rendered = await executeCapability({consumerId:'feature.diagram-preview',capability:`diagram.${type}.render`,input:{
        inputPath:source, outputPath:output, imageDir, tokensPath,
      },context:{allowedRoots:[tempDir],cwd:root,timeoutMs:180000,executionLog:createStoreExecutionLogger(store,{skillId:'visual-preview'})}});
      if (rendered.status === 'error') throw new Error(rendered.error.message);
      const imagePath = path.join(imageDir, `${type}-1.png`);
      if (!fs.existsSync(imagePath)) throw new Error('预览图片未生成');
      return json(response, 200, { image:`data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`, complexity });
    } catch (error) {
      return json(response, 422, { error:`图表预览失败：${String(error.stderr || error.stdout || error.message).trim().slice(0, 500)}` });
    } finally {
      fs.rmSync(tempDir, { recursive:true, force:true });
    }
  }
  if (documentsMatch && request.method === 'PUT') {
    const batchId = decodeURIComponent(documentsMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error: '批次不存在' });
    const input = await body(request);
    const candidate = input.candidateId ? store.getCandidate(Number(input.candidateId)) : null;
    if (input.candidateId && !candidate) return json(response, 404, { error: '候选不存在' });
    if (!['draft','final','daily-draft','daily-final'].includes(input.kind)) return json(response, 400, { error: '未知文稿类型' });
    const daily=input.kind.startsWith('daily-');
    if(daily&&candidate)return json(response,400,{error:'批次早报不能关联单选题候选'});
    const fileName = input.kind === 'final' ? '09-FINAL.md' : input.kind === 'draft' ? '04-draft.md' : input.kind === 'daily-final' ? '03-FINAL.md' : '02-draft.md';
    const targetDir = candidate ? articleWorkdir(batch, candidate) : daily ? path.join(batchArticlesDir(config.workspaceRoot,batch),'daily') : batchArticlesDir(config.workspaceRoot, batch);
    const filePath = path.join(targetDir, fileName);
    const file = writeUtf8(filePath, String(input.content ?? ''));
    const document = store.saveDocument({ batchId, candidateId: candidate?.id ?? null, kind: input.kind,
      title: input.title ?? '', content: String(input.content ?? ''), filePath, status: input.status ?? 'draft' });
    store.upsertArtifact({ batchId, kind: input.kind.endsWith('final') ? (daily?'早报终稿':'文章终稿') : (daily?'早报初稿':'文章初稿'), name: fileName, path: filePath, ...file });
    store.updateBatch(batchId, { stage: input.kind.endsWith('final') ? 'review' : 'drafting', status: 'running' });
    return json(response, 200, document);
  }
  return false;
}
