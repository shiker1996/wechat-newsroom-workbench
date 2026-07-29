import { inspectRepository } from '../../lib/integrations/repository-inspector.mjs';
import { failure, ok } from '../../lib/tools/schemas.mjs';

export async function execute(input) {
  try{
    const data=await inspectRepository(input.sourceUrl,{cacheDir:input.cacheDir||null});
    return ok(data,{provenance:{sourceUrl:data.sourceUrl,checkedAt:data.stars?.checkedAt}});
  }catch(error){
    return failure('FETCH_FAILED',String(error.message||error),{retryable:/timeout|ECONNRESET|EAI_AGAIN/i.test(String(error.message))});
  }
}
export async function health(){return ok({available:true,provider:'github-rest'});}
