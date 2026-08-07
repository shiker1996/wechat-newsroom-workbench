import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createThemeRegistry, getBuiltinThemeRegistry, normalizedThemeJson, themeHash } from '../lib/themes/theme-registry.mjs';
import { loadThemeDirectory } from '../lib/themes/theme-loader.mjs';
import { colorContrast, ThemeValidationError, validateThemeDefinition } from '../lib/themes/theme-validator.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const baseline=JSON.parse(fs.readFileSync(path.join(here,'fixtures','theme-baseline.json'),'utf8'));

function validTheme(overrides={}){
  return {
    schemaVersion:1,id:'test-theme',label:'测试主题',version:'1.0.0',description:'用于验证主题注册中心的合法测试主题。',targets:['article'],status:'published',source:'builtin',basedOn:null,tags:['test'],
    tokens:{colors:{background:'#FFFFFF',surface:'#F5F5F5',text:'#111111',muted:'#666666',accent:'#C4473A',accentSecondary:'#76533B',line:'#DDDDDD',inverseText:'#FFFFFF',codeBackground:'#111111'},typography:{family:'sans',headingFamily:'serif',bodyPx:16,h1Px:30,h2Px:22,captionPx:13,lineHeight:1.8,letterSpacingEm:.02},spacing:{articlePaddingPx:18,sectionPx:30,paragraphPx:16,cardGapPx:12},shape:{radiusPx:8,borderWidthPx:1,shadow:'none'}},
    article:{recipes:{frame:'warm-frame',kicker:'chip',h1:'editorial-serif',h2:'numbered-rule',lead:'rule-bottom',quote:'warm-card',divider:'ornament',list:'default',table:'tinted-header',image:'plain'},behavior:{justify:true,highlightStrong:'accent',numberSections:true}},
    ...overrides,
  };
}

test('阶段 1 内置主题注册中心加载 6 个文章主题、14 个图文主题和 5 个封面主题', () => {
  const registry=getBuiltinThemeRegistry();
  assert.equal(registry.list().length,25);
  assert.deepEqual(new Set(registry.list({target:'article'}).map((item)=>item.id)),new Set(baseline.article.themes.map((item)=>item.id)));
  assert.deepEqual(new Set(registry.list({target:'social'}).map((item)=>item.id)),new Set(baseline.social.themes.map((item)=>item.id)));
  assert.deepEqual(new Set(registry.list({target:'cover'}).map((item)=>item.id)),new Set(['cover-navy-gold','cover-split-navy','cover-editorial-red','cover-forest-cream','cover-graphite-neon']));
  for(const theme of registry.list()){
    assert.match(theme.hash,/^sha256:[0-9a-f]{64}$/);
    assert.equal(theme.source,'builtin');
    assert.equal(theme.status,'published');
    assert.ok(Object.isFrozen(theme));
    assert.ok(theme.file.startsWith(path.join(root,'themes')));
  }
});

test('阶段 1 注册中心提供稳定查询语义并拒绝未知主题', () => {
  const registry=getBuiltinThemeRegistry();
  assert.equal(registry.get('ice-blue').label,'冰川冷调');
  assert.equal(registry.get('missing-theme'),null);
  assert.equal(registry.has('tech-wire'),true);
  assert.throws(()=>registry.require('missing-theme'),/未知主题/);
  assert.equal(registry.list({target:'article',status:null}).length,6);
});

test('阶段 1 主题哈希不受对象键顺序影响且忽略加载器内部字段', () => {
  const theme=validTheme();
  const reversed=Object.fromEntries(Object.entries(theme).reverse());
  assert.equal(normalizedThemeJson(theme),normalizedThemeJson(reversed));
  assert.equal(themeHash(theme),themeHash({...reversed,_file:'ignored.json'}));
});

test('阶段 1 校验器拒绝未知 Schema、未知字段、非法配方与越界值', () => {
  const cases=[
    [{...validTheme(),schemaVersion:2},'UNSUPPORTED_SCHEMA'],
    [{...validTheme(),rawCss:'.page{}'},'UNKNOWN_FIELD'],
    [{...validTheme(),article:{...validTheme().article,recipes:{...validTheme().article.recipes,h1:'raw-css'}}},'ENUM'],
    [{...validTheme(),tokens:{...validTheme().tokens,shape:{...validTheme().tokens.shape,radiusPx:999}}},'OUT_OF_RANGE'],
    [{...validTheme(),targets:['social'],article:undefined,social:{recipes:{surface:'base',frame:'soft-orbit',decoration:'orbit',eyebrow:'accent',ending:'dark-fill',list:'soft-card',code:'dark-panel'},effects:{texture:'none',decorationOpacity:.2,contentTiltDeg:0,rawCss:'.page{}'}}},'UNKNOWN_FIELD'],
  ];
  for(const [definition,code] of cases){
    assert.throws(()=>validateThemeDefinition(definition),(error)=>error instanceof ThemeValidationError&&error.issues.some((item)=>item.code===code));
  }
});

test('阶段 1 校验器阻止正文与背景低对比度主题发布', () => {
  const tokens={...validTheme().tokens,colors:{...validTheme().tokens.colors,text:'#777777',background:'#888888'}};
  assert.ok(colorContrast('#111111','#FFFFFF')>=4.5);
  assert.throws(()=>validateThemeDefinition({...validTheme(),tokens}),(error)=>error.issues.some((item)=>item.code==='LOW_CONTRAST'));
});

test('阶段 1 加载器拒绝文件名与 ID 不一致、目标目录错配和重复 ID', (t) => {
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'theme-registry-'));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  fs.mkdirSync(path.join(temporary,'article'),{recursive:true});fs.mkdirSync(path.join(temporary,'social'),{recursive:true});
  fs.writeFileSync(path.join(temporary,'article','wrong-name.json'),JSON.stringify(validTheme()),'utf8');
  assert.throws(()=>loadThemeDirectory(temporary),/文件名必须/);
  fs.renameSync(path.join(temporary,'article','wrong-name.json'),path.join(temporary,'article','test-theme.json'));
  const social={...validTheme(),targets:['social'],social:{recipes:{surface:'base',frame:'soft-orbit',decoration:'orbit',eyebrow:'accent',ending:'dark-fill',list:'soft-card',code:'dark-panel'},effects:{texture:'none',decorationOpacity:.2,contentTiltDeg:0} }};delete social.article;
  fs.writeFileSync(path.join(temporary,'social','test-theme.json'),JSON.stringify(social),'utf8');
  assert.throws(()=>createThemeRegistry({builtinRoot:temporary}),/主题 ID 重复/);
  fs.writeFileSync(path.join(temporary,'social','test-theme.json'),JSON.stringify({...social,targets:['article']}),'utf8');
  assert.throws(()=>loadThemeDirectory(temporary),/目录要求包含 social/);
});

test('阶段 1 仓库中的 JSON Schema 明确拒绝额外字段并约束安全颜色格式', () => {
  const schema=JSON.parse(fs.readFileSync(path.join(root,'themes','schema','theme.schema.json'),'utf8'));
  assert.equal(schema.additionalProperties,false);
  assert.equal(schema.properties.tokens.additionalProperties,false);
  assert.equal(schema.$defs.color.pattern,'^#[0-9A-Fa-f]{6}$');
});
