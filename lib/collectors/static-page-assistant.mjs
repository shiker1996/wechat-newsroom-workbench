import { extractPageItems, fetchPublicPage, nodeText, parseStaticHtml, selectAll } from '../../plugins/collectors/declarative-web-page/collector.mjs';
import { renderBrowserPageHtml } from '../../plugins/collectors/browser-web-page/runner.mjs';
import { rankSourceCandidates } from '../llm/source-candidate-ranker.mjs';
import { enrichSourceCandidateFields } from '../llm/source-field-enricher.mjs';

const GENERIC_CLASSES=new Set(['active','current','first','last','item','card','row','clearfix','selected']);
const safeToken=(value)=>/^[a-z_][\w-]*$/i.test(value||'');
const elements=(node)=>node.children.flatMap((child)=>child.tag==='#text'?[]:[child,...elements(child)]);
const classes=(node)=>String(node.attrs.class||'').split(/\s+/).filter((value)=>safeToken(value)&&!GENERIC_CLASSES.has(value.toLowerCase())).slice(0,2);
const selectorFor=(node)=>`${node.tag}${classes(node).map((value)=>`.${value}`).join('')}`;
const relative=(container,target)=>{const direct=selectorFor(target);try{return selectAll(container,direct).length===1?direct:target.tag;}catch{return target.tag;}};
const first=(node,tags)=>elements(node).find((item)=>tags.includes(item.tag));
function enrichmentOptions(matches){
  const sample=matches[0],options=[];
  for(const node of elements(sample)){
    if(!['p','span','small','time','div'].includes(node.tag))continue;
    const selector=relative(sample,node);if(options.some((item)=>item.selector===selector))continue;
    let targets;try{targets=matches.map((item)=>selectAll(item,selector)[0]).filter(Boolean);}catch{continue;}
    const coverage=targets.length/matches.length;if(coverage<.6)continue;
    const attribute=node.tag==='time'&&targets.filter((item)=>item.attrs.datetime).length/targets.length>=.6?'datetime':'';
    const samples=targets.slice(0,3).map((item)=>attribute?item.attrs[attribute]:nodeText(item)).filter(Boolean);
    if(samples.length<2)continue;options.push({selector,tag:node.tag,attribute,coverage:Number(coverage.toFixed(2)),samples});
  }
  return options.slice(0,12);
}

function candidateFor(root,html,node,pageUrl){
  const itemSelector=selectorFor(node);let matches;
  try{matches=selectAll(root,itemSelector);}catch{return null;}
  if(matches.length<3||matches.length>200)return null;
  const usable=matches.filter((item)=>{const link=first(item,['a']);return link&&link.attrs.href&&nodeText(item).length>=8;});
  if(usable.length<3||usable.length/matches.length<.6)return null;
  const sample=usable[0],heading=first(sample,['h1','h2','h3','h4','h5','h6']);
  const headingLink=heading&&elements(heading).find((item)=>item.tag==='a'&&item.attrs.href);
  const link=headingLink||first(sample,['a']);
  if(!link)return null;
  const titleTarget=heading||link;
  const config={url:pageUrl,itemSelector,titleSelector:relative(sample,titleTarget),linkSelector:relative(sample,link),linkAttribute:'href',maxPages:1,limit:30};
  let result;try{result=extractPageItems(html,pageUrl,config);}catch{return null;}
  const uniqueRate=result.items.length/Math.max(1,result.matched),headingBonus=heading?12:0,classBonus=classes(node).length*5;
  const score=Math.round(Math.min(100,45+Math.min(result.items.length,20)*2+uniqueRate*18+headingBonus+classBonus));
  return {name:heading?'文章列表':'链接列表',reason:`检测到 ${result.matched} 个重复的 ${itemSelector} 元素，其中 ${result.items.length} 条可提取标题和链接`,confidence:score/100,config,validation:{passed:true,matched:result.matched,itemCount:result.items.length,warnings:result.warnings.slice(0,3)},preview:result.items.slice(0,5).map(({title,url})=>({title,url})),enrichmentOptions:enrichmentOptions(usable)};
}

