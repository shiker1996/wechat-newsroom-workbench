export function stableArguments(value){
  const sort=(input)=>Array.isArray(input)?input.map(sort):input&&typeof input==='object'?Object.fromEntries(Object.keys(input).sort().map((key)=>[key,sort(input[key])])):input;
  return JSON.stringify(sort(value||{}));
}

export function toolCallFingerprint(request){return `${request.capability}:${stableArguments(request.arguments)}`;}

export function compactToolResult(result,maxChars=8000){
  const text=JSON.stringify(result);if(text.length<=maxChars)return result;
  if(result.status!=='ok')return result;
  const data={...result.data};
  for(const key of ['content','excerpt','answer','text'])if(typeof data[key]==='string'&&data[key].length>1000)data[key]=`${data[key].slice(0,1000)}…`;
  const compact={...result,data,truncated:true};
  const compactText=JSON.stringify(compact);return compactText.length<=maxChars?compact:{...compact,data:{summary:compactText.slice(0,Math.max(0,maxChars-300))+'…'},truncated:true};
}

