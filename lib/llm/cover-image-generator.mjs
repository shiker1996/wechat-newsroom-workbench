// 公众号封面图生成（AI 非视觉方式）。
// AI 只做排版决策：选主题（可选）、组合组件、标题断行与高亮、起标签/副标题文案，
// 产出规格 JSON；规格经 validateCoverSpec 校验，任一不合规整体回退 fallbackCoverSpec，
// 最终由 cover-theme-compiler 确定性渲染 HTML，html-pages-to-images 截图为 900×383 PNG。
// 设计文档：docs/2026-08-07-cover-image-design.md
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getBuiltinThemeRegistry } from '../themes/theme-registry.mjs';
import { resolveWorkspaceTheme } from '../themes/user-theme-service.mjs';
import { buildCoverHtml } from '../themes/cover-theme-compiler.mjs';
import { validateCoverSpec, fallbackCoverSpec, COVER_COMPONENT_CATALOG, COVER_LIMITS } from '../themes/cover-components.mjs';
import { getAccountContext } from '../domain/account-context.mjs';
import { candidateArticleDir } from '../core/workspace-paths.mjs';

function parseJsonLoose(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch {}
  const brace = text.match(/(\{[\s\S]*\})/);
  if (brace) try { return JSON.parse(brace[1]); } catch {}
  return null;
}

// 模型有时把规格包在 spec/cover 等外层键里，或把 components 放在嵌套层——逐层剥取含 components 数组的对象
function unwrapSpecObject(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return null;
  if (Array.isArray(value.components)) return value;
  for (const key of ['spec', 'cover', 'coverSpec', 'design', 'result', 'data']) {
    const found = unwrapSpecObject(value[key], depth + 1);
    if (found) return { ...found, themeId: found.themeId ?? value.themeId };
  }
  return null;
}

// 组件目录的 prompt 描述（保持与 COVER_COMPONENT_CATALOG 一致）
function componentCatalogText() {
  return Object.entries(COVER_COMPONENT_CATALOG).map(([type, meta]) => {
    const fields = Object.entries(meta.fields).map(([key, rule]) => Array.isArray(rule) ? `${key}: ${rule.join('|')}` : `${key}: ${rule}`).join('，');
    return `- ${type}（${meta.label}${meta.required ? '，必选' : `，最多 ${meta.max} 个`}）：${fields}`;
  }).join('\n');
}

