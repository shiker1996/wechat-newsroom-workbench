import { markdownVisibleChars } from '../../../shared/domain/markdown-visible-chars.mjs';

function cleanMarkdown(value) { return String(value||'').trim().replace(/^```(?:markdown)?\s*/i,'').replace(/\s*```$/,''); }
function asArray(value,{emptyWords=false}={}) {
  if(Array.isArray(value))return value.filter((item)=>item!=null&&String(item).trim()!=='');
  if(value==null)return [];
  if(typeof value==='string'){
    const text=value.trim();if(!text)return [];
    if(emptyWords&&/^(?:none|null|无|暂无|没有|无剩余风险|n\/a)$/i.test(text))return [];
    return text.split(/\r?\n|[、；;]+/).map((item)=>item.replace(/^[-*•\d.、)\s]+/,'').trim()).filter(Boolean);
  }
  if(typeof value==='object')return [value];
  return [value];
}
function normalizeUrl(value) { return String(value||'').trim().replace(/\/+$/,'').toLowerCase(); }

export function articleStageOutputIssue(value,{requireArticle=false}={}) {
  const text=cleanMarkdown(value);
  if(!text)return '模型返回空内容';
  if(/(?:我(?:先|需要|将|来)|让我)(?:读取|查看|检查|了解|确认|调用|使用|打开).{0,40}(?:文件|目录|环境|工具|技能|契约|工作区)/i.test(text))return '模型返回了工具操作说明，而不是文章内容';
  if(requireArticle&&!/^#\s+\S+/m.test(text))return '模型未返回包含一级标题的完整 Markdown 文章';
  return null;
}

export function normalizePlanningResult(input={}) {
  const plan=input&&typeof input==='object'&&!Array.isArray(input)?{...input}:{};
  plan.expectedAction=asArray(plan.expectedAction);
  plan.coreKeywords=asArray(plan.coreKeywords);
  plan.remainingRisks=asArray(plan.remainingRisks,{emptyWords:true});
  plan.titleCandidates=asArray(plan.titleCandidates).map((item)=>typeof item==='string'?{title:item,reason:''}:item).filter((item)=>item&&item.title);
  plan.distributionLane=String(plan.distributionLane??plan.distribution_lane??'').trim();
  plan.readerStake=String(plan.readerStake??plan.reader_stake??'').trim();
  return plan;
}

export function compositeSourceText(candidate,{maxChars=48000,perSourceChars=4000}={}) {
  if(!candidate?.composite)return '';
  const documents=Array.isArray(candidate.source_documents)?candidate.source_documents:[];
  let result='';
  for(const item of documents){
    const source=item?.source;
    if(source?.status!=='ok'||!String(source.content||'').trim())continue;
    const block=`\n\n## 来源：${item.title||source.title||'未命名'}\nURL：${item.url||source.final_url||source.url||''}\n${String(source.content).slice(0,perSourceChars)}`;
    if(result.length+block.length>maxChars){const remaining=maxChars-result.length;if(remaining>200)result+=block.slice(0,remaining);break;}
    result+=block;
  }
  return result.trim();
}

export function authorizedWritingBrief(brief) { const safe={...brief};delete safe.sourceText;return safe; }

export function sourceCacheIssue(candidate,sourceDoc) {
  if(!sourceDoc?.content||candidate?.composite)return null;
  const expected=normalizeUrl(candidate?.url); const actual=normalizeUrl(sourceDoc.url||sourceDoc.final_url);
  if(!expected||!actual||expected===actual)return null;
  return `来源缓存与热点原文不一致（缓存为 ${sourceDoc.url}，热点为 ${candidate.url}），编辑室粘贴的替代来源可能已覆盖原缓存；请重新抓取热点原文或回编辑室确认来源后再成稿`;
}

export function unverifiedFactBaseIssue(factBase) {
  const claims=Array.isArray(factBase?.claims)?factBase.claims:[];
  const factual=claims.filter((item)=>item&&item.status!=='opinion');
  if(!factual.length||!factual.every((item)=>item.status==='unverified'))return null;
  const missing=asArray(factBase?.missingEvidence).join('；');
  return `事实基座中所有事实性主张均未核实${missing?`（待补：${missing}）`:''}，无法成稿；请抓取可核对的原文或回编辑室调整命题后再试`;
}

export const ARTICLE_LENGTH_RANGE=Object.freeze({min:1300,max:2000});

export function selectWriterSkill(candidate={}) {
  if(candidate.composite)return {skill:'wechat-mp-composite',reason:'候选由多个热点组成，需要按共同机制或趋势组织'};
  const angleText=[candidate.angle,candidate.thesis,candidate.editorial?.research_basis,candidate.editorial?.confirmed_facts].filter(Boolean).join(' ');
  const allText=[candidate.hotspot_title,candidate.category,angleText].filter(Boolean).join(' ');
  const serious=/裁员|事故|伤亡|骚扰|违法|诉讼|疾病|医疗|劳动仲裁|隐私泄露/.test(allText);
  if(!serious&&/趣闻|离谱|八卦|段子|奇葩|荒诞|整活|吐槽/.test(angleText))return {skill:'wechat-mp-gossip-chill',reason:'角度明确采用轻量趣闻或职场反差表达，且不涉及严肃伤害事件'};
  const deepIntent=/原理|机制拆解|架构拆解|技术拆解|性能拆解|成本拆解|成本测算|算一笔账|可复算|公式|吞吐|延迟|显存|算力成本|部署成本|推理成本|训练成本|量化|内核|技术路线|比较口径|基准测试/.test(angleText);
  const technicalSubject=/AI|模型|芯片|GPU|推理|训练|Token|MoE|Attention|Agent|数据库|框架|协议|算法|开源|性能|算力|架构|内核/i.test(allText);
  if(deepIntent&&technicalSubject)return {skill:'wechat-mp-tech-deep',reason:'命题要求解释技术机制，或对性能、成本和指标进行可复算拆解'};
  if(candidate.category==='🤖 AI/技术动态'||technicalSubject)return {skill:'wechat-mp-tech-hotspot',reason:'主题属于技术、产品或行业动态，重点是事件影响而非完整原理推导'};
  return {skill:'wechat-mp-deep-dive',reason:'主题需要从参与方、利益关系、因果链与反方边界展开'};
}

export function articleLengthStatus(article, range = ARTICLE_LENGTH_RANGE) {
  const count=markdownVisibleChars(article);
  return {count,valid:count>=range.min&&count<=range.max,shortfall:Math.max(0,range.min-count),overflow:Math.max(0,count-range.max)};
}

export function buildDraftUserPrompt(selectedTitle, brief, outline) {
  return `标题:${selectedTitle}\n\n锁定简报、事实基座与发布主张登记:${JSON.stringify(brief)}\n\n写作时必须优先覆盖 adoptedResearchPoints 中作者明确采用的研判拓展点，不得只复述事件摘要；将其转化为事实解释、利益/成本分析、事件间关系或可验证的观点边界。只把事实基座中 status=verified 的主张写成确定事实；disputed、unverified 和 restricted_claims 必须按明确归因、限定或删除处理。涉及 IPO、上市、估值、融资、公司/个人负面指控时，不得在标题、摘要或前 200 字中加入没有直接证据的数字、动作和结论。\n\n大纲:\n${outline}`;
}

export function buildResearchCoveragePrompt({ article = '', researchPoints = [], rejectedAngles = [] } = {}) {
  return `请检查下面的文章是否真正采纳了作者在编辑室明确选择的研判拓展点。只检查这些已选择的点，不要求文章覆盖未选择的研判材料。

判断标准：full=文章使用事实解释了该点，并展开了它对文章命题的意义；partial=仅提及或换词复述，没有形成论证；omitted=没有出现；contradicted=文章与该点相反且没有说明依据。只要核心采用点为 omitted、contradicted 或 partial_core，status 必须为 needs_revision；全部至少达到 full 或非核心 partial 时才 pass。

只返回 JSON，不要 Markdown、解释或前置文本，格式必须是：
{"status":"pass|needs_revision","summary":"一句话","items":[{"point_id":"对应 point_id","status":"full|partial|partial_core|omitted|contradicted","coverage":"一句话说明覆盖情况","explanation":"依据文章中的具体段落或缺口","article_excerpt":"不超过80字的原文摘录"}],"omitted_points":[],"contradicted_points":[],"rejected_point_leakage":[],"repair_suggestions":[]}

采用的研判拓展点：
${JSON.stringify(researchPoints)}

作者明确不采用的方向（不得重新写成文章事实或核心观点）：
${JSON.stringify(rejectedAngles)}

文章：
${String(article).trim()}`;
}
