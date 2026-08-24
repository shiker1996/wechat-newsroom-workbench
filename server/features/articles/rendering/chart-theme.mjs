import { articleThemeDefinition } from '../../../shared/themes/article-theme-compiler.mjs';

const DEFAULT_COLORS = { background:'#FFFFFF', text:'#202522', muted:'#6C736E', accent:'#C4473A' };

export function chartTheme(tokens = {}) {
  const colors = { ...DEFAULT_COLORS, ...(tokens.colors || {}) };
  return {
    colors,
    palette:[colors.accent, colors.accentSecondary||'#D99A63', colors.muted||'#55756B', colors.line||'#7D8790', colors.surface||'#D1BFA7'],
    fontFamily:"'PingFang SC','Microsoft YaHei',sans-serif",
  };
}

export function mermaidConfigForTheme(tokens = {}) {
  const theme = chartTheme(tokens);
  const formalTheme = Boolean(tokens.theme);
  const definition=tokens.theme?articleThemeDefinition(tokens.theme,{fallback:false}):null;
  const recipes=definition?.article?.recipes;
  const inverted=recipes?.h1==='invert-block';
  const terminal=recipes?.frame==='terminal-frame';
  const gossip=recipes?.frame==='gossip-frame';
  const radius=gossip?14:terminal?3:definition?.tokens?.shape?.radiusPx||0;
  const surface = definition ? {
    fill:inverted?theme.colors.text:(theme.colors.surface||definition.tokens.colors.surface),
    text:inverted?theme.colors.background:theme.colors.text,
    css:`.node rect{rx:${radius}px;ry:${radius}px${gossip?';filter:drop-shadow(0 5px 7px rgba(31,41,55,.16))':''}}`,
  } : {
    fill:formalTheme ? theme.colors.text : theme.colors.background,
    text:formalTheme ? theme.colors.background : theme.colors.text,
    css:'',
  };
  return {
    theme:'base',
    themeCSS:`${surface.css}\n.edgeLabel{color:${theme.colors.text}}`,
    themeVariables:{
      background:theme.colors.background, primaryColor:surface.fill, primaryTextColor:surface.text,
      primaryBorderColor:theme.colors.accent, lineColor:theme.colors.muted,
      edgeLabelBackground:theme.colors.background,
      secondaryColor:theme.colors.accent, secondaryTextColor:'#FFFFFF',
      secondaryBorderColor:theme.colors.accent, tertiaryColor:theme.colors.background,
      fontFamily:theme.fontFamily, fontSize:'16px',
    },
    flowchart:{ curve:'basis', nodeSpacing:34, rankSpacing:44, htmlLabels:true },
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
  const themed = merge({
    backgroundColor:theme.colors.background, color:theme.palette, animation:false,
    textStyle:{ fontFamily:theme.fontFamily, color:theme.colors.text },
    title:{ left:'center', textStyle:{ fontSize:20, fontWeight:700, color:theme.colors.text } },
    grid:{ left:48, right:24, top:72, bottom:48, containLabel:true },
    legend:{ bottom:8, textStyle:{ color:theme.colors.muted } },
    xAxis:{ axisLine:{ lineStyle:{ color:theme.colors.muted } }, splitLine:{ lineStyle:{ color:'#E7E4DD', type:'dashed' } } },
    yAxis:{ axisLine:{ lineStyle:{ color:theme.colors.muted } }, splitLine:{ lineStyle:{ color:'#E7E4DD', type:'dashed' } } },
  }, option);
  if (tokens.theme && Array.isArray(themed.series)) {
    themed.series = themed.series.map((series, index) => ({
      ...series,
      itemStyle:{ ...(series.itemStyle || {}), color:theme.palette[index % theme.palette.length] },
      lineStyle:{ ...(series.lineStyle || {}), color:theme.palette[index % theme.palette.length] },
    }));
  }
  return themed;
}
