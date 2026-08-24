import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';
import { AI_THEME_ERROR_CODES, AiThemeContractError, composeAiThemeDefinition, validateAiThemeCandidate, validateAiThemeRequest } from '../server/shared/themes/ai-theme-contract.mjs';

const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/ai-theme-contract-cases.json',import.meta.url),'utf8'));
const registry=getBuiltinThemeRegistry();

function candidateFrom(definition){
  const target=definition.targets[0];
  return {label:definition.label,description:definition.description,tags:definition.tags,tokens:structuredClone(definition.tokens),targetConfig:structuredClone(definition[target]),designSummary:[{title:'视觉方向',description:'使用受控主题字段形成清晰、稳定的阅读层级'}]};
}

test('阶段 0 基线同时覆盖文章和图文 AI 创建请求',()=>{
  assert.deepEqual(baseline.requests.map(({input})=>validateAiThemeRequest(input).target),baseline.expectations.targets);
  assert.equal(baseline.expectations.persistBeforeConfirmation,false);
  assert.equal(baseline.expectations.forbidArbitraryCode,true);
});

test('AI 请求拒绝未知偏好、短提示和非法枚举',()=>{
  assert.throws(()=>validateAiThemeRequest({target:'article',prompt:'太短',preferences:{tone:['luxury'],rawCss:'body{}'}}),(error)=>error instanceof AiThemeContractError&&error.code===AI_THEME_ERROR_CODES.INPUT_INVALID&&error.issues.some((item)=>item.field==='preferences.rawCss'));
});

test('系统字段只能由服务端补齐且模型越权时明确拒绝',()=>{
  const candidate=candidateFrom(registry.get('magazine-warm'));
  candidate.status='published';candidate.id='model-owned-id';
  assert.throws(()=>validateAiThemeCandidate(candidate,{target:'article'}),(error)=>error.code===AI_THEME_ERROR_CODES.SYSTEM_FIELD_FORBIDDEN&&error.issues.some((item)=>item.field==='status'));
});

test('文章候选组合为完整用户草稿且系统字段不可由候选决定',()=>{
  const candidate=candidateFrom(registry.get('magazine-warm'));
  const result=composeAiThemeDefinition(candidate,{target:'article',id:'ai-warm-editorial'});
  assert.equal(result.definition.id,'ai-warm-editorial');
  assert.equal(result.definition.status,'draft');
  assert.equal(result.definition.source,'user');
  assert.equal(result.definition.version,'0.1.0');
  assert.deepEqual(result.definition.targets,['article']);
  assert.equal(result.definition.basedOn,null);
  assert.ok(result.definition.article);
  assert.equal(result.definition.social,undefined);
});

test('图文候选只能进入 social 配置并通过现有主题契约',()=>{
  const candidate=candidateFrom(registry.get('ice-blue'));
  const result=composeAiThemeDefinition(candidate,{target:'social',id:'ai-clear-cards'});
  assert.ok(result.definition.social);
  assert.equal(result.definition.article,undefined);
  assert.equal(result.designSummary.length,1);
});

test('候选拒绝任意代码文本、未知字段和非法配方',()=>{
  const unsafe=candidateFrom(registry.get('magazine-warm'));unsafe.description='<style>body{color:red}</style>';
  assert.throws(()=>validateAiThemeCandidate(unsafe,{target:'article'}),(error)=>error.code===AI_THEME_ERROR_CODES.OUTPUT_UNSAFE);
  const unknown=candidateFrom(registry.get('magazine-warm'));unknown.rawCss='body{}';
  assert.throws(()=>validateAiThemeCandidate(unknown,{target:'article'}),(error)=>error.code===AI_THEME_ERROR_CODES.OUTPUT_INVALID&&error.issues.some((item)=>item.field==='rawCss'));
  const recipe=candidateFrom(registry.get('magazine-warm'));recipe.targetConfig.recipes.quote='model-invented-card';
  assert.throws(()=>composeAiThemeDefinition(recipe,{target:'article',id:'bad-recipe'}),(error)=>error.code===AI_THEME_ERROR_CODES.OUTPUT_INVALID&&error.issues.some((item)=>item.field==='article.recipes.quote'));
});
