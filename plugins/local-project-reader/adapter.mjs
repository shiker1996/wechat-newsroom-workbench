import { readLocalProjectImplementation } from './implementation.mjs';
const ok=(context,data,extras)=>context.result?.ok(data,extras)||{status:'ok',data,artifacts:[],provenance:{},warnings:[],metrics:{durationMs:0},...extras};

export async function execute(input,context={}) {
  return ok(context,readLocalProjectImplementation(input.path, input.options), { provenance:{ root:input.path } });
}

export async function health(context={}) {
  return ok(context,{ available:true });
}
