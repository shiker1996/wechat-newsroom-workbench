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

function messageCapability(message){
  if(message?.role!=='tool')return '';
  try{
    const parsed=JSON.parse(String(message.content||''));
    const first=Array.isArray(parsed)?parsed[0]:parsed;
    return String(first?.capability||'');
  }catch{return '';}
}

function messageSize(message){return JSON.stringify(message||{}).length;}

function compactToolMessage(message,maxChars){
  if(message?.role!=='tool'||messageSize(message)<=maxChars)return message;
  try{
    const parsed=JSON.parse(String(message.content||''));
    const results=Array.isArray(parsed)?parsed:[parsed];
    const compacted=results.map((result)=>compactToolResult(result,Math.max(256,Math.floor(maxChars/results.length))));
    return {...message,content:JSON.stringify(compacted),contextCompacted:true};
  }catch{return {...message,content:String(message.content||'').slice(0,Math.max(0,maxChars-120))+'…',contextCompacted:true};}
}

// 保留初始任务、首次项目读取和最近审计，压缩旧的重复工具轮次，避免历史消息随 Agent 步骤线性膨胀。
export function compactAgentHistory(messages,maxChars=120000){
  const source=Array.isArray(messages)?messages:[];
  if(source.length<3||source.reduce((sum,message)=>sum+messageSize(message),0)<=maxChars)return source;
  const keep=new Set();
  let firstTool=-1;
  for(let index=0;index<source.length;index+=1){
    if(source[index]?.role==='tool'){firstTool=index;break;}
    if(source[index]?.role==='system'||source[index]?.role==='user')keep.add(index);
  }
  const projectRead=source.findIndex((message)=>messageCapability(message)==='filesystem.project.read');
  if(projectRead>=0)keep.add(projectRead);
  const latestTool=[...source.keys()].reverse().find((index)=>source[index]?.role==='tool');
  if(latestTool!==undefined){keep.add(latestTool);const previous=latestTool-1;if(previous>=0&&source[previous]?.role==='assistant')keep.add(previous);}
  if(firstTool<0){for(let index=Math.max(0,source.length-2);index<source.length;index+=1)keep.add(index);}
  const selected=[...keep].sort((a,b)=>a-b).map((index)=>source[index]);
  const omitted=source.length-selected.length;
  const notice={role:'system',protected:true,content:`[上下文压缩] 已省略 ${omitted} 条旧的重复 Agent 消息；保留初始任务、项目事实读取和最近一次工具结果。`};
  const available=Math.max(1024,maxChars-messageSize(notice));
  let remaining=available;
  const compacted=selected.map((message)=>{
    const allowance=Math.max(256,Math.floor(available/Math.max(1,selected.length)));
    const result=message?.role==='tool'?compactToolMessage(message,Math.max(allowance,Math.min(70000,remaining))):message;
    remaining-=messageSize(result);
    return result;
  });
  return [...compacted.slice(0,Math.max(0,compacted.length-1)),notice,compacted[compacted.length-1]].filter(Boolean);
}
