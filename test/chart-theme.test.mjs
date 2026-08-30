import test from 'node:test';
import assert from 'node:assert/strict';
import { echartsOptionWithTheme, mermaidConfigForTheme, mermaidSourceWithTheme } from '../server/features/articles/rendering/chart-theme.mjs';

test('Mermaid receives article design colors without replacing explicit init', () => {
  const themed = mermaidSourceWithTheme('flowchart TB\nA-->B', { colors:{ accent:'#123456', background:'#FAFAFA' } });
  assert.match(themed, /"primaryBorderColor":"#123456"/);
  assert.match(themed, /flowchart TB/);
  assert.equal(mermaidSourceWithTheme('%%{init: {"theme":"dark"} }%%\nflowchart LR\nA-->B'), '%%{init: {"theme":"dark"} }%%\nflowchart LR\nA-->B');
});

test('formal typeset theme gives Mermaid a distinctive surface treatment', () => {
  const config = mermaidConfigForTheme({ theme:'news-digest', colors:{ background:'#FFFFFF', text:'#111111', accent:'#D61F26' } });
  assert.equal(config.themeVariables.primaryColor, '#111111');
  assert.equal(config.themeVariables.primaryTextColor, '#FFFFFF');
  assert.equal(config.themeVariables.primaryBorderColor, '#D61F26');
});

test('gossip-card Mermaid uses light rounded cards instead of the news dark nodes', () => {
  const config = mermaidConfigForTheme({ theme:'gossip-card', colors:{ background:'#FFFFFF', text:'#1F2937', accent:'#FF6B35' } });
  assert.equal(config.themeVariables.primaryColor, '#FFF1E8');
  assert.equal(config.themeVariables.primaryTextColor, '#1F2937');
  assert.match(config.themeCSS, /rx:14px/);
  assert.match(config.themeCSS, /drop-shadow/);
});

test('Mermaid edge labels keep readable contrast against the page background', () => {
  const config = mermaidConfigForTheme({ colors:{ background:'#FFFFFF', text:'#1A1A1A', accent:'#D61F26' } });
  assert.equal(config.themeVariables.edgeLabelBackground, '#FFFFFF');
  assert.match(config.themeCSS, /\.edgeLabel\{color:#1A1A1A\}/);
});

test('ECharts inherits theme defaults while article option keeps priority', () => {
  const option = echartsOptionWithTheme({ title:{ text:'数据' }, grid:{ left:80 }, series:[{type:'bar',data:[1]}] }, { colors:{ accent:'#123456' } });
  assert.equal(option.color[0], '#123456');
  assert.equal(option.title.text, '数据');
  assert.equal(option.title.left, 'left');
  assert.equal(option.grid.left, 80);
  assert.equal(option.animation, false);
});

test('formal typeset theme overrides ECharts presentation colors but keeps data', () => {
  const option = echartsOptionWithTheme({
    series:[{ type:'bar', data:[1, 2], itemStyle:{ color:'#C4473A' } }],
  }, { theme:'news-digest', colors:{ accent:'#D61F26', background:'#FFFFFF', text:'#111111' } });
  assert.equal(option.series[0].itemStyle.color, '#D61F26');
  assert.deepEqual(option.series[0].data, [1, 2]);
});

test('ECharts article presets improve labels and chart-type hierarchy', () => {
  const option = echartsOptionWithTheme({
    xAxis:{ data:['第一个特别长的横轴标签','第二个特别长的横轴标签'] },
    yAxis:{ data:[] },
    series:[{ type:'line', data:[12, 18] }],
  }, { colors:{ background:'#F5EFE3', text:'#30261F', muted:'#786F66', accent:'#76533B', line:'#D8CDBF' } });
  assert.equal(option.legend.show, false);
  assert.equal(option.grid.bottom, 82);
  assert.equal(option.series[0].smooth, .25);
  assert.equal(option.series[0].lineStyle.width, 3);
  assert.equal(option.xAxis.axisLabel.rotate, 24);
  assert.equal(option.xAxis.axisTick.show, false);
  assert.equal(option.series[0].symbol, 'circle');
});
