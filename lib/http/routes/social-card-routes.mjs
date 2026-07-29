import { bindGenerationSnapshot, prepareSkillRun, resolveSkillToolPolicy } from '../../skills/pipeline-runtime.mjs';

export async function handleSocialCardRoutes(context) {
  const { request, response, pathname, searchParams, store, json, body, path, fs, root, config, mime, models, aiJobs, socialCardFiles, isInsideRoots, createZip, socialContentType, resolveEventAnalysisFor, socialCardGate, socialChannelMode, describeCardLayouts, SOCIAL_CARD_LAYOUTS, SOCIAL_CARD_COMPOSITION_MODES, normalizeCardComposition, loadSkillBundle, fetchCandidateSource, candidateEventGroups, candidateRepositoryUrl, inspectRepository, socialCardWorkdir, writeUtf8, repositoryFactMarkdown, evaluateCardGate } = context;
  const cardEditorialMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-editorial$/);
  const cardPageLayoutMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-pages\/(\d+)\/layout$/);
  const cardPageMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-pages\/(\d+)$/);
  const socialCardsMatch = pathname.match(/^\/api\/candidates\/(\d+)\/social-cards$/);
  if(socialCardsMatch&&request.method==='GET'){
    const candidate=store.getCandidate(Number(socialCardsMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});const batch=store.getBatch(candidate.batch_id);const workspace=socialCardFiles(batch,candidate);
    const read=(name,fallback='')=>{const file=path.join(workspace.dir,name);if(!fs.existsSync(file))return fallback;return fs.readFileSync(file,'utf8');};
    const parse=(name,fallback)=>{try{return JSON.parse(read(name));}catch{return fallback;}};
    const images=workspace.files.filter((file)=>file.name.startsWith('output/')).map((file,index)=>({index:index+1,name:path.basename(file.name),url:`/api/candidates/${candidate.id}/social-cards/files/${encodeURIComponent(file.name)}`,downloadUrl:`/api/candidates/${candidate.id}/social-cards/files/${encodeURIComponent(file.name)}?download=1`,size:fs.statSync(file.path).size}));
    return json(response,200,{candidateId:candidate.id,code:candidate.candidate_id,title:candidate.hotspot_title,ready:images.length>0,images,copy:read('copy.txt'),facts:read('fact-sheet.md'),cardPlan:parse('card-plan.json',{}),layout:parse('layout-report.json',{}),delivery:parse('delivery-report.json',{}),htmlUrl:fs.existsSync(path.join(workspace.dir,'my-design.html'))?`/api/candidates/${candidate.id}/social-cards/files/my-design.html`:'',bundleUrl:images.length?`/api/candidates/${candidate.id}/social-cards/download`:''});
  }
  const socialCardFileMatch=pathname.match(/^\/api\/candidates\/(\d+)\/social-cards\/files\/(.+)$/);
  if(socialCardFileMatch&&request.method==='GET'){
    const candidate=store.getCandidate(Number(socialCardFileMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});const batch=store.getBatch(candidate.batch_id);const workspace=socialCardFiles(batch,candidate);const relative=decodeURIComponent(socialCardFileMatch[2]);const file=path.resolve(workspace.dir,relative);
    if(!isInsideRoots(file,[workspace.dir])||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(response,404,{error:'图文产物不存在'});const headers={'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'};if(searchParams.get('download')==='1')headers['content-disposition']=`attachment; filename="${path.basename(file).replace(/"/g,'')}"`;response.writeHead(200,headers);return fs.createReadStream(file).pipe(response);
  }
  const socialCardDownloadMatch=pathname.match(/^\/api\/candidates\/(\d+)\/social-cards\/download$/);
  if(socialCardDownloadMatch&&request.method==='GET'){
    const candidate=store.getCandidate(Number(socialCardDownloadMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});const batch=store.getBatch(candidate.batch_id);const workspace=socialCardFiles(batch,candidate);if(!workspace.files.length)return json(response,404,{error:'暂无可下载图文产物'});const zip=createZip(workspace.files);response.writeHead(200,{'content-type':'application/zip','content-disposition':`attachment; filename="${candidate.candidate_id.toLowerCase()}-social-cards.zip"`,'content-length':zip.length});return response.end(zip);
  }
  if (cardEditorialMatch && request.method === 'GET') {
    const candidate=store.getCandidate(Number(cardEditorialMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const editorial=store.getCardEditorial(candidate.id); const facts=store.getRepositoryFactSheet(candidate.id); const score=store.getSocialScore(candidate.id);
    const contentType=socialContentType(candidate),eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    const gate=socialCardGate(candidate,contentType,facts,editorial,eventAnalysis);
    const cardPlan=JSON.parse(editorial.card_plan_json||'[]');const channelMode=socialChannelMode(candidate);
    return json(response,200,{candidate,editorial,facts,score,contentType,channelMode,eventAnalysis,gate,layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode})});
  }
  if(cardPageLayoutMatch&&request.method==='PUT'){
    const candidate=store.getCandidate(Number(cardPageLayoutMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});
    const pageIndex=Number(cardPageLayoutMatch[2])-1;const input=await body(request);const layoutStyle=String(input.layout_style||'auto');
    if(!SOCIAL_CARD_LAYOUTS.includes(layoutStyle))return json(response,400,{error:'不支持的逐页版式'});
    const current=store.getCardEditorial(candidate.id);let cardPlan;try{cardPlan=JSON.parse(current.card_plan_json||'[]');}catch{cardPlan=[];}
    if(!Array.isArray(cardPlan)||!cardPlan[pageIndex])return json(response,404,{error:'故事板页面不存在'});
    cardPlan[pageIndex]={...cardPlan[pageIndex],layout_style:layoutStyle};
    const editorial=store.saveCardEditorial(candidate.id,{...current,card_plan_json:JSON.stringify(cardPlan)});
    const channelMode=socialChannelMode(candidate);
    return json(response,200,{editorial,cardPlan,layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode})});
  }
  if(cardPageMatch&&request.method==='PUT'){
    const candidate=store.getCandidate(Number(cardPageMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});
    const pageIndex=Number(cardPageMatch[2])-1;const input=await body(request);
    const current=store.getCardEditorial(candidate.id);let cardPlan;try{cardPlan=JSON.parse(current.card_plan_json||'[]');}catch{cardPlan=[];}
    if(!Array.isArray(cardPlan)||!cardPlan[pageIndex])return json(response,404,{error:'故事板页面不存在'});
    const title=String(input.title||'').trim();
    if(!title)return json(response,400,{error:'页面标题不能为空'});
    const blocks=Array.isArray(input.content_blocks)?input.content_blocks.slice(0,4):null;
    if(!blocks?.length)return json(response,400,{error:'每页至少保留一个内容块'});
    const allowedBlockTypes=['text','list','code','note','stats','compare','steps','timeline','scenes','highlight'];
    if(blocks.some((block)=>!allowedBlockTypes.includes(block?.type)))return json(response,400,{error:'故事板包含不支持的内容块类型'});
    cardPlan[pageIndex]={
      ...cardPlan[pageIndex],
      title,
      goal:String(input.goal||'').trim(),
      content_blocks:blocks.map((block)=>({
        ...block,
        title:String(block.title||'').trim(),
        content:String(block.content||'').trim(),
      })),
    };
    const editorial=store.saveCardEditorial(candidate.id,{...current,card_plan_json:JSON.stringify(cardPlan),status:'AI_READY'});
    const facts=store.getRepositoryFactSheet(candidate.id),contentType=socialContentType(candidate);
    const eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    const channelMode=socialChannelMode(candidate);
    return json(response,200,{editorial,cardPlan,gate:socialCardGate(candidate,contentType,facts,editorial,eventAnalysis),layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode})});
  }
  if (cardEditorialMatch && request.method === 'PUT') {
    const candidate=store.getCandidate(Number(cardEditorialMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const input=await body(request);
    if(input.layout_style&&!SOCIAL_CARD_LAYOUTS.includes(input.layout_style))return json(response,400,{error:'不支持的图文版式'});
    if(input.composition_mode&&!SOCIAL_CARD_COMPOSITION_MODES.includes(input.composition_mode))return json(response,400,{error:'不支持的构图模式'});
    const editorial=store.saveCardEditorial(candidate.id,input); const facts=store.getRepositoryFactSheet(candidate.id);
    const contentType=socialContentType(candidate),eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    let cardPlan=[];try{cardPlan=JSON.parse(editorial.card_plan_json||'[]');}catch{}
    const channelMode=socialChannelMode(candidate);
    return json(response,200,{editorial,contentType,gate:socialCardGate(candidate,contentType,facts,editorial,eventAnalysis),cardPlan,layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode})});
  }
  // 渠道切换：只换 output_mode 的渠道前缀（wechat-* ↔ xiaohongshu-*），类型部分不动，轨道与卡片决策同步
  const cardChannelMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-channel$/);
  if (cardChannelMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(cardChannelMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const input=await body(request);
    const channel=String(input.channel||'').trim();
    if(!['wechat','xiaohongshu'].includes(channel))return json(response,400,{error:'channel 必须是 wechat 或 xiaohongshu'});
    const track=candidate.tracks?.find((item)=>item.track==='social_cards');
    const currentMode=track?.output_mode||store.getCardEditorial(candidate.id).output_mode||'wechat-tool-cards';
    const typeSuffix=String(currentMode).replace(/^(wechat|xiaohongshu)-/,'');
    const nextMode=`${channel}-${typeSuffix}`;
    if(nextMode!==currentMode){
      store.updateCandidateTrack(candidate.id,'social_cards',{output_mode:nextMode});
      store.saveCardEditorial(candidate.id,{...store.getCardEditorial(candidate.id),output_mode:nextMode});
    }
    const updated=store.getCandidate(candidate.id);
    const editorial=store.getCardEditorial(candidate.id);const cardPlan=JSON.parse(editorial.card_plan_json||'[]');
    return json(response,200,{outputMode:nextMode,channelMode:channel,hasPlan:Boolean(cardPlan.length),candidate:updated,layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode:channel})});
  }
  const cardEditorialAiMatch = pathname.match(/^\/api\/candidates\/(\d+)\/ai\/card-editorial$/);
  if (cardEditorialAiMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(cardEditorialAiMatch[1])); if(!candidate)return json(response,404,{error:'候选不存在'});
    const contentType=socialContentType(candidate),facts=store.getRepositoryFactSheet(candidate.id);
    let eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    if(contentType==='repository'&&!facts?.data?.sourceUrl)return json(response,409,{error:'请先完成仓库事实核验'});
    if(contentType==='event'){
      if(!eventAnalysis?.analysis?.eventSummary)return json(response,409,{error:'该事件尚无事件卡，请先在热点全景运行事件研判'});
      // 日常批次事件候选可能尚未抓取来源，生成故事板前自动补抓
      if(!(eventAnalysis.analysis.sources||[]).some((item)=>item.status==='ok')){
        const hotspots=candidateEventGroups(candidate).flatMap((group)=>group.hotspots);
        if(hotspots.length){
          try{
            const toolPolicy=await resolveSkillToolPolicy({workspaceRoot:root,skillId:'xiaohongshu-article-generator'});
            await fetchCandidateSource({
              store,sourceFetch:config.sourceFetch,candidateId:candidate.id,root,force:false,hotspots,
              toolContext:{store,batchId:candidate.batch_id,candidateId:candidate.id,
                skillId:'xiaohongshu-article-generator',allowedCapabilities:toolPolicy.allowedCapabilities},
            });
          }catch{}
        }
        eventAnalysis=resolveEventAnalysisFor(candidate);
      }
    }
    if(contentType==='custom'&&facts?.data?.kind!=='custom')return json(response,409,{error:'请先填写自定义事实基座'});
    const input=await body(request); const current=store.getCardEditorial(candidate.id);
    try {
      const socialSkill=loadSkillBundle({workspaceRoot:root,skillName:'xiaohongshu-article-generator'});
      if(socialSkill.fallback)throw new Error('项目图文生成技能缺失');
      const skillRuntime=await prepareSkillRun({gateway:models,store,batchId:candidate.batch_id,candidateId:candidate.id,purpose:`social-card-editorial-${contentType}`,bundles:[socialSkill],provider:input.provider});
      const selectedProvider=skillRuntime.provider,providerConfig=skillRuntime.providerConfig;
      // 小红书渠道开放数据卡/对比卡/步骤卡/时间卡/场景卡/亮点卡版式，公众号维持基础块
      const xhsChannel=socialChannelMode(candidate)==='xiaohongshu';
      const cardBlockTypes=xhsChannel?'text|list|note|stats|compare|steps|timeline|scenes|highlight':'text|list|note';
      const repoBlockTypes=xhsChannel?'text|list|code|note|stats|compare|steps|timeline|scenes|highlight':'text|list|code|note';
      const eventSystem=`${socialSkill.prompt}\n\n## 当前运行阶段：突发事实基座到事件卡片故事板
只依据已确认事实、带来源的未核实主张、时间线和来源审计规划卡片。不得把 claims 写成事实；每个关键事实就近写明“来源 N”，未核实内容必须使用“声称/据其发布/尚未获独立证实”等边界表达。
返回严格 JSON：{"target_reader":"","pain_point":"","tool_positioning":"事件内容定位","must_highlight":"","must_disclose":"来源和未核实边界","getting_started":"","forbidden_claims":"","recommended_pages":4到10,"card_plan":[{"kind":"cover|what-happened|timeline|evidence|positions|impact|risk|ending","title":"具体页标题","goal":"用一句话说明本页的生成目标（仅供内部生成阶段使用，不会展示在卡片上），不要写成学习目标。错误示例：'读者能...'、'读者理解...'、'读者了解...'、'本页旨在...'；正确示例：'该主张仅来自单一社交媒体账号，尚未获独立证实。'、'三方回应否认了核心指控。'","evidence":["来源 N 支持的内容"],"content_blocks":[{"type":"${cardBlockTypes}","title":"可选小标题","content":"每块不超过160字，禁止出现'让读者...'、'本页旨在...'等指令描述"}]}]}。封面只呈现已支持的核心冲突；至少一页说明事实边界；若存在多方回应则单独成页；结尾不得诱导网暴。`;
      const repositorySystem=`${socialSkill.prompt}\n\n## 当前运行阶段：README 到卡片故事板
只依据已核验仓库事实和 README 生成图文决策，不得虚构体验、效果、性能、价格、权限或数字。故事板必须让读者明确回答：它是什么、解决什么具体问题、核心功能如何工作、怎样开始、适合谁、有什么限制。禁止用 GitHub topics 代替功能解释。返回严格 JSON：{"target_reader":"","pain_point":"","tool_positioning":"","must_highlight":"","must_disclose":"","getting_started":"","forbidden_claims":"","recommended_pages":4到7,"card_plan":[{"kind":"cover|problem|capability|quickstart|scenario|limitation|ending","title":"具体、有信息量的页标题","goal":"用一句话说明本页的生成目标（仅供内部生成阶段使用，不会展示在卡片上），不要写成学习目标。错误示例：'读者能...'、'读者理解...'、'读者了解...'、'本页旨在...'；正确示例：'复制命令即可安装该组件，无需额外配置。'、'相比手动实现，这个库把底层样板代码封装成一条链式 API。'","evidence":["直接支持内容的 README 或仓库事实"],"content_blocks":[{"type":"${repoBlockTypes}","title":"可选小标题","content":"文字，或 list 类型使用换行分隔；单块不超过 160 字，禁止出现'让读者...'、'本页旨在...'等指令描述"}]}]}。每页 2–4 个内容块，能力页必须写出 README 中的具体能力和工作方式，快速上手页保留真实命令，限制页明确未核验项。must_disclose 必须说明“基于项目文档整理，未实际运行”以及未知权限、网络和成熟度。`;
      const customSystem=`${socialSkill.prompt}\n\n## 当前运行阶段：自定义事实基座到卡片故事板
只依据自定义事实基座规划卡片，不得虚构体验、效果、数字或收益。体验真实性三来源等级是硬约束：source_level=author_experience 的要点可以写成第一人称亲历；user_material 必须保留来源归属；model_suggestion 只能表述为建议或参考，禁止写成亲测、效果或收益。按内容类型组织故事线：教程（cover→场景与痛点→step 分步页→注意事项→ending）；清单（cover→筛选标准→item 条目页→边界→ending）；观点（cover→核心论点→highlight 论据页→反方与边界→ending）。返回严格 JSON：{"target_reader":"","pain_point":"","tool_positioning":"内容定位","must_highlight":"","must_disclose":"来源等级与体验边界","getting_started":"","forbidden_claims":"","recommended_pages":4到10,"card_plan":[{"kind":"cover|highlight|step|item|boundary|ending","title":"具体、有信息量的页标题","goal":"用一句话说明本页的生成目标（仅供内部生成阶段使用，不会展示在卡片上），不要写成学习目标。错误示例：'读者能...'、'本页旨在...'；正确示例：'三步完成配置，第二步最容易漏。'","evidence":["事实基座中支持本页的要点，标注来源等级"],"content_blocks":[{"type":"${cardBlockTypes}","title":"可选小标题","content":"每块不超过160字，禁止出现'让读者...'、'本页旨在...'等指令描述"}]}]}。至少一页说明事实边界与限制（boundary）；model_suggestion 要点不得单独成页充当卖点。must_disclose 必须写明体验性表述来自作者确认、建议性内容未实测。`;
      const storyboardSystem=contentType==='event'?eventSystem:contentType==='custom'?customSystem:repositorySystem;
      const storyboardChannelDirective=socialChannelMode(candidate)==='xiaohongshu'
        ?'\n小红书渠道要求：页型与公众号一致（375×667），每页 2–4 个内容块；封面钩子更口语化、带好奇心；结尾页引导收藏与评论互动。除 text/list/note 外，内容块的 type 还可以使用以下版式：stats 数据卡（items:[{"num":"简短数字","label":"含义"}]，2–4 个，数字必须来自事实基座；num 不超过 6 个字符，如 "1h51m"、"3 线"、"99.9%"，禁止 "12+15+4" 这类长算式，长数据拆成多个条目或写进 label）、compare 对比卡（headers:["列名"],rows:[["单元格"]]，用于多方立场或产品对比）、steps 步骤卡（items:[{"title":"步骤名","content":"简述"}]，用于教程分步）、timeline 时间卡（items:[{"time":"时间","title":"事件","content":"简述"}]，用于事件时间线）、scenes 场景卡（items:[{"title":"场景","content":"简述"}]，2–3 个横排）、highlight 亮点卡（title+content，用于本页核心卖点）。使用这些版式时内容必须写入 items/headers/rows 字段，不要写入块的 content 字段。按内容选择合适版式，不要整篇都是纯文本块。'
        :'\n公众号渠道要求：页面为 9:16 长页，每页 2–4 个内容块；标题偏信息密度，结尾页引导收藏与转发。';
      const storyboardCompositionDirective='\n构图字段要求：card_plan 每页增加 role（cover|concept|feature|steps|data|compare|evidence|timeline|risk|ending）。可选 composition 只允许由系统规范化，字段为 id、columns、flow、alignment、decoration、overlap；decoration 仅可表达 none/orbit/index-line/stamp，overlap 仅可表达 none/title-card/accent-edge。不要输出 CSS、坐标、尺寸或 HTML。';
      const result=await bindGenerationSnapshot(models,skillRuntime.snapshotId).complete({provider:selectedProvider,purpose:'social-card-editorial',batchId:candidate.batch_id,candidateId:candidate.id,jsonMode:true,maxOutputTokens:Math.min(6000,providerConfig.maxOutputTokens),messages:[
        {role:'system',protected:true,content:storyboardSystem+storyboardChannelDirective+storyboardCompositionDirective},
        {role:'user',protected:true,content:JSON.stringify(contentType==='event'?{topic:candidate.hotspot_title,channel_mode:current.output_mode,event_analysis:eventAnalysis.analysis}:contentType==='custom'?{topic:candidate.hotspot_title,channel_mode:current.output_mode,custom_facts:facts.data}:{topic:candidate.hotspot_title,channel_mode:current.output_mode,repository_facts:facts.data})}
      ]});
      const parsed=JSON.parse(result.content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
      const maxPages=contentType==='repository'?7:10;
      const cardPlan = (Array.isArray(parsed.card_plan) ? parsed.card_plan.slice(0,maxPages) : []).map((page,pageIndex) => {
        const instructionPatterns = [/^让读者(?:一眼)?知道/,/^让读者/,/^读者(?:能|会|可以|理解|了解|知道)/,/^本页(?:旨在|希望|要|应该|目的(?:是|为))?/,/^这一页(?:旨在|希望|要|应该|目的(?:是|为))?/,/^本卡(?:旨在|希望|要|应该|目的(?:是|为))?/,/^本章节(?:旨在|希望|要|应该|目的(?:是|为))?/,/^请/];
        const clean = (text) => { if(typeof text!=='string')return text; let s=text.trim(); for(const re of instructionPatterns)s=s.replace(re,'').trim(); return s.replace(/^[，。；、:：\s]+/,'').trim(); };
        const smart=normalizeCardComposition(page,{pageIndex,seed:`${candidate.batch_id}|${candidate.id}`});
        return { ...page, role:smart.role, composition:smart.composition, layout_style:SOCIAL_CARD_LAYOUTS.includes(page.layout_style)?page.layout_style:'auto', title:clean(page.title), goal:clean(page.goal), evidence:(Array.isArray(page.evidence)?page.evidence:[]).map(clean), content_blocks:(Array.isArray(page.content_blocks)?page.content_blocks:[]).map((b)=>({...b,title:clean(b.title),content:clean(b.content)})) };
      });
      const asText=(value,fallback='')=>typeof value==='string'?value.trim():value==null?fallback:Array.isArray(value)?value.map((item)=>typeof item==='string'?item:JSON.stringify(item)).join('\n'):JSON.stringify(value);
      const editorial=store.saveCardEditorial(candidate.id,{...current,
        target_reader:asText(parsed.target_reader,current.target_reader),pain_point:asText(parsed.pain_point,current.pain_point),
        tool_positioning:asText(parsed.tool_positioning,current.tool_positioning),must_highlight:asText(parsed.must_highlight,current.must_highlight),
        must_disclose:asText(parsed.must_disclose,current.must_disclose),getting_started:asText(parsed.getting_started,current.getting_started),
        forbidden_claims:asText(parsed.forbidden_claims,current.forbidden_claims),
        recommended_pages:Math.max(4,Math.min(maxPages,Number(parsed.recommended_pages)||cardPlan.length||6)),card_plan_json:JSON.stringify(cardPlan),status:'AI_READY'});
      const gate=socialCardGate(candidate,contentType,facts,editorial,eventAnalysis);const channelMode=socialChannelMode(candidate);
      return json(response,200,{editorial,gate,cardPlan,contentType,eventAnalysis,layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode})});
    } catch(error) { return json(response,502,{error:`AI 图文决策失败：${error.message}`}); }
  }
  const repositoryInspectMatch = pathname.match(/^\/api\/candidates\/(\d+)\/repository\/inspect$/);
  if (repositoryInspectMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(repositoryInspectMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    if(socialContentType(candidate)==='event')return json(response,409,{error:'事件型图文使用突发事实基座，不执行仓库核验'});
    if(socialContentType(candidate)==='custom')return json(response,409,{error:'自定义图文使用自定义事实基座，不执行仓库核验'});
    const sourceUrl=candidateRepositoryUrl(candidate); if(!sourceUrl)return json(response,409,{error:'该候选没有可核验的 GitHub 仓库地址'});
    try {
      const toolPolicy=await resolveSkillToolPolicy({workspaceRoot:root,skillId:'xiaohongshu-article-generator'});
      const fact=await inspectRepository(sourceUrl,{workspaceRoot:root,cacheDir:path.join(root,'data','github-cache'),toolContext:{store,batchId:candidate.batch_id,candidateId:candidate.id,skillId:'xiaohongshu-article-generator',allowedCapabilities:toolPolicy.allowedCapabilities}}); const saved=store.saveRepositoryFactSheet(candidate.id,{repository:fact.repository,sourceUrl:fact.sourceUrl,status:'ok',data:fact,checkedAt:fact.stars.checkedAt});
      const score=store.getSocialScore(candidate.id);
      const batch=store.getBatch(candidate.batch_id); const dir=socialCardWorkdir(batch,candidate); const jsonPath=path.join(dir,'repository-fact-sheet.json'); const mdPath=path.join(dir,'fact-sheet.md');
      const jsonFile=writeUtf8(jsonPath,JSON.stringify(fact,null,2)); const mdFile=writeUtf8(mdPath,repositoryFactMarkdown(fact));
      store.upsertArtifact({batchId:batch.id,kind:'仓库事实基座',name:path.basename(jsonPath),path:jsonPath,...jsonFile});
      store.upsertArtifact({batchId:batch.id,kind:'图文事实清单',name:path.basename(mdPath),path:mdPath,...mdFile});
      const editorial=store.getCardEditorial(candidate.id); return json(response,200,{facts:saved,score,gate:evaluateCardGate(candidate,saved,editorial)});
    } catch(error) {
      store.saveRepositoryFactSheet(candidate.id,{sourceUrl,status:'failed',data:{},error:error.message,checkedAt:new Date().toISOString()});
      return json(response,502,{error:`仓库核验失败：${error.message}`});
    }
  }
  const cardLockMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-lock$/);
  if (cardLockMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(cardLockMatch[1])); if(!candidate)return json(response,404,{error:'候选不存在'});
    const editorial=store.getCardEditorial(candidate.id),facts=store.getRepositoryFactSheet(candidate.id),contentType=socialContentType(candidate);
    const gate=socialCardGate(candidate,contentType,facts,editorial,contentType==='event'?resolveEventAnalysisFor(candidate):null);
    if(!gate.ready)return json(response,409,{error:`CARD GATE 未通过：${gate.issues.join('；')}`,gate});
    store.saveCardEditorial(candidate.id,{...editorial,status:'LOCKED'});
    store.updateCandidateTrack(candidate.id,'social_cards',{status:'locked',locked_at:new Date().toISOString()});
    return json(response,200,{ok:true,gate,track:store.listCandidateTracks(candidate.id).find((item)=>item.track==='social_cards')});
  }
  const socialGenerateMatch = pathname.match(/^\/api\/candidates\/(\d+)\/ai\/social-card$/);
  if (socialGenerateMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(socialGenerateMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const input=await body(request);
    const purpose=`social-cards-${socialContentType(candidate)}`;
    const previousSnapshot=input.useLatestSkill===true?null:store.findLatestGenerationSnapshot({
      batchId:candidate.batch_id,candidateId:candidate.id,purposes:[purpose],
    });
    return json(response,202,aiJobs.start({batchId:candidate.batch_id,candidateId:candidate.id,
      provider:previousSnapshot?null:input.provider,type:'social-card',snapshotId:previousSnapshot?.id||null}));
  }
  return false;
}
