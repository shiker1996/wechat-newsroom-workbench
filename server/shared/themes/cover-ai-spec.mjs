import fs from 'node:fs';
import path from 'node:path';

export const COVER_AI_DESIGN_SPEC_FILENAME = 'AI_DESIGN_SPEC.md';
export const COVER_AI_DESIGN_SPEC_MAX_BYTES = 64 * 1024;

export const COVER_AI_DESIGN_SPEC_HEADINGS = Object.freeze([
  '主题定位',
  '配色关系',
  '字体与标题气质',
  '背景与图形语言',
  '推荐构图',
  '标题区与留白',
  '可见装饰',
  '应避免的退化',
]);

const COLOR_KEYS = Object.freeze(['page', 'text', 'muted', 'accent', 'accentSecondary', 'inverseText', 'codeBackground']);

function text(value) {
  return String(value ?? '').trim();
}

function safeThemeId(theme) {
  return text(theme?.id).replace(/[^a-z0-9-]/gi, '-') || 'cover-theme';
}

function color(theme, key, fallback = '') {
  return text(theme?.tokens?.colors?.[key]) || fallback;
}

function listComponents(theme) {
  return Array.isArray(theme?.cover?.spec?.components)
    ? theme.cover.spec.components.map((component) => {
      const fields = [component.type, component.position, component.shape, component.kind, component.form]
        .filter(Boolean)
        .join(' / ');
      return fields || 'component';
    })
    : [];
}

function inferredMood(theme) {
  const tags = Array.isArray(theme?.tags) ? theme.tags.filter(Boolean).join('、') : '';
  const description = text(theme?.description);
  return [description, tags].filter(Boolean).join('；') || '保持克制、清晰并突出文章标题。';
}

function inferredDecoration(theme) {
  const components = Array.isArray(theme?.cover?.spec?.components) ? theme.cover.spec.components : [];
  const decorations = components.filter((component) => component.type === 'decoration').map((component) => component.kind).filter(Boolean);
  const texture = components.find((component) => component.type === 'canvas')?.texture;
  return [decorations.length ? `优先使用 ${decorations.join('、')} 等线性或几何装饰` : '使用少量主题化几何装饰', texture && `可以借鉴 ${texture} 背景质感`].filter(Boolean).join('；');
}

function inferredComposition(theme) {
  const layout = text(theme?.cover?.spec?.layout) || '自由组合';
  const components = listComponents(theme);
  return `标准主题构图提示为 ${layout}；AI 可以围绕这一倾向重新组织单页构图。当前主题组件线索：${components.join('、') || '画布、标题和装饰'}。不要把这段提示当成固定模板。`;
}

function inferredTitleGuidance(theme) {
  const headingFamily = text(theme?.tokens?.typography?.headingFamily) || 'sans';
  const page = color(theme, 'page', '#FFFFFF');
  const title = color(theme, 'text', '#111111');
  const accent = color(theme, 'accent', '#333333');
  return `标题使用 ${headingFamily} 字族和 ${title} 语义色，优先成为画布第一视觉层；可用 ${accent} 做少量关键词、边线或色块强调。画布主色为 ${page}。标题、副标题和信息行必须保留安全留白，不让装饰穿过文字。`;
}

export function validateCoverAiDesignSpec(spec, { maxBytes = COVER_AI_DESIGN_SPEC_MAX_BYTES } = {}) {
  const value = text(spec);
  const issues = [];
  if (!value) issues.push({ code: 'EMPTY', message: '封面 AI 设计规范不能为空' });
  if (Buffer.byteLength(value, 'utf8') > maxBytes) issues.push({ code: 'TOO_LARGE', message: `封面 AI 设计规范不能超过 ${maxBytes} bytes` });
  for (const heading of COVER_AI_DESIGN_SPEC_HEADINGS) {
    if (!new RegExp(`^##\\s+${heading}\\s*$`, 'm').test(value)) issues.push({ code: 'MISSING_HEADING', heading, message: `缺少二级标题：${heading}` });
  }
  return { ok: issues.length === 0, issues, text: value };
}