async function enrichAndRank({gateway,provider,intent,page,candidates,html,dynamic=false}){
  const enriched=await enrichSourceCandidateFields({gateway,provider,page,candidates,validate:async(candidate,config)=>{
    let result;try{result=extractPageItems(html,page.url,config);}catch{return {applied:false};}
    const fields={};for(const field of ['summary','author','publishedAt']){const filled=result.items.filter((item)=>item[field]).length,rate=filled/Math.max(1,result.items.length);if(rate>=.6)fields[field]=Number(rate.toFixed(2));else{delete config[`${field==='publishedAt'?'date':field}Selector`];if(field==='publishedAt')delete config.dateAttribute;}}
    const applied=Object.keys(fields).length>0;return {applied,config,fields,preview:result.items.slice(0,5).map(({title,url,summary,author,publishedAt})=>({title,url,summary,author,publishedAt}))};
  }});
  const ranked=await rankSourceCandidates({gateway,provider,intent,page,candidates:enriched.candidates});return {...ranked,aiFieldsApplied:enriched.aiFieldsApplied,aiFieldsReason:enriched.aiFieldsReason,warnings:[...(enriched.aiFieldsWarning?[enriched.aiFieldsWarning]:[]),...(ranked.aiWarning?[ranked.aiWarning]:[])]};
}

export function analyzeStaticPage(html,pageUrl){
  const root=parseStaticHtml(html);
  const groups=new Map();
  for(const node of elements(root)){
    if(['html','body','main','section','nav','header','footer','script','style'].includes(node.tag))continue;
    const selector=selectorFor(node);if(selector===node.tag&&!['article','li','tr'].includes(node.tag))continue;
    const key=selector;const group=groups.get(key)||[];group.push(node);groups.set(key,group);
  }
  const candidates=[];
  for(const group of groups.values()){
    if(group.length<3)continue;
    const candidate=candidateFor(root,html,group[0],pageUrl);if(candidate)candidates.push(candidate);
  }
  const distinct=[];
  for(const candidate of candidates.sort((a,b)=>b.confidence-a.confidence||b.validation.itemCount-a.validation.itemCount)){
    if(distinct.some((item)=>item.config.itemSelector===candidate.config.itemSelector))continue;
    distinct.push({...candidate,id:`candidate-${distinct.length+1}`});if(distinct.length===3)break;
  }
  return distinct;
}

export async function assistStaticPage(input,{fetchPage=fetchPublicPage,renderPage=renderBrowserPageHtml,root,gateway}={}){
  if(input?.pluginId!=='declarative-web-page')throw new Error('当前自动识别仅支持静态网页采集器');
  const url=String(input.url||'').trim();if(!url)throw new Error('请先填写页面地址');
  const page=await fetchPage(url),candidates=analyzeStaticPage(page.html,page.url);
  if(candidates.length){const resultPage={title:new URL(page.url).hostname,mode:'static',url:page.url},ranked=await enrichAndRank({gateway,provider:input.provider,intent:input.intent,page:resultPage,candidates,html:page.html});return {status:'ok',page:resultPage,targetPluginId:'declarative-web-page',candidates:ranked.candidates,aiApplied:ranked.aiApplied,aiReason:ranked.aiReason,aiFieldsApplied:ranked.aiFieldsApplied,aiFieldsReason:ranked.aiFieldsReason,warnings:ranked.warnings};}
  if(!root&&renderPage===renderBrowserPageHtml)throw Object.assign(new Error('静态页面未发现列表，且当前环境无法启动动态页面分析'),{code:'NO_REPEAT_STRUCTURE'});
  const rendered=await renderPage(page.url,{root,profileId:'default'}),dynamic=analyzeStaticPage(rendered.html,rendered.url);
  if(!dynamic.length)throw Object.assign(new Error('静态和动态页面分析都没有识别到可稳定提取的重复内容列表'),{code:'NO_REPEAT_STRUCTURE'});
  const converted=dynamic.map((candidate)=>({...candidate,name:`动态${candidate.name}`,reason:`页面内容需要浏览器渲染；${candidate.reason}`,config:{url:rendered.url,profileId:'default',waitForSelector:candidate.config.itemSelector,waitMilliseconds:1000,itemSelector:candidate.config.itemSelector,titleSelector:candidate.config.titleSelector,linkSelector:candidate.config.linkSelector,linkAttribute:'href',limit:30}}));
  const resultPage={title:rendered.title||new URL(rendered.url).hostname,mode:'dynamic',url:rendered.url},ranked=await enrichAndRank({gateway,provider:input.provider,intent:input.intent,page:resultPage,candidates:converted,html:rendered.html,dynamic:true});
  return {status:'ok',page:resultPage,targetPluginId:'browser-web-page',candidates:ranked.candidates,aiApplied:ranked.aiApplied,aiReason:ranked.aiReason,aiFieldsApplied:ranked.aiFieldsApplied,aiFieldsReason:ranked.aiFieldsReason,warnings:['静态 HTML 中没有列表，已自动使用隔离浏览器完成动态分析。',...ranked.warnings]};
}
