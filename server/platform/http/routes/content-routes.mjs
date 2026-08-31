import fs from 'node:fs';
import path from 'node:path';
import { indexArtifacts, isInsideRoots, resolveArtifactRelativeAsset } from '../../artifacts/artifact-indexer.mjs';
import { indexArticleArtifacts } from '../../artifacts/article-artifact-indexer.mjs';
import { imageArtifactPreviewHtml, injectPhonePreviewStyles, isImageArtifact, textArtifactPreviewHtml } from '../../artifacts/artifact-preview.mjs';
import { boundedLimit, pipeFile } from '../route-helpers.mjs';
import { parseWechatExport } from '../../../features/content-planning/wechat-export-parser.mjs';
import { buildWechatInsights, classifyWechatArticle, matchWechatPerformance } from '../../../features/content-planning/wechat-content-insights.mjs';
import { matchWechatArticles } from '../../../features/content-planning/wechat-article-matcher.mjs';
import { fetchWechatArticleContent, linkWechatArticlesContent } from '../../../features/content-planning/article-content-linker.mjs';
import { buildContentFeedbackSnapshot, extractArticleContentFeatures } from '../../../features/content-planning/wechat-content-feedback.mjs';
import { buildContentPlanningRecommendation, sortMaterialsByPlanningRecommendation } from '../../../features/content-planning/content-planning-recommendations.mjs';
import { buildWechatStrategyRecommendations } from '../../../features/content-planning/wechat-strategy-recommendations.mjs';
import { getAccountContext } from '../../../shared/domain/account-context.mjs';

const ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-src 'self'";

function enrichWechatReview(review) {
  const articles = (review.articles || []).map(classifyWechatArticle);
  return { ...review, articles, top_articles: [...articles].sort((left, right) => Number(right.reads || 0) - Number(left.reads || 0)).slice(0, 8), insights: buildWechatInsights(review.articles || []) };
}

function enrichMaterial(material, insights, feedback) {
  if (!material) return material;
  const assessment = material.assessment?.account_fit
    ? { ...material.assessment, historical_signal: matchWechatPerformance(`${material.title || ''}\n${material.raw_text || ''}`, insights) }
    : material.assessment;
  return {
    ...material,
    ...(assessment ? { assessment } : {}),
    planning_recommendation: buildContentPlanningRecommendation(material, { feedback, insights }),
  };
}

function enrichCalendarEntry(entry, insights, feedback) {
  if (entry?.content_type !== 'writing_plan') return entry;
  return {
    ...entry,
    planning_recommendation: buildContentPlanningRecommendation({
      title: entry.title,
      raw_text: entry.raw_text,
      next_teaser: entry.teaser,
    }, { feedback, insights }),
  };
}

