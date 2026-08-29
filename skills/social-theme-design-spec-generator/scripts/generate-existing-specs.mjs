import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
const socialRoot = path.join(root, 'themes', 'social');
const prefixes = {
  'ice-blue': 'ic', neon: 'neon', 'tokyo-night': 'tokyo', brutalist: 'bt', solarized: 'sol',
  'retro-terminal': 'rt', 'paper-craft': 'pc', charcoal: 'char', peach: 'peach', orange: 'orange',
  mocha: 'mocha', lavender: 'lav', crimson: 'crim', 'bone-white': 'bone',
};
const colorLabels = {
  background: '画布背景', page: '页面底色', surface: '卡片表面', text: '正文/标题', muted: '辅助文字',
  accent: '主强调色', accentSecondary: '次强调色', line: '分隔线', inverseText: '深色表面反色文字', codeBackground: '代码/深色表面',
};
const runtimeVars = { background: '--bg', page: '--page', surface: '--surface', text: '--ink', muted: '--muted', accent: '--accent', accentSecondary: '--accent2', line: '--line', inverseText: '--inverse', codeBackground: '--code' };

function json(value) { return JSON.stringify(value || {}, null, 2); }

// Typography sizing/weight belongs to the shared Layout Guide. These fields are
// deliberately not exposed in the AI-facing spec so the Agent can choose them
// by page responsibility instead of inheriting programmatic defaults.
function removeAiSizing(value) {
  if (Array.isArray(value)) return value.map(removeAiSizing);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['sizeScale', 'fontWeight'].includes(key))
    .map(([key, item]) => [key, removeAiSizing(item)]));
}

function componentSection(prefix) {
  return `### 主题组件绑定

- 主题类名前缀：\`.${prefix}-*\`。
- 保留通用页面骨架、组件语义和 HTML 层级；使用本主题前缀承载主题样式。
- 主题可以自由设计组件内部的构图、局部布局、内外边距、尺寸、错位和装饰，只要不新增页面壳、插槽或另一套组件语义。
- 组件选择仍由页面职责、事实语义和 \`card-plan.json\` 决定；主题配方只说明哪些视觉处理适合当前主题。`;
}

function decorationSection(theme) {
  const decoration = String(theme.social?.recipes?.decoration || 'none');
  const texture = String(theme.social?.effects?.texture || 'none');
  const tiltValue = Number(theme.social?.effects?.contentTiltDeg);
  const decorationText = {
    orbit: '使用轨道、圆弧、细边框或同类线性结构形成方向感。',
    'soft-blur': '使用柔和的模糊渐变光斑或空气感层次。',
    scanlines: '使用原尺寸可辨认的 CRT 横向扫描线或同类屏幕质感。',
    'paper-offset': '使用受控的纸张错位、阴影或轻微倾斜边缘。',
    circle: '使用清晰但低干扰的圆形轮廓或圆弧。',
    none: '不要求独立装饰伪元素，可用边框、色块、投影或留白建立层次。',
  }[decoration] || '使用主题配置指定的可见背景层或边缘层。';
  const textureText = texture === 'grid'
    ? '纹理可使用可辨认的网格线。'
    : texture === 'paper-grain'
      ? '纹理可使用细颗粒或纸张噪点。'
      : texture === 'scanlines'
        ? '纹理可使用规律清晰但克制的重复横线。'
        : '不要求额外纹理，优先使用主题表面、渐变或色块建立深度。';
  const tiltText = Number.isFinite(tiltValue) && Math.abs(tiltValue) > 0 ? '允许加入轻微的纸张错位或倾斜感。' : '';
  const direction = [decorationText, textureText, tiltText].filter(Boolean).join(' ');
  return `## 主题装饰

主题装饰方向：${direction}

装饰应在 375×667 原尺寸下可感知，但具体载体、位置、尺寸、透明度和构图由页面 Agent 根据当前页面决定；可以使用背景层、伪元素或主题组件。装饰只承担氛围和层级，不承载事实，必须位于内容后方并保持文字可读。`;
}