export function buildDeterministicCoverAiDesignSpec(theme = {}) {
  const id = safeThemeId(theme);
  const label = text(theme.label) || id;
  const version = text(theme.version) || 'unknown';
  const colors = theme?.tokens?.colors || {};
  const typography = theme?.tokens?.typography || {};
  const spacing = theme?.tokens?.spacing || {};
  const shape = theme?.tokens?.shape || {};
  const codeMark = String.fromCharCode(96);
  const colorRows = COLOR_KEYS.map((key) => `| ${key} | ${color(theme, key, '未声明')} | ${codeMark}var(--${key === 'accentSecondary' ? 'accent-secondary' : key})${codeMark} |`).join('\n');
  const componentList = listComponents(theme).map((item) => `- ${item}`).join('\n') || '- canvas / title / decoration';
  return `# ${label} · Cover AI Design Spec

> 主题 ID：${id} · 版本：${version} · 目标：公众号封面 AI HTML/CSS 视觉生成
>
> 本规范只描述主题视觉语言，不承载文章事实，不定义最终正文，不要求 Agent 复刻标准 renderer 的固定模板。

## 主题定位

${inferredMood(theme)}

主题识别应来自配色、字族、几何关系和装饰共同作用；标题仍然是封面的第一视觉层。

## 配色关系

| 语义 | 实际颜色 | AI 侧变量参考 |
| --- | --- | --- |
${colorRows}

${text(colors.page) ? `以 ${colors.page} 作为画布主表面，以 ${colors.text || 'text'} 承载标题，以 ${colors.muted || 'muted'} 弱化副标题和信息行。${colors.accent || '强调色'} 只用于视觉焦点、边线、色块或少量装饰。` : '使用主题已声明的颜色 Token，保持背景、标题、弱化文字和强调色之间的层级。'}

## 字体与标题气质

- 正文字族：${text(typography.family) || 'sans'}；标题字族：${text(typography.headingFamily) || 'sans'}。
- 标题字号、行高和具体断行由封面运行时和画布实测决定，不在本规范中重复固定。
- ${inferredTitleGuidance(theme)}

## 背景与图形语言

${inferredDecoration(theme)}。优先使用 CSS 几何、渐变、细线、内联 SVG 或主题色块营造主视觉；图形只承担氛围和层级，不承载新的事实。

## 推荐构图

${inferredComposition(theme)}

封面是 900×383 的单页横向画布。可以采用侧栏、顶带、斜切、居中框景、极简大字或同等语义构图，但应保持一个主视觉重心，避免把多个同等强度的卡片并排堆叠。

## 标题区与留白

${inferredTitleGuidance(theme)} 标题区应预留足够的横向和纵向安全空间；副标题只能作为辅助解释，信息行保持最低视觉权重。不要把任何装饰、线条或色块直接压在标题字形上。

主题 Token 中的间距参考：paddingX=${spacing.paddingXPx ?? '未声明'}、paddingY=${spacing.paddingYPx ?? '未声明'}、gap=${spacing.gapPx ?? '未声明'}；这些值是主题方向参考，最终以 900×383 实测为准。徽章圆角参考：${shape.badgeRadiusPx ?? '未声明'}。

## 可见装饰

装饰应在 900×383 原尺寸和缩略图中仍然可感知，但不能挤压标题安全区。建议从以下标准主题线索中选择并做有限变化：

${componentList}

装饰数量宜少而明确，优先让一到两种图形语言形成主题记忆点。

## 应避免的退化

- 不要退化为只有标题和纯色背景的空页面；
- 不要使用与主题无关的通用图标或随机装饰；
- 不要堆叠多个普通卡片、过度阴影或高频渐变；
- 不要让装饰遮挡标题、副标题或信息行；
- 不要把标题、数字、人物、公司名或结论改写后绘制进 SVG；
- 不要使用脚本、远程资源、外链字体或外链图片；
- 不要通过裁切、内部滚动或透明文字规避布局问题。
`;
}

function specPathForTheme(workspaceRoot, theme) {
  const file = text(theme?.file);
  const id = safeThemeId(theme);
  if (file) {
    const base = path.dirname(file);
    return path.join(path.basename(base) === id ? base : path.join(base, id), COVER_AI_DESIGN_SPEC_FILENAME);
  }
  return path.join(workspaceRoot || process.cwd(), 'themes', 'cover', id, COVER_AI_DESIGN_SPEC_FILENAME);
}

function inlineSpec(theme) {
  const candidate = theme?.aiVisualSpec;
  if (typeof candidate === 'string') return candidate;
  if (candidate && typeof candidate === 'object' && typeof candidate.markdown === 'string') return candidate.markdown;
  return '';
}

export function loadCoverAiDesignSpec({ workspaceRoot = process.cwd(), theme, allowFallback = true } = {}) {
  if (!theme || typeof theme !== 'object') throw new TypeError('缺少封面主题，无法加载 AI 设计规范');
  const filePath = specPathForTheme(workspaceRoot, theme);
  const inline = inlineSpec(theme);
  const candidates = [
    inline ? { source: 'theme.aiVisualSpec', path: '', text: inline } : null,
    fs.existsSync(filePath) ? { source: 'file', path: filePath, text: fs.readFileSync(filePath, 'utf8') } : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const validation = validateCoverAiDesignSpec(candidate.text);
    if (validation.ok) return { ...validation, source: candidate.source, path: candidate.path, fallback: false, themeId: safeThemeId(theme) };
  }
  if (!allowFallback) {
    const validation = candidates[0] ? validateCoverAiDesignSpec(candidates[0].text) : { ok: false, issues: [{ code: 'NOT_FOUND', message: `缺少封面 AI 设计规范：${filePath}` }] };
    return { ...validation, source: candidates[0]?.source || 'missing', path: candidates[0]?.path || filePath, fallback: false, themeId: safeThemeId(theme) };
  }
  const generated = buildDeterministicCoverAiDesignSpec(theme);
  return { ok: true, issues: [], text: generated, source: 'deterministic-fallback', path: filePath, fallback: true, themeId: safeThemeId(theme) };
}

export function writeCoverAiDesignSpecSnapshot({ workspaceRoot = process.cwd(), workdir, theme, fileName = 'cover-theme-design-spec.md' } = {}) {
  if (!workdir) throw new TypeError('缺少封面 AI 设计规范快照工作目录');
  const loaded = loadCoverAiDesignSpec({ workspaceRoot, theme, allowFallback: true });
  const target = path.join(workdir, fileName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, loaded.text, 'utf8');
  return { ...loaded, snapshotPath: target };
}
