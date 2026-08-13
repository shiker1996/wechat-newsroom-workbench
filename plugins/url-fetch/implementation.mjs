import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { firecrawlScrape } from './firecrawl-client.mjs';
import { assessSourceQuality, FETCH_UPGRADE_THRESHOLD } from './source-quality.mjs';

const execFileAsync=promisify(execFile);

function pythonCandidates() {
  return [process.env.WRITE_ASSISTANT_PYTHON,'py','python','python3'].filter(Boolean)
    .map((command)=>({command,args:command==='py'?['-3','-X','utf8']:['-X','utf8']}));
}

async function runPython(script,args,options) {
  const failures=[];
  for(const candidate of pythonCandidates()) {
    try{return await execFileAsync(candidate.command,[...candidate.args,script,...args],options);}
    catch(error){failures.push(`${candidate.command}: ${error.code||error.message}`);if(!['ENOENT','EPERM'].includes(error.code)&&candidate.command!== 'py')throw error;}
  }
  throw new Error(`未找到可用 Python 3：${failures.join('；')}`);
}

function writeJson(filePath,value) {
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  const temporary=`${filePath}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify(value,null,2),'utf8');
  fs.renameSync(temporary,filePath);
}

function withQuality(parsed) {
  const quality=assessSourceQuality({ title:parsed.title, content:parsed.content, status:parsed.status });
  return { ...parsed, quality, evidence_level:quality.level };
}

function plain(value) {
  return String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
}

function hotspotSummary(hotspot) {
  if(!hotspot) return '';
  let raw={}; try{ raw=JSON.parse(hotspot.raw_json||'{}'); }catch{}
  return plain(raw.summary||'');
}

function rssRecord({ targetUrl, title, summary, method }) {
  return { status:'ok', url:targetUrl, final_url:targetUrl, title, description:summary.slice(0,200), author:'', published_at:'',
    content:summary, content_chars:summary.length, fetched_at:new Date().toISOString(), error:'', fetch_method:method };
}

const GITHUB_REPO_RE=/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i;

// 抓取路由（待办 7-P2）：RSS 已有内容 → GitHub API → Python 本地（免费）→ Firecrawl（计费，仅质量不足时升级）
// 阈值由插件提供默认值，调用方可通过 sourceFetch 配置覆盖。
const SOURCE_FETCH_DEFAULTS = { upgradeThreshold: FETCH_UPGRADE_THRESHOLD, rssContentMinChars: 800, rssFallbackMinChars: 200, githubMinChars: 200 };

export async function fetchUrlContentImplementation({targetUrl,title='',root,hotspot=null,firecrawlImpl=firecrawlScrape,firecrawlOptions={},inspectImpl=null,repositoryOptions={},pythonImpl=null,sourceFetch={}}) {
  const cfg={...SOURCE_FETCH_DEFAULTS,...sourceFetch};
  const script=fileURLToPath(new URL('./scripts/fetch-hotspot-url.py',import.meta.url));
  const provider=String(sourceFetch.provider||process.env.SOURCE_FETCH_PROVIDER||'auto').toLowerCase();
  const summary=hotspotSummary(hotspot);

  // 路由 1：RSS 已带内容——推文即全文；长摘要视为可用正文，均不再二次抓取
  if(summary&&(hotspot?.source_type==='twitter'||summary.length>=cfg.rssContentMinChars)){
    const method=hotspot?.source_type==='twitter'?'rss-tweet':'rss-content';
    const record=withQuality(rssRecord({ targetUrl, title, summary, method }));
    // 推文/RSS 全文本身就是完整内容，短是体裁使然，不按长度降级
    if(record.status==='ok'){ record.evidence_level='full-text'; record.quality={...record.quality,level:'full-text'}; }
    return record;
  }

  // 路由 2：GitHub 仓库走 API + README，不消耗 Firecrawl
  if(provider!=='firecrawl'&&inspectImpl&&GITHUB_REPO_RE.test(targetUrl)){
    try {
      const facts=await inspectImpl(targetUrl,{cacheDir:path.join(root,'data','github-cache'),...repositoryOptions});
      const content=facts.readme?.markdown||facts.description||'';
      if(content.length>=cfg.githubMinChars){
        return withQuality({ status:'ok', url:targetUrl, final_url:targetUrl, title:facts.repository||title, description:facts.description||'',
          author:'', published_at:'', content, content_chars:content.length, fetched_at:new Date().toISOString(), error:'', fetch_method:'github-api' });
      }
    } catch { /* 落到通用抓取 */ }
  }

  const failures=[];
  const fetchFirecrawl=async()=>{ try{ return await firecrawlImpl(targetUrl,firecrawlOptions); }catch(error){ failures.push(`Firecrawl MCP：${error.message}`); return null; } };
  const fetchPython=async()=>{
    try {
      const {stdout}=pythonImpl?await pythonImpl(targetUrl):await runPython(script,['--url',targetUrl,'--timeout','25','--max-chars','30000'],
        {cwd:root,windowsHide:true,timeout:35000,maxBuffer:5_000_000});
      return {...JSON.parse(stdout.trim()),fetch_method:failures.length?'python-fallback':'python'};
    } catch(error) { failures.push(`Python：${String(error.stderr||error.stdout||error.message).trim()}`); return null; }
  };

  let parsed=null;
  if(provider==='firecrawl'){
    parsed=await fetchFirecrawl()||await fetchPython();
  } else {
    // 路由 3：免费途径优先；质量评分不足才升级 Firecrawl（计费），并保留质量更好的一份
    parsed=await fetchPython();
    if(provider!=='python'&&(!parsed||assessSourceQuality(parsed).score<cfg.upgradeThreshold)){
      const viaFirecrawl=await fetchFirecrawl();
      if(viaFirecrawl&&(!parsed||assessSourceQuality(viaFirecrawl).score>assessSourceQuality(parsed).score))parsed=viaFirecrawl;
    }
  }
  // RSS 摘要兜底：抓取全部失败但摘要可用时降级使用，证据等级标注为摘要级
  if(!parsed&&summary.length>=cfg.rssFallbackMinChars)parsed=rssRecord({ targetUrl, title, summary, method:'rss-summary-fallback' });
  if(!parsed)parsed={status:'error',url:targetUrl,final_url:'',title:'',description:'',author:'',published_at:'',content:'',content_chars:0,
    fetched_at:new Date().toISOString(),error:failures.join('；'),fetch_method:provider==='firecrawl'?'firecrawl-mcp':'auto'};
  parsed.title=parsed.title||title;
  return withQuality(parsed);
}

async function fetchSingleSource({store,hotspotId,url,hotspotTitle='',root,force,urlOverride,sourceFetch,toolContext,fetchImpl=fetchUrlContentImplementation}) {
  const targetUrl=urlOverride||url; if(!targetUrl)return null;
  // 编辑室粘贴的替代来源与热点原文不是同一 URL 时，写入独立缓存文件，
  // 避免覆盖按热点 ID 命名的原文缓存（成稿流水线只认原文缓存，URL 不一致会被拦截）。
  const isOverride=Boolean(urlOverride&&url&&urlOverride!==url);
  const cached=store.getHotspotSource(hotspotId);
  if(!force&&cached?.status==='ok'&&cached.url===targetUrl)return cached;
  const hotspot=hotspotId?store.getHotspot(hotspotId):null;
  const parsed=await fetchImpl({targetUrl,title:hotspotTitle,root,hotspot,sourceFetch,toolContext});
  const cachePath=path.join(root,'data','source-cache',isOverride?`${hotspotId}-override.json`:`${hotspotId}.json`);
  const record={...parsed,cache_path:cachePath}; writeJson(cachePath,record);
  return store.saveHotspotSource(hotspotId,record);
}

export async function fetchMaterialSourceImplementation({store,material,root,force=false,sourceFetch,toolContext,fetchImpl=fetchUrlContentImplementation}) {
  if(!material?.url)throw new Error('素材没有可抓取 URL');
  if(!force&&material.status==='ok'&&material.content_chars>0)return material;
  const parsed=await fetchImpl({targetUrl:material.url,title:material.title,root,sourceFetch,toolContext});
  const cachePath=path.join(root,'data','source-cache',`material-${material.id}.json`);
  writeJson(cachePath,{...parsed,material_id:material.id});
  return store.saveHotspotMaterialResult(material.id,{
    status:parsed.status==='ok'?'ok':'error',final_url:parsed.final_url||'',title:parsed.title||'',
    author:parsed.author||'',published_at:parsed.published_at||'',description:parsed.description||'',
    content:parsed.content||'',content_chars:Number(parsed.content_chars||String(parsed.content||'').length),
    fetched_at:parsed.fetched_at||new Date().toISOString(),error:parsed.error||'',fetch_method:parsed.fetch_method||'',
  });
}

// 编辑室粘贴的补充链接：缓存文件按候选与 URL 稳定命名，快照写入 candidate_sources（按候选+URL 覆盖），
// 由事实基座以「用户补充来源」分组读回，与热点原文缓存（成稿流水线只认原文缓存）隔离。
function overrideCacheName(candidateId, url) {
  let hash = 0;
  for (const ch of String(url)) hash = ((hash * 31 + ch.charCodeAt(0)) >>> 0);
  return `candidate-${candidateId}-override-${hash.toString(36)}.json`;
}

async function fetchCandidateOverride({store,candidateId,url,root,force,sourceFetch,toolContext,fetchImpl}) {
  const cached=store.listCandidateSources(candidateId).find((row)=>row.url===url);
  if(!force&&cached?.status==='ok')return cached;
  const parsed=await fetchImpl({targetUrl:url,title:'',root,hotspot:null,sourceFetch,toolContext});
  const cachePath=path.join(root,'data','source-cache',overrideCacheName(candidateId,url));
  const record={...parsed,url,cache_path:cachePath}; writeJson(cachePath,record);
  return store.saveCandidateSource(candidateId,record);
}

export async function fetchCandidateSourceImplementation({store,candidateId,root,force=false,urlOverride='',urlOverrides=null,hotspots=null,sourceFetch,toolContext,fetchImpl=fetchUrlContentImplementation}) {
  const candidate=store.getCandidate(candidateId); if(!candidate)throw new Error('候选不存在');
  const overrideList=[...new Set([...(Array.isArray(urlOverrides)?urlOverrides:[]),...(urlOverride?[urlOverride]:[])].map((u)=>String(u||'').trim()).filter(Boolean))];
  if (overrideList.length) {
    // 逐个串行抓取，单条失败不影响其余；返回逐条结果供路由拼提示
    const results=[];
    for(const url of overrideList) {
      try {
        const row=await fetchCandidateOverride({store,candidateId,url,root,force,sourceFetch,toolContext,fetchImpl});
        results.push({url,status:row?.status||'error',content_chars:row?.content_chars||0,error:row?.error||'',title:row?.title||''});
      } catch(error) {
        results.push({url,status:'error',content_chars:0,error:error.message,title:''});
      }
    }
    return { status: results.every((r)=>r.status==='ok')?'ok':results.some((r)=>r.status==='ok')?'partial':'error',
      content_chars: results.reduce((sum,r)=>sum+r.content_chars,0), count: results.length,
      ok: results.filter((r)=>r.status==='ok').length, errors: results.filter((r)=>r.status!=='ok').length,
      error: results.filter((r)=>r.status!=='ok').map((r)=>`${r.url}：${r.error||'抓取失败'}`).join('；'), results };
  }
  // hotspots 覆盖默认范围：选题与事件一对多、事件与热点原文一对多，调用方可传入事件维度整理好的热点列表
  const list=hotspots||(candidate.composite?candidate.hotspots||[]:null);
  if (list) {
    const allUrls=list.map(h=>({hotspotId:h.id,url:h.url,title:h.title}));
    const results=await Promise.allSettled(allUrls.map(({hotspotId,url,title})=>
      fetchSingleSource({store,hotspotId,url,hotspotTitle:title||'',root,force,sourceFetch,toolContext,fetchImpl})));
    const ok=results.filter(r=>r.status==='fulfilled'&&r.value?.status==='ok');
    const errors=results.filter(r=>r.status==='rejected');
    return {
      status: ok.length?'ok':errors.length?'error':'partial',
      content_chars: ok.reduce((sum,r)=>sum+(r.value?.content_chars||0),0),
      count: results.length, ok: ok.length, errors: errors.length,
      error: errors.length?`${errors.length} 个来源未能抓取`:'',
    };
  }
  const targetUrl=urlOverride||candidate.url; if(!targetUrl)throw new Error('候选没有可抓取 URL');
  return fetchSingleSource({store,hotspotId:candidate.hotspot_id,url:candidate.url,hotspotTitle:candidate.hotspot_title,root,force,urlOverride,sourceFetch,toolContext,fetchImpl});
}