function semanticComponentSection(theme) {
  const recipes = theme.social?.recipes || {};
  const shadow = theme.tokens?.shape?.shadow || 'soft';
  const rows = [
    ['metric-focus', '数字、比例、价格、规模或版本', recipes.coverSupport || 'metric', `用 accent 或 accent2 放大事实；使用 ${shadow} 投影，不新增数字`],
    ['process-rail', '步骤、流程、执行循环或时间顺序', recipes.skeleton || 'theme rail', '用节点、箭头或阶段条表达顺序；不改变步骤内容'],
    ['signal-grid', '3–4 个并列问题、能力或选项', recipes.list || 'outlined-card', '用 surface 与 line 形成可扫描的并列层级'],
    ['warning-panel', '风险、限制、未验证项或证据边界', recipes.frame || 'theme-frame', '用 accent2、边框或状态底色提高边界信息辨识度'],
    ['terminal-panel', '代码、命令或安装指令', recipes.code || 'code-panel', '用 code 表面、mono 字体和主题边框保持操作感'],
    ['accent-fill', '结论、总结、适用人群或下一步', recipes.ending || 'accent-fill', '用 accent 与 inverse 形成结论色块，不扩展事实'],
  ];
  return `## 语义组件配方

以下配方说明不同事实在本主题下适合采用的视觉处理。组件选择、每页数量和整组节奏由 AI 视觉技能根据事实与页面职责决定，不要为了填充空间虚构指标、步骤或结论。

| 语义组件 | 适用输入 | 当前主题配方 | 实现边界 |
|---|---|---|---|
${rows.map(([id, when, recipe, treatment]) => '| ' + id + ' | ' + when + ' | ' + recipe + ' | ' + treatment + ' |').join('\n')}

主题可以用 accent / accent2 / surface / inverse 和 ${shadow} 投影拉开层级；页面 Agent 可以改变组件构图、尺寸、强调位置和装饰位置，具体强弱由页面职责决定。`;
}

function buildSpec(theme) {
  const prefix = prefixes[theme.id] || theme.id.slice(0, 2);
  const colors = theme.tokens?.colors || {};
  const typography = theme.tokens?.typography || {};
  const shape = theme.tokens?.shape || {};
  const recipes = theme.social?.recipes || {};
  const visualRecipes = Object.fromEntries(Object.entries(recipes).filter(([key]) => key !== 'skeleton'));
  const effects = theme.social?.effects || {};
  const components = removeAiSizing(theme.social?.components || {});
  const colorRows = Object.entries(colors).map(([key, value]) => `| ${colorLabels[key] || key} | ${value} | var(${runtimeVars[key] || '--' + key}) |`).join('\n');
  return `# ${theme.label} · Social AI Design Spec

> 主题 ID：${theme.id} · 版本：${theme.version} · 目标：Social 图文视觉生成

## 主题定位

${theme.description || `${theme.label}主题，用于技术、事件、工具或趋势内容的清晰图文表达。`}

主题识别由以下颜色、形状、组件处理和装饰方向共同建立；页面焦点与信息层级由 AI 视觉技能根据事实决定。

## 设计 Token

### 配色

| 语义 | 实际颜色 | 运行时变量 |
|---|---|---|
${colorRows}

正文使用 var(--ink)，辅助信息使用 var(--muted)；深色表面使用匹配的反色文字，强调色先检查实际背景对比度。

### 字体

- 字体：正文 ${typography.family || 'sans'}；标题 ${typography.headingFamily || typography.family || 'sans'}。
- 排版和布局统一遵循 AI 视觉技能提供的 Layout Guide，本主题不另设数值。

### 形状与效果

- 圆角：${shape.radiusPx || 18}px；边框：${shape.borderWidthPx || 1}px；阴影：${shape.shadow || 'soft'}。
- 可选主题视觉词汇（不要逐页机械复用）：${json(visualRecipes)}
- 主题纹理：${effects.texture || 'none'}；装饰强度只作参考，实际透明度由页面 Agent 按背景和可读性调整。

### 组件级主题配置

以下配置只提供组件的字体家族、语义颜色和边框角色；字号、字重、行高和具体构图由 Layout Guide、故事板事实与页面 Agent 决定：

\`\`\`json
${json(components)}
\`\`\`

${semanticComponentSection(theme)}

## 组件视觉绑定

${componentSection(prefix)}

${decorationSection(theme)}

## 主题视觉应用

- 使用主题 Token、组件前缀和主题装饰建立识别度；具体组件、构图和页面节奏由 AI 视觉技能根据事实决定。
- 使用 \`accent / accent2 / surface / inverse\` 形成层级对比：数字焦点、证据边界和结论收束都可以采用主题化处理，但不要求每页或每组固定出现某种组件。
- 主题视觉只承担层级与氛围，不承载事实；保留通用页面骨架和语义结构即可。\n`;
}

const files = fs.readdirSync(socialRoot).filter((name) => name.endsWith('.json')).sort();
for (const file of files) {
  const theme = JSON.parse(fs.readFileSync(path.join(socialRoot, file), 'utf8'));
  const directory = path.join(socialRoot, theme.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'AI_DESIGN_SPEC.md'), buildSpec(theme), 'utf8');
  console.log(`${theme.id}: AI_DESIGN_SPEC.md`);
}