// AI 出封面规格。themes 为候选封面主题（publicTheme 形态），fixedThemeId 非空时主题已定、AI 只做组件组合。
export async function planCoverSpec({ gateway, accountContext, title, summary, brand, themes, fixedThemeId = '', provider = '', log = () => {} }) {
  if (!gateway) return null;
  const themeList = themes.map((theme) => `- ${theme.id}（${theme.label}）：${theme.description}`).join('\n');
  const system = `你是公众号封面设计师。根据文章标题与账号调性，设计 900×383 公众号封面图的排版规格（JSON），不画图，只做组件组合与排版决策。
可用组件（type 与字段严格受限，不得发明）：
${componentCatalogText()}
约束：
- canvas 与 title 必选；title 的 lines 最多 ${COVER_LIMITS.titleLines} 行、每行 ≤${COVER_LIMITS.lineChars} 字（断行要在语义自然处），highlights 是最多 ${COVER_LIMITS.highlights} 个标题原文里的关键词（原样摘录，用于换强调色）；
- eyebrow 文案 ≤${COVER_LIMITS.eyebrowChars} 字，是栏目名/期号/编号类短标签，不要复述标题；subtitle ≤${COVER_LIMITS.subtitleChars} 字，是对标题的一句话补充，标题信息足够时可不给；
- 组件总数 ≤${COVER_LIMITS.components}；装饰最多 2 个，宁少勿多；
- color-block 的 colorRole 决定色块颜色（accent=主题强调色，ink=正文墨色，code=深色）；canvas 的 colorRole=ink 时是深底封面；
- 设计纪律：一张封面三种颜色，标题是绝对主角；整版 accent 色块（full）视觉最冲击，适合重大议题；left-third/right-panel 更克制，适合常规深度文。
返回严格 JSON：{"themeId":"主题id","components":[{"type":"canvas","colorRole":"page"},...]}${fixedThemeId ? `\n主题已指定为 ${fixedThemeId}，themeId 原样返回即可。` : '\nthemeId 必须从给定主题列表中选一个最贴文章调性的。'}`;
  const user = `- 公众号：${accountContext?.name || ''}（${accountContext?.description || ''}）
- 文章标题：${title}
${summary ? `- 文章摘要：${summary}\n` : ''}- 品牌信息行可用：${brand || '无'}
可选封面主题：
${themeList}`;
  try {
    const result = await gateway.complete({
      provider, purpose: 'cover-spec', jsonMode: true, maxOutputTokens: 2000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    const parsed = unwrapSpecObject(parseJsonLoose(result.content)) || parseJsonLoose(result.content);
    const validation = validateCoverSpec(parsed);
    if (!validation.ok) {
      log(`AI 封面规格不合规（${validation.issues[0]?.field} ${validation.issues[0]?.message}），回退默认构图`);
      return null;
    }
    return { spec: validation.spec, themeId: String(parsed?.themeId || fixedThemeId || '').trim() };
  } catch (error) {
    log(`AI 封面规格生成失败，回退默认构图：${error.message}`);
    return null;
  }
}

// 生成封面图主流程：主题解析 → AI/兜底规格 → 渲染 → 截图 → 落 workdir/images/cover.png
export async function generateCoverImage({ workspaceRoot, workdir, gateway, store = null, accountContext, title, summary = '', brand = '', themeId = '', provider = '', log = () => {} }) {
  const registry = getBuiltinThemeRegistry();
  // 候选主题 = 内置 + 已发布用户封面主题（AI 选主题与手动指定都走同一解析）
  const userCoverThemes = (store?.listUserThemes?.({ target: 'cover' }) || [])
    .filter((row) => row.status === 'published' && row.active_version_id)
    .map((row) => ({ id: row.id, label: row.label, description: '' }));
  const themes = [...registry.list({ target: 'cover' }).map((theme) => ({ id: theme.id, label: theme.label, description: theme.description })), ...userCoverThemes];
  const resolvedTitle = String(title || '').trim() || '未命名文章';
  const resolve = (id) => (id ? resolveWorkspaceTheme(store, id, 'cover') || null : null);

  let theme = resolve(themeId);

  let usedFallback = false, planned = null;
  if (gateway) {
    planned = await planCoverSpec({
      gateway, accountContext, title: resolvedTitle, summary, brand, themes,
      fixedThemeId: theme?.id || '', provider, log,
    });
  }
  if (planned?.themeId && !theme) {
    const picked = resolve(planned.themeId);
    if (picked) theme = picked;
  }
  if (!theme) theme = registry.require('cover-navy-gold');

  let spec = planned?.spec || null;
  if (!spec) {
    usedFallback = true;
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
export async function runCoverImageJob({ gateway, store, batchId, candidateId, provider, workspaceRoot, theme = '', onProgress = () => {} }) {
  const batch = store.getBatch(batchId);
  const candidate = store.getCandidate(Number(candidateId));
  if (!batch || !candidate) throw new Error('候选不存在');
  const accountContext = getAccountContext();
  const workdir = candidateArticleDir(workspaceRoot, batch, candidate);
  const finalDoc = store.getDocument(batchId, candidate.id, 'final');
  const title = String(finalDoc?.title || candidate.hotspot_title || '').trim() || '未命名文章';
  const summary = firstParagraph(finalDoc?.content);
  const now = new Date();
  const brand = `${accountContext?.name || ''} · ${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
  onProgress('正在生成封面排版规格…');
  const result = await generateCoverImage({
    workspaceRoot, workdir, gateway, store, accountContext, title, summary, brand,
    themeId: theme === 'auto' ? '' : theme, provider, log: onProgress,
  });
  store.upsertArtifact({ batchId, candidateId: candidate.id, kind: '封面图', name: 'cover.png', path: result.localPath, size: result.size, modifiedAt: result.modifiedAt });
  onProgress(`封面已生成（${result.themeLabel}${result.usedFallback ? ' · 默认构图' : ''}）`);
  return { image: 'images/cover.png', themeId: result.themeId, themeLabel: result.themeLabel, usedFallback: result.usedFallback, width: result.width, height: result.height };
}
