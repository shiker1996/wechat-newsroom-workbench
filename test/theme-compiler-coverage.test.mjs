import test from 'node:test';
import assert from 'node:assert/strict';
import { articleThemeDefinition, compileArticleTheme } from '../server/shared/themes/article-theme-compiler.mjs';
import { socialThemeDefinition, compileSocialTheme } from '../server/shared/themes/social-theme-compiler.mjs';
import { markdownToHtml } from '../server/features/articles/application/typeset-pipeline.mjs';

test('两类主题编译器输出统一的目标、变量、配方和消费映射',()=>{
  for(const compiled of [compileArticleTheme('magazine-warm'),compileSocialTheme('ice-blue')]){
    assert.ok(['article','social'].includes(compiled.target));
    assert.ok(compiled.variables?.colors&&compiled.variables?.typography&&compiled.variables?.spacing&&compiled.variables?.shape);
    assert.ok(compiled.recipes&&Object.keys(compiled.recipes).length);
    assert.ok(compiled.usageMap&&Object.keys(compiled.usageMap).length>=20);
  }
});

test('文章新增token进入正式内联HTML而不是只停留在Schema',()=>{
  const theme=structuredClone(articleThemeDefinition('gossip-card'));
  Object.assign(theme.tokens.colors,{surface:'#123456',accentSecondary:'#654321',line:'#ABCDEF',inverseText:'#FEDCBA',codeBackground:'#102030'});
  Object.assign(theme.tokens.typography,{h1Px:37,letterSpacingEm:.08});
  Object.assign(theme.tokens.spacing,{articlePaddingPx:21,cardGapPx:15});
  Object.assign(theme.tokens.shape,{radiusPx:7,borderWidthPx:2,shadow:'hard'});
  const html=markdownToHtml('# 标题\n\n## 章节\n\n> 引用内容\n\n`code`\n\n```js\nconst a=1\n```\n\n| A | B |\n|---|---|\n|1|2|',{themeDefinition:theme});
  for(const signature of ['padding:21px','font-size:37px','letter-spacing:0.08em','#123456','#654321','#ABCDEF','#FEDCBA','#102030','border:2px solid'])assert.match(html,new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('图文编译器消费完整字阶间距及四组历史空配方',()=>{
  const theme=structuredClone(socialThemeDefinition('brutalist'));
  Object.assign(theme.tokens.typography,{bodyPx:13,h1Px:39,h2Px:15,captionPx:10,lineHeight:1.7,letterSpacingEm:.06});
  Object.assign(theme.tokens.spacing,{articlePaddingPx:20,sectionPx:25,paragraphPx:9,cardGapPx:14});
  Object.assign(theme.social.recipes,{frame:'brutalist-frame',ending:'hard-fill',list:'hard-card',code:'hard-panel'});
  const compiled=compileSocialTheme(theme);
  for(const signature of ['--body-size:13px','--h1-size:39px','--h2-size:15px','--page-padding:20px','--card-gap:14px','brutalist-frame','hard-fill','hard-card','hard-panel'])assert.ok(compiled.css.includes(signature)||JSON.stringify(compiled.recipes).includes(signature),signature);
  for(const selector of ['.page-inner{padding:var(--page-padding)}','.page-ending .page-content-stack','.page li{background:var(--accent2)','.code-block pre{background:var(--code)'])assert.ok(compiled.css.includes(selector),selector);
});

test('代码块字号由独立 codePx 控制，缺省回退 captionPx',()=>{
  const withCodePx=structuredClone(socialThemeDefinition('brutalist'));
  withCodePx.tokens.typography.captionPx=9;
  withCodePx.tokens.typography.codePx=11;
  const compiled=compileSocialTheme(withCodePx);
  assert.ok(compiled.css.includes('--code-size:11px'),'codePx 应生成 --code-size');
  assert.ok(compiled.css.includes('.code-block code{font-size:var(--code-size)'),'代码块应使用 --code-size 而非 --caption-size');

  const legacy=structuredClone(socialThemeDefinition('brutalist'));
  legacy.tokens.typography.captionPx=9;
  delete legacy.tokens.typography.codePx;
  assert.ok(compileSocialTheme(legacy).css.includes('--code-size:9px'),'缺省 codePx 应回退 captionPx');

  const builtin=compileSocialTheme(socialThemeDefinition('retro-terminal'));
  assert.ok(builtin.css.includes('--code-size:11px'),'内置社交主题统一提升到 11px');
});
