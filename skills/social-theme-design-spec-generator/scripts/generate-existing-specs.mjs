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
function componentSection(prefix) {
  return `### 主题组件绑定

- 主题类名前缀：\`.${prefix}-*\`。
- 通用组件的语义、HTML 层级和基础 CSS 以 \`xhs-visual-contract.md\` 为准；生成时将契约中的组件类名替换为本主题前缀，并保留同等语义结构。
- 本主题只覆盖组件的颜色、字体、边框、圆角、投影、渐变和装饰，不新增页面壳、插槽、布局容器或另一套组件目录。
- 组件选择仍由页面职责、事实语义和 \`card-plan.json\` 决定；主题配方只说明哪些视觉处理适合当前主题。`;
}

function decorationSection(theme) {
  const fence = '```';
  const decoration = String(theme.social?.recipes?.decoration || 'none');
  const texture = String(theme.social?.effects?.texture || 'none');
  const opacityValue = Number(theme.social?.effects?.decorationOpacity);
  const opacity = Number.isFinite(opacityValue) ? opacityValue : 0.2;
  const recipeText = {
    orbit: `使用页面伪元素建立细边框与轨道环：

${fence}css
.page { position:relative; isolation:isolate; overflow:hidden; background:radial-gradient(circle at 85% 10%,color-mix(in srgb,var(--accent) 14%,transparent),transparent 55%),var(--page); }
.page::before { content:""; position:absolute; inset:16px; border:1px solid color-mix(in srgb,var(--accent) 32%,transparent); opacity:var(--decoration-opacity); pointer-events:none; z-index:0; }
.page::after { content:""; position:absolute; width:180px; height:180px; right:-72px; top:-58px; border:1px solid color-mix(in srgb,var(--accent) 76%,transparent); border-radius:50%; box-shadow:0 0 0 9px color-mix(in srgb,var(--accent2) 10%,transparent),0 0 28px color-mix(in srgb,var(--accent) 14%,transparent); opacity:var(--decoration-opacity); pointer-events:none; z-index:0; }
.page-body { position:relative; z-index:1; background:linear-gradient(135deg,transparent 0 70%,color-mix(in srgb,var(--accent) 5%,transparent) 70.4% 70.8%,transparent 71%); }
${fence}

轨道环和细边框是主题识别元素，每页至少保留其中一项；装饰层必须位于内容后方，不得遮挡文字。`,
    'soft-blur': '使用低透明度的模糊渐变光斑作为氛围层，并保留一个清晰的主题边缘或分隔线；光斑不得承载信息，也不得降低文字对比度。',
    scanlines: '使用低透明度横向扫描线作为背景纹理，并用一条主题色边线建立页面方向；扫描线只能作为氛围，不得替代信息层级。',
    'paper-offset': '使用轻微错位、纸张阴影或倾斜边缘制造层次；倾斜角度必须遵守 contentTiltDeg，不得造成文字或卡片越界。',
    circle: '使用一组低透明度圆形轮廓或圆弧作为背景装饰，并与主题强调色分隔线搭配；圆形只做氛围，不得遮挡内容。',
    none: '当前主题明确不使用独立装饰伪元素；视觉层次必须由边框、色块、投影和留白完成。',
  }[decoration] || '使用主题配置指定的装饰方式，必须有可见但不干扰内容的背景层或边缘层。';
  const textureText = texture === 'grid'
    ? '纹理：使用低透明度网格线，不能让背景抢过正文。'
    : texture === 'paper-grain'
      ? '纹理：使用细颗粒或纸张噪点，不能制造脏污感或影响文字对比度。'
      : texture === 'scanlines'
        ? '纹理：使用重复横线，线宽和透明度保持克制。'
        : '纹理：无额外纹理，优先使用渐变、边框或色块建立深度。';
  return `## 必须落地的装饰层

主题配方 decoration=${decoration}、装饰透明度 ${opacity} 必须落地为可执行的主题装饰实现；本节给出每页至少一个可见装饰元素的实现方式，实际生成与门禁由 AI 视觉技能统一执行。装饰必须使用主题变量，不能只写“可添加装饰”而不落地 CSS。

${recipeText}

${textureText}

本主题装饰层只承担氛围和层级，不承载事实信息；通用安全、可读性和事实门禁由 AI 视觉技能与视觉契约统一执行。`;
}

