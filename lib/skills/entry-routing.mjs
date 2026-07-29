import { SkillRegistry } from './registry.mjs';
import { readSkillPackageCatalog } from './package-manager.mjs';
import { resolveSkillToolPolicy } from './pipeline-runtime.mjs';

export const CREATION_ENTRY_CONTRACTS = Object.freeze({
  'hotspot-article': {
    outputContract:'wechat_markdown',
    inputContracts:['article_fact_base'],
  },
  'independent-writing': {
    outputContract:'wechat_markdown',
    inputContractsByContentType:{
      experience:['personal_fact_base'],
      tutorial:['tutorial_fact_base'],
    },
  },
});

export const ARTICLE_STAGE_SKILL_SLOTS=Object.freeze([
  {id:'title',name:'标题生成',kind:'title',inputContract:'article_fact_base',outputContract:'title_candidates',defaultSkillId:'title-generator'},
  {id:'reviewer',name:'审稿与质量门禁',kind:'reviewer',inputContract:'article_fact_base',outputContract:'reviewed_markdown',defaultSkillId:'article-reviewer'},
  {id:'humanizer',name:'表达自然化',kind:'humanizer',inputContract:'wechat_markdown',outputContract:'wechat_markdown',defaultSkillId:'humanizer-zh'},
  {id:'seo',name:'SEO 内容优化',kind:'seo',inputContract:'reviewed_markdown',outputContract:'wechat_markdown',defaultSkillId:'seo-content-optimizer'},
]);

function compatibleContracts(skill, entryPoint, contentType='') {
  const contract=CREATION_ENTRY_CONTRACTS[entryPoint];
  if(!contract)return {ok:false,reason:'未知创作入口'};
  const expectedInputs=contract.inputContractsByContentType?.[contentType] || contract.inputContracts || [];
  if(contract.outputContract&&skill.outputContract!==contract.outputContract){
    return {ok:false,reason:`输出契约应为 ${contract.outputContract}`};
  }
  if(expectedInputs.length&&!expectedInputs.includes(skill.inputContract)){
    return {ok:false,reason:`输入契约应为 ${expectedInputs.join(' 或 ')}`};
  }
  if(skill.kind!=='writer')return {ok:false,reason:'当前入口只接受主写技能'};
  return {ok:true,reason:''};
}

export async function listEntryWriterSkills({workspaceRoot,entryPoint,contentType='',recommendedSkillId=''}) {
  const catalog=readSkillPackageCatalog(workspaceRoot);
  const skills=new SkillRegistry({workspaceRoot}).list().filter((skill)=>
    skill.entryPoints.includes(entryPoint)&&(!contentType||!skill.contentTypes.length||skill.contentTypes.includes(contentType)));
  const items=await Promise.all(skills.map(async(skill)=>{
    const contract=compatibleContracts(skill,entryPoint,contentType);
    let missingCapabilities=[];
    let policyError='';
    if(skill.enabled&&contract.ok){
      try{
        const policy=await resolveSkillToolPolicy({workspaceRoot,skillId:skill.id});
        const available=new Set(policy.tools.map((item)=>item.capability));
        missingCapabilities=skill.requiredCapabilities.filter((capability)=>!available.has(capability));
      }catch(error){policyError=error.message;}
    }
    const available=skill.enabled&&contract.ok&&!policyError&&!missingCapabilities.length;
    return {
      id:skill.id,name:skill.name,description:skill.description,kind:skill.kind,
      contentTypes:skill.contentTypes,inputContract:skill.inputContract,outputContract:skill.outputContract,
      requiredCapabilities:skill.requiredCapabilities,optionalCapabilities:skill.optionalCapabilities,
      source:skill.source,thirdParty:skill.thirdParty,enabled:skill.enabled,available,
      missingCapabilities,
      unavailableReason:!skill.enabled?'技能未启用':!contract.ok?contract.reason:policyError||(
        missingCapabilities.length?`缺少必需工具：${missingCapabilities.join('、')}`:''),
      isDefault:catalog.entryDefaults[entryPoint]===skill.id,
      isRecommended:recommendedSkillId===skill.id,
    };
  }));
  return {
    entryPoint,contentType,defaultSkillId:catalog.entryDefaults[entryPoint]||'',
    recommendedSkillId,
    items:items.sort((a,b)=>Number(b.available)-Number(a.available)||Number(b.isDefault)-Number(a.isDefault)
      ||Number(b.isRecommended)-Number(a.isRecommended)||a.name.localeCompare(b.name,'zh-CN')),
  };
}

