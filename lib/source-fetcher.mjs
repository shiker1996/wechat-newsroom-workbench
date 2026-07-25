import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { firecrawlScrape } from './firecrawl-mcp.mjs';

const execFileAsync=promisify(execFile);

function pythonCandidates() {
  const bundled=process.env.USERPROFILE?path.join(process.env.USERPROFILE,'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe'):'';
  return [process.env.WRITE_ASSISTANT_PYTHON,bundled&&fs.existsSync(bundled)?bundled:null,'py','python','python3'].filter(Boolean)
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

export async function fetchUrlContent({targetUrl,title='',root}) {
  const script=path.join(root,'scripts','fetch-hotspot-url.py');
  const provider=(process.env.SOURCE_FETCH_PROVIDER||'auto').toLowerCase(); let parsed; const failures=[];
  if(provider!=='python') {
    try { parsed=await firecrawlScrape(targetUrl); }
    catch(error) { failures.push(`Firecrawl MCP：${error.message}`); if(provider==='firecrawl')parsed=null; }
  }
  if(!parsed&&provider!=='firecrawl') {
    try {
      const {stdout}=await runPython(script,['--url',targetUrl,'--timeout','25','--max-chars','30000'],
        {cwd:root,windowsHide:true,timeout:35000,maxBuffer:5_000_000});
      parsed={...JSON.parse(stdout.trim()),fetch_method:failures.length?'python-fallback':'python'};
    } catch(error) { failures.push(`Python：${String(error.stderr||error.stdout||error.message).trim()}`); }
  }
  if(!parsed)parsed={status:'error',url:targetUrl,final_url:'',title:'',description:'',author:'',published_at:'',content:'',content_chars:0,
    fetched_at:new Date().toISOString(),error:failures.join('；'),fetch_method:provider==='firecrawl'?'firecrawl-mcp':'auto'};
  parsed.title=parsed.title||title;
  return parsed;
}

async function fetchSingleSource({store,hotspotId,url,hotspotTitle='',root,force,urlOverride}) {
  const targetUrl=urlOverride||url; if(!targetUrl)return null;
  // 编辑室粘贴的替代来源与热点原文不是同一 URL 时，写入独立缓存文件，
  // 避免覆盖按热点 ID 命名的原文缓存（成稿流水线只认原文缓存，URL 不一致会被拦截）。
  const isOverride=Boolean(urlOverride&&url&&urlOverride!==url);
  const cached=store.getHotspotSource(hotspotId);
  if(!force&&cached?.status==='ok'&&cached.url===targetUrl)return cached;
  const parsed=await fetchUrlContent({targetUrl,title:hotspotTitle,root});
  const cachePath=path.join(root,'data','source-cache',isOverride?`${hotspotId}-override.json`:`${hotspotId}.json`);
  const record={...parsed,cache_path:cachePath}; writeJson(cachePath,record);
  return store.saveHotspotSource(hotspotId,record);
}

export async function fetchMaterialSource({store,material,root,force=false}) {
  if(!material?.url)throw new Error('素材没有可抓取 URL');
  if(!force&&material.status==='ok'&&material.content_chars>0)return material;
  const parsed=await fetchUrlContent({targetUrl:material.url,title:material.title,root});
  const cachePath=path.join(root,'data','source-cache',`material-${material.id}.json`);
  writeJson(cachePath,{...parsed,material_id:material.id});
  return store.saveHotspotMaterialResult(material.id,{
    status:parsed.status==='ok'?'ok':'error',final_url:parsed.final_url||'',title:parsed.title||'',
    author:parsed.author||'',published_at:parsed.published_at||'',description:parsed.description||'',
    content:parsed.content||'',content_chars:Number(parsed.content_chars||String(parsed.content||'').length),
    fetched_at:parsed.fetched_at||new Date().toISOString(),error:parsed.error||'',fetch_method:parsed.fetch_method||'',
  });
}

export async function fetchCandidateSource({store,candidateId,root,force=false,urlOverride='',hotspots=null}) {
  const candidate=store.getCandidate(candidateId); if(!candidate)throw new Error('候选不存在');
  // hotspots 覆盖默认范围：选题与事件一对多、事件与热点原文一对多，调用方可传入事件维度整理好的热点列表
  const list=hotspots||(candidate.composite?candidate.hotspots||[]:null);
  if (list) {
    const allUrls=urlOverride?[{hotspotId:0,url:urlOverride}] : list.map(h=>({hotspotId:h.id,url:h.url,title:h.title}));
    const results=await Promise.allSettled(allUrls.map(({hotspotId,url,title})=>
      fetchSingleSource({store,hotspotId,url,hotspotTitle:title||'',root,force,urlOverride:hotspotId===0?urlOverride:''})));
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
  return fetchSingleSource({store,hotspotId:candidate.hotspot_id,url:candidate.url,hotspotTitle:candidate.hotspot_title,root,force,urlOverride});
}
