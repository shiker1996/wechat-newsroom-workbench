// 公众号封面图生成（确定性方式）。
// 组件构图在主题创建时固化在主题定义的 cover.spec 里；生成时只做确定性填充：
// 标题按 splitTitleLines 断行、副标题取文章摘要、信息行取品牌行，
// 最终由 cover-theme-compiler 确定性渲染 HTML，html-pages-to-images 截图为 900×383 PNG。
// 主题没有内置构图时整体回退 fallbackCoverSpec，保证永远出图。
// 设计文档：docs/2026-08-07-cover-image-design.md
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getBuiltinThemeRegistry } from '../themes/theme-registry.mjs';
import { resolveWorkspaceTheme } from '../themes/user-theme-service.mjs';
import { buildCoverHtml } from '../themes/cover-theme-compiler.mjs';
import { coverSpecFromTheme, fallbackCoverSpec } from '../themes/cover-components.mjs';
import { getAccountContext } from '../domain/account-context.mjs';
import { candidateArticleDir, batchArticlesDir } from '../core/workspace-paths.mjs';

// 生成封面图主流程：主题解析 → 主题构图/兜底规格 → 渲染 → 截图 → 落 workdir/images/cover.png
export async function generateCoverImage({ workspaceRoot, workdir, store = null, title, summary = '', brand = '', themeId = '', log = () => {} }) {
  const registry = getBuiltinThemeRegistry();
  const resolvedTitle = String(title || '').trim() || '未命名文章';
  const requested = themeId && themeId !== 'auto' ? themeId : '';
  let theme = requested ? resolveWorkspaceTheme(store, requested, 'cover') || null : null;
  if (requested && !theme) log(`指定封面主题 ${requested} 不存在，使用默认主题`);
  if (!theme) theme = registry.require('cover-navy-gold');

  let usedFallback = false;
  let spec = theme.cover?.spec ? coverSpecFromTheme(theme.cover.spec, { title:resolvedTitle, subtitle:summary, brand }) : null;
  if (!spec) {
    usedFallback = true;
    if (theme.cover?.spec) log('主题内置构图不合规，回退默认构图');
    spec = fallbackCoverSpec(resolvedTitle, { brand, subtitle: summary });
  }

  const { html, width, height } = buildCoverHtml({ theme, spec });
  const imageDir = path.join(workdir, 'images');
  fs.mkdirSync(imageDir, { recursive: true });
  const htmlPath = path.join(imageDir, 'cover.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  const { execute } = await import(pathToFileURL(path.join(workspaceRoot, 'skills', 'html-pages-to-images', 'index.js')).href);
  const result = await execute({ htmlFile: htmlPath, outputDir: imageDir, selector: '.page', pageWidth: width, pageHeight: height, deviceScaleFactor: 2 });
  if (!result.success) throw new Error(`封面截图失败：${result.message}`);
  const produced = result.data.images?.[0];
  if (!produced || !fs.existsSync(produced)) throw new Error('封面截图未产出图片');
  const target = path.join(imageDir, 'cover.png');
  if (path.resolve(produced) !== path.resolve(target)) {
    if (fs.existsSync(target)) fs.rmSync(target);
    fs.renameSync(produced, target);
  }
  const stat = fs.statSync(target);
  return { localPath: target, htmlPath, width, height, themeId: theme.id, themeLabel: theme.label, usedFallback, size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

// 从成稿 Markdown 取第一段正文作为封面副标题素材（去标题/引用/列表，≤60 字）
function firstParagraph(markdown) {
  for (const line of String(markdown || '').split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#') || text.startsWith('>') || text.startsWith('-') || text.startsWith('*') || /^\d+\./.test(text)) continue;
    const plain = text.replace(/[*`[\]]/g, '').trim();
    if ([...plain].length >= 12) return [...plain].slice(0, 60).join('');
  }
  return '';
}

// AI 任务出口：解析候选上下文 → 生成 → 落 artifacts（kind=封面图）
// candidateId 为 null 时是批次早报：终稿取批次级 daily-final 文档，产物落 articles/<批次>/daily/images/
export async function runCoverImageJob({ gateway, store, batchId, candidateId, provider, workspaceRoot, theme = '', onProgress = () => {} }) {
  const batch = store.getBatch(batchId);
  if (!batch) throw new Error('批次不存在');
  const daily = candidateId == null;
  const candidate = daily ? null : store.getCandidate(Number(candidateId));
  if (!daily && !candidate) throw new Error('候选不存在');
  const accountContext = getAccountContext();
  const workdir = daily ? path.join(batchArticlesDir(workspaceRoot, batch), 'daily') : candidateArticleDir(workspaceRoot, batch, candidate);
  const finalDoc = store.getDocument(batchId, daily ? null : candidate.id, daily ? 'daily-final' : 'final');
  if (!finalDoc) throw new Error(daily ? '缺少早报终稿，请先完成批次早报' : '缺少成稿终稿，请先完成成稿链');
  // title 字段已统一为正文 H1（成稿链保存时提取），封面直接以它为原题
  const title = String(finalDoc?.title || candidate?.hotspot_title || '').trim() || (daily ? '批次早报' : '未命名文章');
  const summary = firstParagraph(finalDoc?.content);
  const now = new Date();
  const brand = `${accountContext?.name || ''} · ${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
  onProgress('正在生成封面排版规格…');
  const result = await generateCoverImage({
    workspaceRoot, workdir, gateway, store, accountContext, title, summary, brand,
    themeId: theme === 'auto' ? '' : theme, provider, log: onProgress,
  });
  store.upsertArtifact({ batchId, candidateId: candidate?.id ?? null, kind: '封面图', name: 'cover.png', path: result.localPath, size: result.size, modifiedAt: result.modifiedAt });
  onProgress(`封面已生成（${result.themeLabel}${result.usedFallback ? ' · 默认构图' : ''}）`);
  return { image: 'images/cover.png', themeId: result.themeId, themeLabel: result.themeLabel, usedFallback: result.usedFallback, width: result.width, height: result.height };
}
