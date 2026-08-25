import fs from 'node:fs';
import path from 'node:path';
import { buildSocialCardTemplateCapabilityPrompt } from '../../../shared/rendering/social-card-template-resolver.mjs';

export const SOCIAL_CARD_STORYBOARD_CONTRACTS = Object.freeze({
  factBase:'social_card_fact_base',
  storyboard:'social_card_storyboard',
  layoutReport:'social_card_layout_report',
});

const CONTENT_ENTRY_POINTS = Object.freeze({
  repository:'social-tool',
  event:'social-event',
  custom:'social-custom',
});

const CONTENT_TYPE_LIMITS = Object.freeze({
  repository:{minPages:4,maxPages:7},
  event:{minPages:4,maxPages:10},
  custom:{minPages:4,maxPages:10},
});

function normalizeContentType(contentType) {
  if (contentType === 'technology' || contentType === 'trend') return 'event';
  return CONTENT_ENTRY_POINTS[contentType] ? contentType : 'repository';
}

export function buildSocialCardFactEnvelope({
  contentType,
  channelMode,
  topic,
  facts,
  eventAnalysis,
  outputMode,
}) {
  const normalizedType=normalizeContentType(contentType);
  const limits=CONTENT_TYPE_LIMITS[normalizedType];
  const channel=channelMode==='xiaohongshu'?'xiaohongshu':'wechat';
  const payload=normalizedType==='event'
    ? { ...(eventAnalysis?.factBase || {}), eventSummary:eventAnalysis?.eventSummary || '', sources:eventAnalysis?.sources || [], sourceAudit:eventAnalysis?.sourceAudit || {}, ...(facts || {}) }
    : facts;
  return {
    schemaVersion:1,
    contract:SOCIAL_CARD_STORYBOARD_CONTRACTS.factBase,
    entryPoint:CONTENT_ENTRY_POINTS[normalizedType],
    contentType:normalizedType,
    channelMode:channel,
    outputMode:String(outputMode||`${channel}-${normalizedType}`),
    topic:String(topic||'').trim(),
    facts:payload||{},
    constraints:{
      minPages:limits.minPages,
      maxPages:limits.maxPages,
      allowedBlockTypes:channel==='xiaohongshu'
        ? ['text','list','code','note','stats','compare','steps','timeline','scenes','highlight']
        : ['text','list','code','note'],
      pageWidth:375,
      pageHeight:667,
    },
    disclosure:{
      required:true,
      text:normalizedType==='repository'?'基于项目文档整理，未实际运行':'',
    },
  };
}

// P0 兼容适配器：保持迁移前发给模型的 user JSON 字段和层级不变。
export function toLegacySocialCardPromptInput(envelope) {
  const base={
    topic:envelope.topic,
    channel_mode:envelope.outputMode,
  };
  if(envelope.contentType==='event')return {...base,event_analysis:envelope.facts};
  if(envelope.contentType==='custom')return {...base,custom_facts:envelope.facts};
  return {...base,repository_facts:envelope.facts};
}

export const BUILTIN_SOCIAL_CARD_STORYBOARD_SKILLS=Object.freeze({
  repository:'repository-card-storyboard',
  event:'event-card-storyboard',
  technology:'open-source-technology-storyboard',
  trend:'open-source-trend-storyboard',
  custom:'custom-card-storyboard',
});

function readPromptReference(workspaceRoot, name) {
  const file=path.join(workspaceRoot,'server','features','social-cards','prompts',name);
  if(!fs.existsSync(file))throw new Error(`图文故事板提示词引用缺失：${name}`);
  return fs.readFileSync(file,'utf8').trim();
}

function replaceTokens(text, values) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g,(_,key)=>{
    if(!(key in values))throw new Error(`图文故事板提示词变量缺失：${key}`);
    return values[key];
  });
}

export function buildSocialCardStoryboardSystemPrompt({
  workspaceRoot,
  skillId='',
  skillPrompt,
  contentType,
  channelMode,
  templateCapabilities=null,
}) {
  const normalizedType=normalizeContentType(contentType);
  const xhs=channelMode==='xiaohongshu';
  const cardBlockTypes=xhs?'text|list|note|stats|compare|steps|timeline|scenes|highlight':'text|list|note';
  const repoBlockTypes=xhs?'text|list|code|note|stats|compare|steps|timeline|scenes|highlight':'text|list|code|note';
  const values={
    CARD_BLOCK_TYPES:cardBlockTypes,
    REPOSITORY_BLOCK_TYPES:repoBlockTypes,
    BLOCK_TYPES:normalizedType==='repository'?repoBlockTypes:cardBlockTypes,
  };
  const embeddedContractSkillIds=new Set([
    BUILTIN_SOCIAL_CARD_STORYBOARD_SKILLS.repository,
    BUILTIN_SOCIAL_CARD_STORYBOARD_SKILLS.event,
    BUILTIN_SOCIAL_CARD_STORYBOARD_SKILLS.custom,
  ]);
  const methodPrompt=replaceTokens(skillPrompt,values);
  // 新增的技术/趋势故事板只写方法，不自带旧事件故事板的 JSON 字段契约；
  // 必须注入同一份运行契约，确保三类事件故事板都输出 card_plan/content_blocks。
  const runtimeContract=embeddedContractSkillIds.has(skillId)?'':replaceTokens(readPromptReference(workspaceRoot,'runtime-contract.md'),values);
  const channel=readPromptReference(workspaceRoot,xhs?'channel-xiaohongshu.md':'channel-wechat.md');
  const composition=readPromptReference(workspaceRoot,'composition-contract.md');
  const template=buildSocialCardTemplateCapabilityPrompt(templateCapabilities);
  return [methodPrompt,runtimeContract,channel,composition,template].filter(Boolean).join('\n\n');
}