export async function handleContentRoutes(context) {
  const { request, response, pathname, searchParams, store, artifactRoots, mime, json, body, root } = context;

  if (request.method === 'GET' && pathname === '/api/content-columns') {
    json(response, 200, store.listContentColumns({ includeInactive: searchParams.get('all') === '1' })); return true;
  }
  if (request.method === 'POST' && pathname === '/api/content-columns') {
    json(response, 201, store.saveContentColumn(await body(request))); return true;
  }
  if (request.method === 'GET' && pathname === '/api/writing-materials') {
    const insights = enrichWechatReview(store.getWechatReview()).insights;
    const feedback = store.getLatestContentFeedbackSnapshot();
    let materials = store.listWritingMaterials({ status: searchParams.get('status') || '', sourceType: searchParams.get('source_type') || '', query: searchParams.get('q') || '', limit: boundedLimit(searchParams, 200, 500) }).map((material) => enrichMaterial(material, insights, feedback));
    if (searchParams.get('sort') === 'feedback') materials = sortMaterialsByPlanningRecommendation(materials);
    json(response, 200, materials); return true;
  }
  const materialMatch = pathname.match(/^\/api\/writing-materials\/(\d+)$/);
  if (materialMatch && request.method === 'GET') { const insights = enrichWechatReview(store.getWechatReview()).insights; const material = enrichMaterial(store.getWritingMaterial(Number(materialMatch[1])), insights, store.getLatestContentFeedbackSnapshot()); json(response, material ? 200 : 404, material || { error: '素材不存在' }); return true; }
  if (materialMatch && ['PATCH', 'PUT'].includes(request.method)) { json(response, 200, store.updateWritingMaterial(Number(materialMatch[1]), await body(request))); return true; }
  if (request.method === 'POST' && pathname === '/api/writing-materials') {
    const material = store.createWritingMaterial(await body(request));
    const assessment = assessMaterial(material, store.listContentColumns(), getAccountContext({ workspaceRoot: root }), enrichWechatReview(store.getWechatReview()).insights);
    json(response, 201, store.saveWritingAssessment(material.id, assessment)); return true;
  }
  const assessmentMatch = pathname.match(/^\/api\/writing-materials\/(\d+)\/assessment$/);
  if (assessmentMatch && request.method === 'POST') {
    const material = store.getWritingMaterial(Number(assessmentMatch[1])); if (!material) { json(response, 404, { error: '素材不存在' }); return true; }
    const assessment = assessMaterial(material, store.listContentColumns(), getAccountContext({ workspaceRoot: root }), enrichWechatReview(store.getWechatReview()).insights);
    json(response, 200, store.saveWritingAssessment(material.id, assessment)); return true;
  }
  if (request.method === 'GET' && pathname === '/api/writing-material-plans') { json(response, 200, store.listWritingPlans({ month: searchParams.get('month') || '', limit: boundedLimit(searchParams, 300, 500) })); return true; }
  if (request.method === 'POST' && pathname === '/api/writing-material-plans') { json(response, 201, store.createWritingPlan(await body(request))); return true; }
  const planMatch = pathname.match(/^\/api\/writing-material-plans\/(\d+)$/);
  if (planMatch && ['PATCH', 'PUT'].includes(request.method)) { json(response, 200, store.updateWritingPlan(Number(planMatch[1]), await body(request))); return true; }
  if (request.method === 'GET' && pathname === '/api/article-publications') {
    const publication = store.getArticlePublication({
      id: searchParams.get('id') || null,
      planId: searchParams.get('planId') || null,
      documentId: searchParams.get('documentId') || null,
    });
    json(response, publication ? 200 : 404, publication || { error: '发布信息不存在' }); return true;
  }
  if (request.method === 'POST' && pathname === '/api/article-publications') {
    try { json(response, 200, store.saveArticlePublication(await body(request))); }
    catch (error) { json(response, 400, { error: error.message }); }
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/review') { json(response, 200, enrichWechatReview(store.getWechatReview({ month: searchParams.get('month') || '' }))); return true; }
  if (request.method === 'GET' && pathname === '/api/wechat/matches') {
    json(response, 200, { items: store.listWechatArticleMetricMatches({ status: searchParams.get('status') || '', limit: boundedLimit(searchParams, 200, 1000) }), stats: store.wechatArticleMetricMatchStats() }); return true;
  }
  if (request.method === 'POST' && pathname === '/api/wechat/matches/rematch') {
    const index = indexArticleArtifacts(store, artifactRoots);
    json(response, 200, { ...matchWechatArticles(store, { force: false }), index }); return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/content-links') {
    const items = store.listArticleContentLinks({ limit: boundedLimit(searchParams, 200, 1000) }).map((item) => {
      if (item.artifact_type !== '图文发布文案' || !item.file_path || !isInsideRoots(item.file_path, artifactRoots)) return item;
      try { return { ...item, copy_content: fs.readFileSync(item.file_path, 'utf8').slice(0, 100_000) }; } catch { return item; }
    });
    json(response, 200, { items }); return true;
  }
  if (request.method === 'POST' && pathname === '/api/wechat/content-links/relink') {
    const index = indexArticleArtifacts(store, artifactRoots);
    json(response, 200, { ...linkWechatArticlesContent(store, { root, artifactRoots }), index }); return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/feedback') {
    const feedback = store.getLatestContentFeedbackSnapshot();
    const analyses = store.listArticleContentAnalyses({ limit: 2000 });
    json(response, 200, { feedback, stats: { linked_articles: analyses.filter((item) => item.content_status === 'ok').length, features: analyses.filter((item) => item.feature_id).length } }); return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/strategy') {
    const review = enrichWechatReview(store.getWechatReview());
    json(response, 200, buildWechatStrategyRecommendations({ snapshots: store.listContentFeedbackSnapshots({ limit: 100 }), columnPerformance: store.listColumnPerformance(), review, accountContext: getAccountContext({ workspaceRoot: root }) })); return true;
  }
  if (request.method === 'POST' && pathname === '/api/wechat/feedback/rebuild') {
    const analyses = store.listArticleContentAnalyses({ limit: 2000 });
    for (const item of analyses) {
      if (item.content_status !== 'ok' || !item.snapshot_id) continue;
      const features = extractArticleContentFeatures(item, { metricTitle: item.metric_title, evidenceAssets: item.evidence_assets });
      item.features = features;
      store.saveArticleContentFeatures({ snapshotId: item.snapshot_id, metricId: item.metric_id, features });
    }
    const feedback = store.saveContentFeedbackSnapshot(buildContentFeedbackSnapshot(analyses, { review: store.getWechatReview() }));
    json(response, 200, { feedback, extracted: analyses.filter((item) => item.content_status === 'ok').length }); return true;
  }
  const wechatContentMatch = pathname.match(/^\/api\/wechat\/content-links\/(\d+)\/fetch$/);
  if (wechatContentMatch && request.method === 'POST') {
    try { json(response, 200, await fetchWechatArticleContent(store, { matchId: Number(wechatContentMatch[1]), root })); }
    catch (error) { json(response, 400, { error: error.message }); }
    return true;
  }
  const wechatMatchMatch = pathname.match(/^\/api\/wechat\/matches\/(\d+)$/);
  if (wechatMatchMatch && request.method === 'PATCH') {
    try { json(response, 200, store.updateWechatArticleMetricMatch(Number(wechatMatchMatch[1]), await body(request))); }
    catch (error) { json(response, 400, { error: error.message }); }
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/imports') { json(response, 200, store.listWechatImports()); return true; }
  if (request.method === 'POST' && pathname === '/api/wechat/import') {
    const input = await body(request);
    if (!input.data) { json(response, 400, { error: '缺少文件内容' }); return true; }
    const buffer = Buffer.from(String(input.data).replace(/^data:[^;]+;base64,/, ''), 'base64');
    const parsed = parseWechatExport(buffer, input.fileName || 'export.xls');
    const imported = store.importWechatExport({ fileName: input.fileName, importType: input.importType, format: parsed.format, sheets: parsed.sheets });
    const index = indexArticleArtifacts(store, artifactRoots);
    const matches = matchWechatArticles(store, { force: false });
    json(response, 201, { ...imported, index, matches }); return true;
  }

  if (request.method === 'GET' && pathname === '/api/hotspots') {
    json(response, 200, store.listHotspots({
      q: searchParams.get('q') ?? '',
      source: searchParams.get('source') ?? '',
      date: searchParams.get('date') ?? '',
      limit: boundedLimit(searchParams,200,500),
    }));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/artifacts') {
    json(response, 200, store.listArtifacts({
      limit: boundedLimit(searchParams,300,500),
      batchId: searchParams.get('batch_id') || undefined,
    }));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/article-artifacts') {
    const items = store.listArticleArtifacts({
      query: searchParams.get('q') || '',
      status: searchParams.get('status') || '',
      limit: boundedLimit(searchParams, 300, 1000),
    }).map((item) => ({
      ...item,
      relative_path: path.relative(root, item.file_path).replaceAll('\\', '/'),
    }));
    json(response, 200, {
      items,
      stats: store.articleArtifactStats(),
    });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/article-artifacts/reindex') {
    const indexed = indexArticleArtifacts(store, artifactRoots);
    const matches = matchWechatArticles(store, { force: false });
    json(response, 200, { ...indexed, matches });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/artifacts/reindex') {
    json(response, 200, { indexed: indexArtifacts(store, artifactRoots) });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/articles') {
    json(response, 200, store.listFinalArticles({
      week: searchParams.get('week') || undefined,
      month: searchParams.get('month') || undefined,
    }));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/calendar') {
    const insights = enrichWechatReview(store.getWechatReview()).insights;
    const feedback = store.getLatestContentFeedbackSnapshot();
    json(response, 200, store.listCalendarContent({ month: searchParams.get('month') || undefined }).map((entry) => enrichCalendarEntry(entry, insights, feedback)));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/articles/stats') {
    json(response, 200, store.articleStats());
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/logs') {
    json(response, 200, store.listLogs({
      limit: boundedLimit(searchParams,100,500),
      logType: searchParams.get('type') || undefined,
    }));
    return true;
  }

  const artifactPreviewMatch = pathname.match(/^\/api\/artifacts\/(\d+)\/preview$/);
  if (artifactPreviewMatch && request.method === 'GET') {
    const artifact = store.getArtifact(Number(artifactPreviewMatch[1]));
    if (!artifact || !isInsideRoots(artifact.file_path, artifactRoots) || !fs.existsSync(artifact.file_path)) {
      json(response, 404, { error: '产物不存在或不在允许目录内' });
      return true;
    }
    response.setHeader('content-security-policy', ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY);
    if (isImageArtifact(artifact.file_path)) {
      response.writeHead(200, { 'content-security-policy': ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(imageArtifactPreviewHtml(`/api/artifacts/${artifact.id}/content`, artifact.name));
      return true;
    }
    if (path.extname(artifact.file_path).toLowerCase() !== '.html') {
      response.writeHead(200, { 'content-security-policy': ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(textArtifactPreviewHtml(fs.readFileSync(artifact.file_path, 'utf8'), artifact.name));
      return true;
    }
    response.writeHead(302, { location: `/api/artifacts/${artifact.id}/content` });
    response.end();
    return true;
  }

  const artifactMatch = pathname.match(/^\/api\/artifacts\/(\d+)\/content$/);
  if (artifactMatch && request.method === 'GET') {
    const artifact = store.getArtifact(Number(artifactMatch[1]));
    if (!artifact || !isInsideRoots(artifact.file_path, artifactRoots) || !fs.existsSync(artifact.file_path)) {
      json(response, 404, { error: '产物不存在或不在允许目录内' });
      return true;
    }
    const extension = path.extname(artifact.file_path).toLowerCase();
    if (extension === '.html' && searchParams.get('preview') === 'phone') {
      response.writeHead(200, { 'content-security-policy': ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(injectPhonePreviewStyles(fs.readFileSync(artifact.file_path, 'utf8')));
      return true;
    }
    const contentHeaders = { 'content-type': mime[extension] ?? 'text/plain; charset=utf-8' };
    if (extension === '.html') contentHeaders['content-security-policy'] = ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY;
    response.writeHead(200, contentHeaders);
    return pipeFile(response,artifact.file_path);
  }

  const artifactAssetMatch = pathname.match(/^\/api\/artifacts\/(\d+)\/(.+)$/);
  if (artifactAssetMatch && request.method === 'GET') {
    const artifact = store.getArtifact(Number(artifactAssetMatch[1]));
    let relativePath = '';
    try {
      relativePath = decodeURIComponent(artifactAssetMatch[2]);
    } catch {
      json(response, 400, { error: '产物资源路径无效' });
      return true;
    }
    const assetPath = artifact && isInsideRoots(artifact.file_path, artifactRoots)
      ? resolveArtifactRelativeAsset(artifact.file_path, relativePath, artifactRoots)
      : null;
    if (!assetPath) {
      json(response, 404, { error: '产物资源不存在或不在允许目录内' });
      return true;
    }
    const extension = path.extname(assetPath).toLowerCase();
    response.writeHead(200, {
      'content-type': mime[extension] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    return pipeFile(response,assetPath);
  }

  return false;
}

function assessMaterial(material, columns, context, wechatInsights = {}) {
  const text = `${material.title || ''}\n${material.raw_text || ''}`.trim();
  const contextWords = [...(context.contentPillars || []), context.readerProfile, context.description].filter(Boolean);
  const fitHits = contextWords.filter((word) => String(word).length > 1 && text.includes(String(word))).length;
  const accountFit = fitHits >= 2 ? 'high' : fitHits ? 'medium' : 'medium';
  const completeHits = ['我', '问题', '结果', '所以', '但是', '后来', '判断', '建议'].filter((word) => text.includes(word)).length;
  const completeness = text.length >= 260 && completeHits >= 3 ? 'high' : text.length >= 100 && completeHits >= 1 ? 'medium' : 'low';
  const potentialHits = ['为什么', '如何', '踩坑', '失败', '成本', '效率', '选择', '变化', '对比', '影响', '反而', '没想到'].filter((word) => text.includes(word)).length;
  const topicPotential = potentialHits >= 2 || text.length >= 500 ? 'high' : potentialHits ? 'medium' : 'low';
  const directions = [];
  if (!text.includes('为什么') && !text.includes('原因')) directions.push('补一层“为什么会这样”，把经历推进到可解释的判断');
  if (!text.includes('结果') && !text.includes('后来')) directions.push('补充结果、失败或反转，避免只停留在过程记录');
  if (!text.includes('建议') && !text.includes('适合')) directions.push('补充适用边界：什么人值得用，什么情况下不建议照做');
  if (!directions.length) directions.push('可继续追问成本、替代方案和对读者选择的影响');
  const sourceColumnName = material.source_type === 'project' ? '工具与实践' : material.source_type === 'reading' ? '读书与观察' : '真实复盘';
  const column = columns.find((item) => item.name === sourceColumnName) || columns[0];
  const overall = [accountFit, completeness, topicPotential].filter((item) => item === 'high').length >= 2 ? 'A' : [accountFit, completeness, topicPotential].includes('low') ? 'C' : 'B';
  const historicalSignal = matchWechatPerformance(text, wechatInsights);
  const recommendation = completeness === 'low' ? '整理补充' : topicPotential === 'high' && accountFit !== 'low' ? '写作候选' : historicalSignal.sample_count > 0 ? '历史表现优先验证' : '继续观察';
  return {
    account_fit: { level: accountFit, reason: fitHits ? `命中账号定位中的 ${fitHits} 个内容线索` : `暂未命中明确定位词，但来源属于${sourceColumnName}，需要再做账号化包装` },
    completeness: { level: completeness, reason: text.length >= 260 ? `已有约 ${text.length} 字记录，仍需检查结果和边界` : '记录偏短，先补发生了什么、你怎么判断、最后结果如何' },
    topic_potential: { level: topicPotential, reason: potentialHits ? `包含 ${potentialHits} 个可继续追问的冲突或问题线索` : '目前更像素材片段，补出具体问题或反差后再判断传播潜力' },
    deepening_directions: directions,
    recommendation,
    historical_signal: historicalSignal,
    overall_grade: overall,
    recommended_column_id: column?.id || null,
    title_directions: [
      { intent: '搜索型', direction: `围绕“${(material.title || text.split(/[。！？\n]/)[0]).slice(0, 24)}”补充具体问题词` },
      { intent: '分享型', direction: '突出真实反差、失败代价或读者能获得的判断' },
      { intent: '系列承接', direction: '以本次复盘的下一步实验或未解决问题作为后续预告' },
    ],
  };
}