function buildSpec(theme) {
  const prefix = prefixes[theme.id] || theme.id.slice(0, 2);
  const colors = theme.tokens?.colors || {};
  const typography = theme.tokens?.typography || {};
  const spacing = theme.tokens?.spacing || {};
  const shape = theme.tokens?.shape || {};
  const recipes = theme.social?.recipes || {};
  const visualRecipes = Object.fromEntries(Object.entries(recipes).filter(([key]) => key !== 'skeleton'));
  const effects = theme.social?.effects || {};
  const components = theme.social?.components || {};
  const fence = '```';
  const colorRows = Object.entries(colors).map(([key, value]) => `| ${colorLabels[key] || key} | ${value} | var(${runtimeVars[key] || '--' + key}) |`).join('\n');
  return `# ${theme.label} · Social AI Design Spec

> 主题 ID：${theme.id} · 版本：${theme.version} · 目标：Social 图文视觉生成

## 主题定位

${theme.description || `${theme.label}主题，用于技术、事件、工具或趋势内容的清晰图文表达。`}

设计重点：保持主题辨识度，同时让核心事实、关键数字、人物/组织、变化方向和限制条件成为视觉焦点。允许使用图标、徽章和箭头，但装饰必须服务于信息层级。

## 设计 Token

### 配色

| 语义 | 实际颜色 | 运行时变量 |
|---|---|---|
${colorRows}

正文使用 var(--ink)，辅助信息使用 var(--muted)；深色表面必须使用 var(--inverse)，浅色表面不得使用反色文字。强调数字、价格变化、冲突和风险时使用 var(--accent2)，并先检查实际背景对比度。

### 字体与间距

- 字体：正文 ${typography.family || 'sans'}；标题 ${typography.headingFamily || typography.family || 'sans'}。
- 字号档位：标题约 ${typography.h1Px || 32}px；小标题约 ${typography.h2Px || 13}px；正文参考 ${typography.bodyPx || 11}px；辅助文字参考 ${typography.captionPx || 10}px。最小字号和最终范围以 \`layout-guide.md\` 与 AI 视觉技能为准。
- 行高：${typography.lineHeight || 1.5}；字距：${typography.letterSpacingEm || 0}em。
- 主题 Token：内容边距 ${spacing.articlePaddingPx || 18}px；章节间距 ${spacing.sectionPx || 24}px；段落间距 ${spacing.paragraphPx || 12}px；卡片间距 ${spacing.cardGapPx || 12}px。
- AI 视觉页面仍以 8px 为基础网格，内容区建议使用 8px gap；主题 Token 是风格参考，不得造成溢出。

### 形状与效果

- 圆角：${shape.radiusPx || 18}px；边框：${shape.borderWidthPx || 1}px；阴影：${shape.shadow || 'soft'}。
- 主题视觉配方（仅影响外观，不是页面模板）：${json(visualRecipes)}
- 主题效果：${json(effects)}

### 组件级主题配置

以下配置决定组件的默认字体、字号档位、语义颜色和边框角色；具体内容仍由故事板事实决定：

${fence}json
${json(components)}
${fence}

## 页面结构边界

通用页面骨架、封面结构、页眉/内容区/底部导航、内容层数量、居中方式和画布尺寸由 AI 视觉生成技能内置的 \`xhs-visual-contract.md\` 与 \`layout-guide.md\` 统一定义。本主题不新增页面壳、插槽或页面角色模板；只提供本主题页眉类名、组件类名、Token 和装饰实现。生成完整 HTML 时保留通用结构，并使用本主题前缀类名承载主题样式。

## 组件视觉绑定

${componentSection(prefix)}

${decorationSection(theme)}

## 主题视觉应用

- 使用主题 Token、组件前缀和主题装饰为通用组件建立识别度；具体组件仍按事实语义选择，不机械重复同一种视觉处理。
- 使用 \`accent / accent2 / surface / inverse\` 形成强、中、弱三档信息层级：数字焦点使用主题强调色与放大字重，证据卡使用主题边框或状态底色，结论色块使用强调背景与匹配的反色文字。这里只定义视觉映射，不规定页面必须出现这些组件。
- 主题强调色、边框、圆角、投影和渐变只负责信息层级与氛围，不改变页面数量、页面角色、内容层数量或事实表达。

## 通用门禁引用

画布、安全区、字体范围、利用率、垂直居中、溢出/裁切/内部滚动和事实完整性由 AI 视觉技能、\`layout-guide.md\` 与 \`xhs-visual-contract.md\` 统一定义，本主题不重复声明。主题层只需确保其颜色语义、主题组件和装饰在这些通用门禁下仍保持可读、可见和不遮挡内容。

## 最小示例

${fence}html
<div class="${prefix}-feat-card">
  <div class="${prefix}-feat-icon">✦</div>
  <div class="${prefix}-feat-title">核心亮点</div>
  <div class="${prefix}-feat-body">这里放事实清单和故事板允许表达的一到两句内容。</div>
</div>
${fence}

该示例只说明主题类名和结构，不是固定页面模板；具体页面应根据 card-plan.json 的职责选择组件。\n`;
}

const files = fs.readdirSync(socialRoot).filter((name) => name.endsWith('.json')).sort();
for (const file of files) {
  const theme = JSON.parse(fs.readFileSync(path.join(socialRoot, file), 'utf8'));
  const directory = path.join(socialRoot, theme.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'AI_DESIGN_SPEC.md'), buildSpec(theme), 'utf8');
  console.log(`${theme.id}: AI_DESIGN_SPEC.md`);
}