export async function resolveEntryWriterSkill({
  workspaceRoot,entryPoint,contentType='',requestedSkillId='',recommendedSkillId,
}) {
  const result=await listEntryWriterSkills({workspaceRoot,entryPoint,contentType,recommendedSkillId});
  const byId=new Map(result.items.map((item)=>[item.id,item]));
  const requested=String(requestedSkillId||'').trim();
  if(requested){
    const item=byId.get(requested);
    if(!item)throw new Error('所选写作技能不兼容当前创作入口或文章类型');
    if(!item.available)throw new Error(`所选写作技能不可用：${item.unavailableReason}`);
    return {requestedSkill:requested,selectedSkill:item.id,selectionSource:'user',item};
  }
  const candidates=[
    [result.defaultSkillId,'workspace-default'],
    [recommendedSkillId,'builtin-recommendation'],
  ];
  for(const [skillId,source] of candidates){
    const item=byId.get(skillId);
    if(item?.available)return {requestedSkill:'',selectedSkill:item.id,selectionSource:source,item};
  }
  const fallback=result.items.find((item)=>item.available&&!item.thirdParty) || result.items.find((item)=>item.available);
  if(!fallback)throw new Error('当前创作入口没有可用的主写技能');
  return {requestedSkill:'',selectedSkill:fallback.id,selectionSource:'builtin-fallback',item:fallback};
}

export async function listArticleStageSkillSlots({workspaceRoot,entryPoint='hotspot-article'}){
  const skills=new SkillRegistry({workspaceRoot}).list();
  const slots=await Promise.all(ARTICLE_STAGE_SKILL_SLOTS.map(async(slot)=>{
    const candidates=skills.filter((skill)=>skill.entryPoints.includes(entryPoint)&&skill.kind===slot.kind
      &&skill.inputContract===slot.inputContract&&skill.outputContract===slot.outputContract);
    const items=await Promise.all(candidates.map(async(skill)=>{
      let missingCapabilities=[],policyError='';
      if(skill.enabled){
        try{
          const policy=await resolveSkillToolPolicy({workspaceRoot,skillId:skill.id});
          const available=new Set(policy.tools.map((item)=>item.capability));
          missingCapabilities=skill.requiredCapabilities.filter((capability)=>!available.has(capability));
        }catch(error){policyError=error.message;}
      }
      const available=skill.enabled&&!policyError&&!missingCapabilities.length;
      return {id:skill.id,name:skill.name,description:skill.description,thirdParty:skill.thirdParty,
        requiredCapabilities:skill.requiredCapabilities,available,missingCapabilities,
        unavailableReason:!skill.enabled?'技能未启用':policyError||(missingCapabilities.length?`缺少必需工具：${missingCapabilities.join('、')}`:''),
        isDefault:skill.id===slot.defaultSkillId};
    }));
    return {...slot,items:items.sort((a,b)=>Number(b.available)-Number(a.available)||Number(b.isDefault)-Number(a.isDefault)||a.name.localeCompare(b.name,'zh-CN'))};
  }));
  return {entryPoint,slots};
}

export async function resolveArticleStageSkills({workspaceRoot,entryPoint='hotspot-article',requested={}}){
  const result=await listArticleStageSkillSlots({workspaceRoot,entryPoint});
  const selections={};
  for(const slot of result.slots){
    const requestedSkill=String(requested?.[slot.id]||'').trim();
    const selected=slot.items.find((item)=>item.id===(requestedSkill||slot.defaultSkillId));
    if(requestedSkill&&!selected)throw new Error(`${slot.name}技能不兼容当前阶段契约`);
    if(!selected?.available)throw new Error(`${slot.name}技能不可用：${selected?.unavailableReason||'缺少默认实现'}`);
    selections[slot.id]={
      requestedSkill,selectedSkill:selected.id,
      selectionSource:requestedSkill?'user':'builtin-default',
    };
  }
  return selections;
}
