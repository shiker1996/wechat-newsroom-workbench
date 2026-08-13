import { inspectRepository } from './implementation.mjs';
const fallback={ok:(data={},extras={})=>({status:'ok',data,artifacts:[],provenance:{},warnings:[],metrics:{durationMs:0},...extras}),failure:(code,message,options={})=>({status:'error',error:{code,message:String(message),retryable:Boolean(options.retryable)}})};

export async function execute(input,context={}) {
  const {failure,ok}=context.result||fallback;
  try{
    const data=await inspectRepository(input.sourceUrl,{cacheDir:input.cacheDir||null,token:context.configuration?.token||'',requestGitHubJson:context.github?.requestGitHubJson});
    return ok(data,{provenance:{sourceUrl:data.sourceUrl,checkedAt:data.stars?.checkedAt}});
  }catch(error){
    return failure('FETCH_FAILED',String(error.message||error),{retryable:/timeout|ECONNRESET|EAI_AGAIN/i.test(String(error.message))});
  }
}
export async function health(context={}){return (context.result||fallback).ok({available:true,provider:'github-rest'});}
