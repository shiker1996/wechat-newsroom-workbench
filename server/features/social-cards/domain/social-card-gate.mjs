export function evaluateCardGate(candidate, factSheet, editorial) {
  const fact=factSheet?.data||factSheet||{}; const checks=[
    {key:'repository',label:'仓库地址已确认',ok:Boolean(fact.sourceUrl)},
    {key:'capabilities',label:'核心能力有来源支持',ok:(fact.coreCapabilities||[]).length>0},
    {key:'installation',label:'安装入口已核验或限制已说明',ok:(fact.installation||[]).length>0||Boolean(editorial?.must_disclose?.trim())},
    {key:'license',label:'LICENSE 已确认或明确标记未知',ok:Boolean(fact.license?.type)},
    {key:'maturity',label:'项目成熟度已确认',ok:Boolean(fact.maturity)},
    {key:'boundaries',label:'权限、网络和限制边界已说明',ok:Boolean(editorial?.must_disclose?.trim())},
    {key:'claims',label:'禁止表达已填写',ok:Boolean(editorial?.forbidden_claims?.trim())},
    {key:'pages',label:'可规划至少 4 页卡片',ok:Number(editorial?.recommended_pages||0)>=4},
    {key:'reader',label:'目标读者和核心痛点已明确',ok:Boolean(editorial?.target_reader?.trim()&&editorial?.pain_point?.trim())},
    {key:'positioning',label:'工具定位和重点能力已明确',ok:Boolean(editorial?.tool_positioning?.trim()&&editorial?.must_highlight?.trim())},
  ];
  return {ready:checks.every((item)=>item.ok),passed:checks.filter((x)=>x.ok).length,total:checks.length,checks,issues:checks.filter((x)=>!x.ok).map((x)=>x.label)};
}

export function evaluateEventCardGate(candidate, analysisRecord, editorial) {
  const analysis=analysisRecord?.analysis||analysisRecord||{};
  const facts=analysis.factBase||{},audit=analysis.sourceAudit||{};
  let plan=[];try{plan=Array.isArray(editorial?.card_plan_json)?editorial.card_plan_json:JSON.parse(editorial?.card_plan_json||'[]');}catch{}
  const checks=[
    {key:'analysis',label:'突发事实基座已生成',ok:Boolean(analysis.eventSummary)},
    {key:'sources',label:'至少一条素材抓取成功',ok:(analysis.sources||[]).some((item)=>item.status==='ok')},
    {key:'boundaries',label:'事实与未核实主张已分开',ok:Array.isArray(facts.confirmedFacts)&&Array.isArray(facts.claims)},
    {key:'audit',label:'来源风险与缺口已审计',ok:Boolean(audit&&Array.isArray(audit.issues))},
    {key:'storyboard',label:'事件故事板包含 4～10 页',ok:plan.length>=4&&plan.length<=10},
    {key:'disclosure',label:'未核实内容与来源边界已披露',ok:Boolean(editorial?.must_disclose?.trim())},
    {key:'claims',label:'禁止表达已填写',ok:Boolean(editorial?.forbidden_claims?.trim())},
    {key:'reader',label:'目标读者和传播问题已明确',ok:Boolean(editorial?.target_reader?.trim()&&editorial?.pain_point?.trim())},
  ];
  return {ready:checks.every((item)=>item.ok),passed:checks.filter((item)=>item.ok).length,total:checks.length,checks,issues:checks.filter((item)=>!item.ok).map((item)=>item.label),contentType:'event'};
}

// 自定义图文首批开放的内容类型（待办 1+6 设计评审拍板：教程、清单、观点）
export const CUSTOM_CONTENT_TYPES = Object.freeze({ tutorial:'教程', list:'清单', opinion:'观点' });
export const CUSTOM_SOURCE_LEVELS = Object.freeze({ author_experience:'作者真实体验', user_material:'用户提供素材', model_suggestion:'模型建议' });

export function evaluateCustomCardGate(candidate, factSheet, editorial) {
  const fact=factSheet?.data||factSheet||{};
  const points=Array.isArray(fact.points)?fact.points:[];
  const levels=new Set(Object.keys(CUSTOM_SOURCE_LEVELS));
  const materials=Array.isArray(fact.materials)?fact.materials:[];
  const contentType=String(fact.content_type||'');
  const steps=Array.isArray(fact.steps)?fact.steps:[];
  const items=Array.isArray(fact.items)?fact.items:[];
  const typeSpecific=contentType==='tutorial'
    ? {key:'steps',label:'教程步骤至少 2 步',ok:steps.length>=2}
    : contentType==='list'
      ? {key:'items',label:'清单条目至少 3 条',ok:items.length>=3}
      : {key:'thesis',label:'核心观点已明确',ok:Boolean(String(fact.thesis||'').trim())};
  const checks=[
    {key:'facts',label:'自定义事实基座已生成',ok:fact.kind==='custom'&&Boolean(String(fact.topic||'').trim())},
    {key:'content-type',label:'内容类型为教程/清单/观点',ok:Boolean(CUSTOM_CONTENT_TYPES[contentType])},
    typeSpecific,
    {key:'points',label:'核心要点至少 3 条',ok:points.length>=3},
    {key:'source-levels',label:'要点来源等级已完整标注',ok:points.length>0&&points.every((item)=>levels.has(item?.source_level))},
    {key:'non-model',label:'至少一条要点来自作者体验或用户素材',ok:points.some((item)=>item?.source_level&&item.source_level!=='model_suggestion')},
    {key:'materials',label:'素材链接均已抓取成功',ok:materials.every((item)=>item.status==='ok')},
    {key:'disclosure',label:'来源等级与体验边界已披露',ok:Boolean(editorial?.must_disclose?.trim())},
    {key:'claims',label:'禁止表达已填写',ok:Boolean(editorial?.forbidden_claims?.trim())},
    {key:'reader',label:'目标读者和核心痛点已明确',ok:Boolean(editorial?.target_reader?.trim()&&editorial?.pain_point?.trim())},
    {key:'pages',label:'可规划 4～10 页卡片',ok:Number(editorial?.recommended_pages||0)>=4&&Number(editorial?.recommended_pages||0)<=10},
  ];
  return {ready:checks.every((item)=>item.ok),passed:checks.filter((item)=>item.ok).length,total:checks.length,checks,issues:checks.filter((item)=>!item.ok).map((item)=>item.label),contentType:'custom'};
}
