// 编辑室就绪判定：代码确定性校验 7 个表单项，替代模型自觉的状态声明。
// 编辑室只是辅助作者填表：必填项填好即可成稿，选填项不参与门禁。
// 设计见 docs/design/conversation-agent-form-unification-design.md。

// 占位符式搪塞值（"待定/未定/待确认"等）不算实质内容。
// 仅对短文本生效：长文本里"尚未完成"等是事实状态描述（如"交易尚未完成"），不能误判为占位符。
const PLACEHOLDER_PATTERN=/(?:待定|未定|待确认|待锁定|暂无|尚未|需作者|待作者|待主线|未明确|TBD)/i;
const PLACEHOLDER_MAX_LENGTH=30;
export function substantiveDecision(value){
  const text=String(value??'').trim();
  return Boolean(text)&&!(text.length<=PLACEHOLDER_MAX_LENGTH&&PLACEHOLDER_PATTERN.test(text));
}

// 编辑室表单项的唯一权威清单：scope 决定值从候选还是底稿会话读取。
// 顺序即依赖链（事实→观点→角度→命题→边界），模型按此顺序推进提问。
export const EDITORIAL_FIELDS=Object.freeze([
  {key:'confirmed_facts',label:'已确认事实',required:true,scope:'editorial'},
  {key:'author_opinions',label:'明确观点',required:true,scope:'editorial'},
  {key:'angle',label:'写作角度',required:true,scope:'candidate'},
  {key:'thesis',label:'锁定命题',required:true,scope:'candidate'},
  {key:'forbidden_claims',label:'禁止写入',required:true,scope:'editorial'},
  {key:'confirmed_experiences',label:'已确认实践',required:false,scope:'editorial'},
  {key:'rejected_angles',label:'否定角度/反证边界',required:false,scope:'editorial'},
]);

export function evaluateEditorialReadiness({candidate={},editorial={}}={}){
  const fields=EDITORIAL_FIELDS.map((field)=>{
    const source=field.scope==='candidate'?candidate:editorial;
    const value=String(source[field.key]??'').trim();
    return {...field,value,ok:substantiveDecision(value)};
  });
  const missing=fields.filter((field)=>field.required&&!field.ok).map((field)=>field.label);
  return {ready:missing.length===0,missing,fields};
}
