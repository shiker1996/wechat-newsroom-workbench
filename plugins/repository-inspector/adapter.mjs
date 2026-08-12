import { inspectRepository } from './implementation.mjs';
import { failure, ok } from '../shared/schemas.mjs';

export async function execute(input,context={}) {
  try{
    const data=await inspectRepository(input.sourceUrl,{cacheDir:input.cacheDir||null,token:context.configuration?.token||''});
    return ok(data,{provenance:{sourceUrl:data.sourceUrl,checkedAt:data.stars?.checkedAt}});
  }catch(error){
    return failure('FETCH_FAILED',String(error.message||error),{retryable:/timeout|ECONNRESET|EAI_AGAIN/i.test(String(error.message))});
  }
}
export async function health(){return ok({available:true,provider:'github-rest'});}
