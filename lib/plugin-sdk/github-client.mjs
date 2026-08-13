import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let health={status:'idle',authenticated:false,limit:null,remaining:null,resetAt:'',resource:'core',retryAfter:null,lastRequestAt:'',lastError:'',cacheHits:0,networkRequests:0};
function header(response,name){return response.headers?.get?.(name)??null;}
function updateHealth(response,authenticated){const reset=Number(header(response,'x-ratelimit-reset'));health={...health,status:response.ok||response.status===304?'ok':'degraded',authenticated,limit:Number(header(response,'x-ratelimit-limit'))||health.limit,remaining:Number(header(response,'x-ratelimit-remaining'))||0,resetAt:Number.isFinite(reset)&&reset>0?new Date(reset*1000).toISOString():health.resetAt,resource:header(response,'x-ratelimit-resource')||health.resource,retryAfter:Number(header(response,'retry-after'))||null,lastRequestAt:new Date().toISOString(),lastError:response.ok||response.status===304?'':`HTTP ${response.status}`,networkRequests:health.networkRequests+1};}
function cacheFile(cacheDir,apiPath){return path.join(cacheDir,`${crypto.createHash('sha256').update(apiPath).digest('hex')}.json`);}
function readCache(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function writeCache(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.tmp`;fs.writeFileSync(temp,JSON.stringify(value),'utf8');fs.renameSync(temp,file);}
const delay=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

export async function requestGitHubJson(apiPath,{fetchImpl=fetch,token=process.env.GITHUB_ACCESS_TOKEN,cacheDir=null,ttlMs=15*60*1000,optional=false}={}){
  const authenticated=Boolean(token);const file=cacheDir?cacheFile(cacheDir,apiPath):null;const cached=file?readCache(file):null;
  if(cached&&Date.now()-Date.parse(cached.fetchedAt)<ttlMs){health={...health,status:'ok',authenticated,cacheHits:health.cacheHits+1};return cached.data;}
  const headers={'accept':'application/vnd.github+json','user-agent':'write-assistant/0.1','x-github-api-version':'2022-11-28'};if(token)headers.authorization=`Bearer ${token}`;if(cached?.etag)headers['if-none-match']=cached.etag;
  let lastError;
  for(let attempt=0;attempt<2;attempt+=1){try{const response=await fetchImpl(`https://api.github.com${apiPath}`,{headers,signal:AbortSignal.timeout(15000)});updateHealth(response,authenticated);
      if(response.status===304&&cached){health.cacheHits+=1;writeCache(file,{...cached,fetchedAt:new Date().toISOString()});return cached.data;}
      if(optional&&response.status===404)return null;
      if(response.ok){const data=await response.json();if(file)writeCache(file,{etag:header(response,'etag')||'',fetchedAt:new Date().toISOString(),data});return data;}
      const message=`GitHub API ${response.status}: ${(await response.text()).slice(0,240)}`;lastError=new Error(message);const retryAfter=Number(header(response,'retry-after'))||0;if(attempt===0&&((response.status>=500)||(response.status===429&&retryAfter<=2))){await delay(Math.max(300,retryAfter*1000));continue;}throw lastError;
    }catch(error){lastError=error;if(attempt===0&&cached){health={...health,status:'degraded',lastError:error.message,cacheHits:health.cacheHits+1};return cached.data;}if(attempt===0){await delay(300);continue;}}
  }
  health={...health,status:'failed',lastError:lastError?.message||'GitHub API 璇锋眰澶辫触'};throw lastError;
}

export function getGitHubApiHealth(){return {...health};}


