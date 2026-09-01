// 编辑室就绪判定：代码确定性校验 8 个表单项，替代模型自觉的状态声明。
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

const GENERIC_FACTS_PATTERN=/^(?:已确认(?:该事件)?的?(?:事实|事实链条)|事实链条|已确认事实|见上文|同上)[。；：:\s]*$/u;
const RESEARCH_SIGNAL_PATTERN=/(?:反常|异常|矛盾|冲突|利益|成本|责任|发散|前后|回应|对比|趋势|连续|变化|差异|突变|越界|失效|配置错误|奖励破解)/u;
const RESEARCH_ANCHOR_PATTERN=/(?:事件|报道|来源|两起|多起|同一|[0-9]{1,4}\s*[年月日./-]|[0-9]+\s*[·.]\s*[0-9]+)/u;

// 研判主线必须能回指具体事件或来源，并明确落在哪类研判关系上，
// 防止“已融入某维度”“关注影响”这类看似填写、实际无法指导写作的空话通过门禁。
export function researchBasisDecision(value){
  const text=String(value??'').trim();
  return substantiveDecision(text)&&RESEARCH_SIGNAL_PATTERN.test(text)&&RESEARCH_ANCHOR_PATTERN.test(text);
}

export function confirmedFactsDecision(value){
  const text=String(value??'').trim();
  return substantiveDecision(text)&&!GENERIC_FACTS_PATTERN.test(text);
}

// 编辑室表单项的唯一权威清单：scope 决定值从候选还是底稿会话读取。
// 顺序即依赖链（事实→研判主线→观点→角度→命题→边界），模型按此顺序推进提问。
export const EDITORIAL_FIELDS=Object.freeze([
  {key:'confirmed_facts',label:'已确认事实',required:true,scope:'editorial'},
  {key:'research_basis',label:'采用的研判主线',required:true,scope:'editorial'},
  {key:'author_opinions',label:'明确观点',required:true,scope:'editorial'},
  {key:'angle',label:'写作角度',required:true,scope:'candidate'},
  {key:'thesis',label:'锁定命题',required:true,scope:'candidate'},
  // 没有额外禁写项时，空值本身就是明确边界；若填写内容仍需通过实质性校验。
  {key:'forbidden_claims',label:'禁止写入',required:true,allowEmpty:true,scope:'editorial'},
  {key:'confirmed_experiences',label:'已确认实践',required:false,scope:'editorial'},
  {key:'rejected_angles',label:'否定角度/反证边界',required:false,scope:'editorial'},
]);

export function editorialFieldComplete(field,value){
  if(field.key==='research_basis')return researchBasisDecision(value);
  if(field.key==='confirmed_facts')return confirmedFactsDecision(value);
  return field.allowEmpty&&!String(value??'').trim()||substantiveDecision(value);
}

export function evaluateEditorialReadiness({candidate={},editorial={}}={}){
  const fields=EDITORIAL_FIELDS.map((field)=>{
    const source=field.scope==='candidate'?candidate:editorial;
    const value=String(source[field.key]??'').trim();
    return {...field,value,ok:editorialFieldComplete(field,value)};
  });
  const missing=fields.filter((field)=>field.required&&!field.ok).map((field)=>field.label);
  return {ready:missing.length===0,missing,fields};
}
