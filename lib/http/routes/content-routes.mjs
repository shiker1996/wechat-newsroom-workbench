import fs from 'node:fs';
import path from 'node:path';
import { indexArtifacts, isInsideRoots, resolveArtifactRelativeAsset } from '../../artifacts/artifact-indexer.mjs';
import { imageArtifactPreviewHtml, injectPhonePreviewStyles, isImageArtifact } from '../../artifacts/artifact-preview.mjs';
import { boundedLimit, pipeFile } from '../route-helpers.mjs';

export async function handleContentRoutes(context) {
  const { request, response, pathname, searchParams, store, artifactRoots, mime, json } = context;

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
    json(response, 200, store.listCalendarContent({ month: searchParams.get('month') || undefined }));
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
    if (isImageArtifact(artifact.file_path)) {
      response.writeHead(200, { 'content-security-policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-src 'self'", 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(imageArtifactPreviewHtml(`/api/artifacts/${artifact.id}/content`, artifact.name));
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
      response.writeHead(200, { 'content-security-policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-src 'self'", 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(injectPhonePreviewStyles(fs.readFileSync(artifact.file_path, 'utf8')));
      return true;
    }
    const contentHeaders = { 'content-type': mime[extension] ?? 'text/plain; charset=utf-8' };
    if (extension === '.html') {
      // 应用自身的产物预览 iframe 需要嵌入该 HTML，放宽 frame-ancestors 为同源
      contentHeaders['content-security-policy'] = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-src 'self'";
    }
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
