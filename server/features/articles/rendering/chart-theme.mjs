import { articleThemeDefinition } from '../../../shared/themes/article-theme-compiler.mjs';

const DEFAULT_COLORS = {
  background:'#FFFFFF', surface:'#FFFFFF', text:'#202522', muted:'#6C736E',
  accent:'#C4473A', accentSecondary:'#D99A63', line:'#D8D3C9', inverseText:'#FFFFFF',
};

function clamp(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function fontStack(kind = 'sans') {
  if (kind === 'mono') return 'ui-monospace,"SFMono-Regular",Consolas,"Liberation Mono",monospace';
  if (kind === 'serif') return 'Georgia,"Noto Serif SC","Songti SC","Microsoft YaHei",serif';
  return '"Microsoft YaHei UI","PingFang SC","Noto Sans SC",sans-serif';
}

export function chartTheme(tokens = {}) {
  const colors = { ...DEFAULT_COLORS, ...(tokens.colors || {}) };
  const typography = tokens.typography || {};
  const shape = tokens.shape || {};
  const family = typography.family || 'sans';
  const headingFamily = typography.headingFamily || family;
  const palette = Array.isArray(tokens.chartPalette) && tokens.chartPalette.length
    ? tokens.chartPalette
    : [colors.accent, colors.accentSecondary, '#F2CC60', '#A371F7', '#F78166'];
  return {
    colors,
    palette,
    fontFamily:fontStack(family),
    headingFontFamily:fontStack(headingFamily),
    typography:{
      titlePx:clamp(typography.h2Px, 20, 16, 28),
      axisPx:clamp(Number(typography.bodyPx) - 2, 13, 11, 16),
      labelPx:clamp(Number(typography.bodyPx) - 1, 14, 11, 16),
      legendPx:clamp(typography.captionPx, 11, 10, 14),
      nodePx:clamp(Number(typography.bodyPx) - 2, 14, 11, 17),
    },
    shape:{
      radius:clamp(shape.radiusPx, 8, 0, 18),
      borderWidth:clamp(shape.borderWidthPx, 1, 1, 3),
    },
  };
}

function optionArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function labelLength(value) {
  return [...String(value ?? '')].reduce((total, char) => total + (/[\u3400-\u9fff]/u.test(char) ? 1 : .55), 0);
}

function axisLabels(option, axis) {
  return optionArray(option[axis]).flatMap((item) => Array.isArray(item?.data) ? item.data : [])
    .map((value) => typeof value === 'object' ? value?.value ?? value?.name : value).filter((value) => value !== undefined && value !== null);
}

function chartShapeDefaults(series, theme) {
  const types = new Set(series.map((item) => item?.type));
  const itemCount = Math.max(...series.map((item) => Array.isArray(item?.data) ? item.data.length : 0), 0);
  const shared = {
    label:{ color:theme.colors.text, fontFamily:theme.fontFamily, fontSize:theme.typography.labelPx },
  };
  if (types.has('bar')) {
    shared.barMaxWidth = 42;
    shared.itemStyle = { borderRadius:[theme.shape.radius, theme.shape.radius, 2, 2] };
    shared.barLabel = { show:itemCount > 0 && itemCount <= 8, position:'top', distance:8 };
  }
  if (types.has('line')) {
    shared.showSymbol = itemCount <= 12;
    shared.symbol = 'circle';
    shared.symbolSize = 9;
    shared.smooth = .25;
    shared.lineStyle = { width:3 };
    shared.areaStyle = { opacity:.1 };
  }
  if (types.has('pie')) {
    shared.radius = ['42%','70%'];
    shared.center = ['50%','52%'];
    shared.avoidLabelOverlap = true;
    shared.pieLabel = { show:true, color:theme.colors.text, fontFamily:theme.fontFamily, fontSize:theme.typography.labelPx };
    shared.pieLabelLine = { length:14, length2:10, lineStyle:{ color:theme.colors.muted } };
  }
  if (types.has('scatter')) shared.symbolSize = 12;
  if (types.has('radar')) shared.areaStyle = { opacity:.12 };
  return shared;
}

export function mermaidConfigForTheme(tokens = {}) {
  const theme = chartTheme(tokens);
  const formalTheme = Boolean(tokens.theme);
  const definition=tokens.theme?articleThemeDefinition(tokens.theme,{fallback:false}):null;
  const recipes=definition?.article?.recipes;
  const inverted=recipes?.h1==='invert-block';
  const terminal=recipes?.frame==='terminal-frame';
  const gossip=recipes?.frame==='gossip-frame';
  const explicitSurface = tokens.colors && Object.prototype.hasOwnProperty.call(tokens.colors, 'surface');
  const themeSurface = explicitSurface ? theme.colors.surface : (definition?.tokens?.colors?.surface || theme.colors.surface);
  const radius=gossip?14:terminal?3:definition?.tokens?.shape?.radiusPx||0;
  const surface = definition ? {
    fill:inverted?theme.colors.text:themeSurface,
    text:inverted?theme.colors.background:theme.colors.text,
      css:`.node rect,.node polygon,.node circle{rx:${radius}px;ry:${radius}px${gossip?';filter:drop-shadow(0 5px 7px rgba(31,41,55,.16))':''}}\n.node .label,.nodeLabel{font-family:${theme.fontFamily};font-size:${theme.typography.nodePx}px}\n.node.aiFocus rect,.node.aiFocus polygon,.node.aiFocus circle{stroke-width:3px}\n.node.aiFocus .label{font-weight:700}`,
  } : {
    fill:formalTheme ? theme.colors.text : theme.colors.background,
    text:formalTheme ? theme.colors.background : theme.colors.text,
    css:`.node rect,.node polygon,.node circle{rx:${radius}px;ry:${radius}px}\n.node .label,.nodeLabel{font-family:${theme.fontFamily};font-size:${theme.typography.nodePx}px}\n.node.aiFocus rect,.node.aiFocus polygon,.node.aiFocus circle{stroke-width:3px}\n.node.aiFocus .label{font-weight:700}`,
  };
  return {
    theme:'base',
    themeCSS:`${surface.css}\n.edgePath .path{stroke:${theme.colors.muted};stroke-width:1.8px}\n.arrowheadPath{fill:${theme.colors.accent}}\n.edgeLabel{color:${theme.colors.text}}\n.edgeLabel .label,.edgeLabel{font-family:${theme.fontFamily};font-size:${theme.typography.legendPx}px}\n.edgeLabel rect{fill:${themeSurface};rx:${Math.max(3, radius / 2)}px;ry:${Math.max(3, radius / 2)}px;opacity:.96}\n.cluster rect{fill:${themeSurface};stroke:${theme.colors.line};stroke-width:${theme.shape.borderWidth}px;rx:${radius}px;ry:${radius}px}\n.cluster-label .nodeLabel{font-family:${theme.headingFontFamily};font-weight:700}`,
    themeVariables:{
      background:theme.colors.background, primaryColor:surface.fill, primaryTextColor:surface.text,
      primaryBorderColor:theme.colors.accent, lineColor:theme.colors.muted, textColor:theme.colors.text,
      nodeBorder:theme.colors.accent, mainBkg:surface.fill, clusterBkg:themeSurface, clusterBorder:theme.colors.line,
      edgeLabelBackground:themeSurface,
      secondaryColor:theme.colors.accentSecondary, secondaryTextColor:theme.colors.inverseText,
      secondaryBorderColor:theme.colors.accent, tertiaryColor:theme.colors.background,
      fontFamily:theme.fontFamily, fontSize:`${theme.typography.nodePx}px`,
    },
    flowchart:{ curve:'basis', nodeSpacing:38, rankSpacing:50, padding:12, htmlLabels:true },
  };
}

export function mermaidSourceWithTheme(source, tokens = {}) {
  if (/^\s*%%\{init:/i.test(source)) return source;
  const init = mermaidConfigForTheme(tokens);
  return `%%{init: ${JSON.stringify(init)} }%%\n${source.trim()}`;
}

function merge(base, override) {
  if (!base || typeof base !== 'object' || Array.isArray(base)) return override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(base[key] || {}, value) : value;
  }
  return result;
}

export function echartsOptionWithTheme(option, tokens = {}) {
  const theme = chartTheme(tokens);
  const sourceSeries = Array.isArray(option?.series) ? option.series : [];
  const xLabels = axisLabels(option || {}, 'xAxis');
  const yLabels = axisLabels(option || {}, 'yAxis');
  const maxYLabel = Math.max(...yLabels.map(labelLength), 0);
  const maxXLabel = Math.max(...xLabels.map(labelLength), 0);
  const hasPie = sourceSeries.some((item) => item?.type === 'pie');
  const hasSingleSeries = sourceSeries.length <= 1;
  const shape = chartShapeDefaults(sourceSeries, theme);
  const themed = merge({
    backgroundColor:theme.colors.background, color:theme.palette, animation:false,
    textStyle:{ fontFamily:theme.fontFamily, color:theme.colors.text, fontSize:theme.typography.labelPx },
    title:{ left:'left', top:20, textStyle:{ fontFamily:theme.headingFontFamily, fontSize:theme.typography.titlePx, fontWeight:700, color:theme.colors.text }, subtextStyle:{ fontFamily:theme.fontFamily, fontSize:theme.typography.legendPx, color:theme.colors.muted } },
    grid:{ left:Math.max(64, Math.min(156, Math.round(38 + maxYLabel * 13))), right:34, top:82, bottom:maxXLabel > 6 ? 82 : 62, containLabel:true },
    legend:{ show:!hasSingleSeries && !hasPie, bottom:12, itemWidth:14, itemHeight:8, itemGap:16, textStyle:{ fontFamily:theme.fontFamily, fontSize:theme.typography.legendPx, color:theme.colors.muted } },
    tooltip:{ trigger:hasPie ? 'item' : 'axis', backgroundColor:theme.colors.surface, borderColor:theme.colors.line, borderWidth:theme.shape.borderWidth, textStyle:{ fontFamily:theme.fontFamily, color:theme.colors.text } },
    xAxis:{ axisLine:{ lineStyle:{ color:theme.colors.line, width:theme.shape.borderWidth } }, axisTick:{ show:false }, axisLabel:{ color:theme.colors.muted, fontFamily:theme.fontFamily, fontSize:theme.typography.axisPx, margin:14, interval:'auto', rotate:maxXLabel > 8 ? 24 : 0 }, splitLine:{ show:false, lineStyle:{ color:theme.colors.line, type:'dashed' } } },
    yAxis:{ axisLine:{ show:false }, axisTick:{ show:false }, axisLabel:{ color:theme.colors.muted, fontFamily:theme.fontFamily, fontSize:theme.typography.axisPx, margin:12 }, splitLine:{ lineStyle:{ color:theme.colors.line, type:'dashed', opacity:.7 } } },
  }, option);
  if (Array.isArray(themed.series)) {
    themed.series = themed.series.map((series, index) => ({
      ...series,
      ...(series.type === 'bar' ? { barMaxWidth:series.barMaxWidth ?? shape.barMaxWidth, label:{ ...shape.barLabel, ...(series.label || {}) }, itemStyle:{ ...shape.itemStyle, ...(series.itemStyle || {}) } } : {}),
      ...(series.type === 'line' ? { showSymbol:series.showSymbol ?? shape.showSymbol, symbol:series.symbol ?? shape.symbol, symbolSize:series.symbolSize ?? shape.symbolSize, smooth:series.smooth ?? shape.smooth, lineStyle:{ ...shape.lineStyle, ...(series.lineStyle || {}) }, areaStyle:series.areaStyle ?? shape.areaStyle, itemStyle:{ borderColor:theme.colors.background, borderWidth:2, ...(series.itemStyle || {}) } } : {}),
      ...(series.type === 'pie' ? { radius:series.radius ?? shape.radius, center:series.center ?? shape.center, avoidLabelOverlap:series.avoidLabelOverlap ?? shape.avoidLabelOverlap, label:{ ...shape.pieLabel, ...(series.label || {}) }, labelLine:{ ...shape.pieLabelLine, ...(series.labelLine || {}) } } : {}),
      ...(series.type === 'scatter' ? { symbolSize:series.symbolSize ?? shape.symbolSize } : {}),
      ...(series.type === 'radar' ? { areaStyle:series.areaStyle ?? shape.areaStyle } : {}),
      itemStyle:{ ...(series.type === 'bar' ? (shape.itemStyle || {}) : {}), ...(series.itemStyle || {}), ...(tokens.theme || !series.itemStyle?.color ? { color:theme.palette[index % theme.palette.length] } : {}) },
      lineStyle:{ ...(series.type === 'line' ? (shape.lineStyle || {}) : {}), ...(series.lineStyle || {}), ...(tokens.theme || !series.lineStyle?.color ? { color:theme.palette[index % theme.palette.length] } : {}) },
    }));
  }
  return themed;
}
