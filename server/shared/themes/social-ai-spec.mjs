import fs from 'node:fs';
import path from 'node:path';

export function loadSocialAiDesignSpec({ workspaceRoot = process.cwd(), theme } = {}) {
  if (!theme?.id) throw new TypeError('缺少图文主题，无法加载 AI 设计规范');
  // 用户主题以数据库中的当前定义为准，不依赖内置主题目录或复制源的旧配色。
  if (theme.source === 'user') {
    const { colors = {}, typography = {}, shape = {} } = theme.tokens || {};
    const { recipes = {}, effects = {}, components = {} } = theme.social || {};
    const text = `# ${theme.label || theme.id} · Social AI Design Spec

> 主题 ID：${theme.id} · 版本：${theme.version || ''}

## 主题定位

${theme.description || '以当前主题配色、字体、形状和组件处理建立视觉识别。'}
${(theme.tags || []).join('、')}

## 设计 Token

配色以以下语义色为准；深色表面搭配 inverseText，文字须保持可读对比度。
${JSON.stringify(colors, null, 2)}

正文采用 ${typography.family || 'sans'}；标题采用 ${typography.headingFamily || typography.family || 'sans'}。
形状与效果：${JSON.stringify({ shape, effects }, null, 2)}

## 语义组件配方

${JSON.stringify(recipes, null, 2)}

## 组件级主题配置

${JSON.stringify(components, null, 2)}

## 构图与边界

以上配置提供主题视觉方向。字号、行高、页面构图与留白遵循 AI 视觉技能的 Layout Guide，并根据故事板事实与页面职责决定；不要机械复刻固定模板。
装饰不得遮挡正文，不新增事实、数字或结论；不得通过裁切、内部滚动或透明文字隐藏溢出。
`;
    return { text, source: 'theme-definition', path: '', themeId: theme.id };
  }
  const file = path.join(workspaceRoot, 'themes', 'social', theme.id, 'AI_DESIGN_SPEC.md');
  if (!fs.existsSync(file)) throw new Error(`AI 视觉生成缺少主题设计规范：${theme.id}/AI_DESIGN_SPEC.md`);
  return { text: fs.readFileSync(file, 'utf8'), source: 'file', path: file, themeId: theme.id };
}
