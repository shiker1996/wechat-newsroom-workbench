import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const fallback={ok:(data={},extras={})=>({status:'ok',data,artifacts:[],provenance:{},warnings:[],metrics:{durationMs:0},...extras}),failure:(code,message,options={})=>({status:'error',error:{code,message:String(message),retryable:Boolean(options.retryable)}})};

const run=promisify(execFile);
const script=fileURLToPath(new URL('./scripts/render-mermaid.mjs',import.meta.url));
export async function health(context={}){const {ok,failure}=context.result||fallback;return fs.existsSync(script)?ok({available:true}):failure('DEPENDENCY_MISSING','未找到 Mermaid 渲染脚本');}
export async function execute(input,context={}){
  const {ok,failure}=context.result||fallback;
  try{const args=[script,input.inputPath,input.outputPath,input.imageDir];if(input.tokensPath)args.push(input.tokensPath);const result=await run(process.execPath,args,{cwd:context.cwd||process.cwd(),windowsHide:true,timeout:context.timeoutMs||180000,maxBuffer:1_000_000});const report=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));return ok(report,{artifacts:(report.images||[]).map((item)=>({type:'image/png',path:item}))});}
  catch(error){let report;try{report=JSON.parse(String(error.stdout||error.message).trim().split(/\r?\n/).at(-1));}catch{}return failure(/timeout/i.test(String(error.message))?'TIMEOUT':'RENDER_FAILED',report?.failed?.map((item)=>`第 ${item.index} 个围栏：${item.error}`).join('；')||report?.error||error.message,{retryable:/timeout/i.test(String(error.message))});}
}
