const ALLOWED_TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array']);
const ALLOWED_FORMATS = new Set(['text', 'textarea', 'password', 'url', 'select']);

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function issue(field, message) { return { field, level:'error', message }; }

export function validateConfigurationSchema(schema, { field = 'configuration', root = true } = {}) {
  const issues=[];
  if (!plainObject(schema)) return [issue(field, `${field} 必须是对象 Schema`)];
  if (!ALLOWED_TYPES.has(schema.type)) issues.push(issue(`${field}.type`, '配置字段类型不受支持'));
  if (root && schema.type !== 'object') issues.push(issue(`${field}.type`, '配置根节点必须是 object'));
  const allowed=new Set(['type','title','description','default','enum','enumNames','format','secret','readOnly','properties','required','items','minimum','maximum','minLength','maxLength','pattern','additionalProperties']);
  for (const key of Object.keys(schema)) if (!allowed.has(key)) issues.push(issue(`${field}.${key}`, '配置 Schema 包含不受支持的关键字'));
  if (schema.format !== undefined && !ALLOWED_FORMATS.has(schema.format)) issues.push(issue(`${field}.format`, '配置字段 format 不受支持'));
  if (schema.secret !== undefined && typeof schema.secret !== 'boolean') issues.push(issue(`${field}.secret`, 'secret 必须是布尔值'));
  if (schema.secret && schema.type !== 'string') issues.push(issue(`${field}.secret`, '秘密字段必须是 string'));
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) issues.push(issue(`${field}.enum`, 'enum 必须是非空数组'));
  if (schema.enumNames !== undefined && (!Array.isArray(schema.enumNames) || schema.enumNames.length !== schema.enum?.length)) issues.push(issue(`${field}.enumNames`, 'enumNames 必须与 enum 等长'));
  if (schema.type === 'object') {
    if (!plainObject(schema.properties)) issues.push(issue(`${field}.properties`, 'object 必须声明 properties'));
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) issues.push(issue(`${field}.additionalProperties`, '动态配置禁止未声明字段'));
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((key)=>typeof key !== 'string'))) issues.push(issue(`${field}.required`, 'required 必须是字段名数组'));
    for (const key of schema.required || []) if (!schema.properties?.[key]) issues.push(issue(`${field}.required`, `必填字段不存在：${key}`));
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) issues.push(issue(`${field}.properties.${key}`, '字段名无效'));
      issues.push(...validateConfigurationSchema(child,{field:`${field}.properties.${key}`,root:false}));
    }
  }
  if (schema.type === 'array') {
    if (!plainObject(schema.items) || !['string','number','integer','boolean'].includes(schema.items?.type)) issues.push(issue(`${field}.items`, '数组只支持标量 items'));
    else issues.push(...validateConfigurationSchema(schema.items,{field:`${field}.items`,root:false}));
  }
  return issues;
}

function empty(value) { return value === undefined || value === null || value === ''; }

export function validateConfigurationValue(schema, value, field = 'configuration') {
  const issues=[];
  if (schema.type === 'object') {
    if (!plainObject(value)) return [issue(field, '配置值必须是对象')];
    for (const key of schema.required || []) if (empty(value[key])) issues.push(issue(`${field}.${key}`, '此项为必填项'));
    for (const key of Object.keys(value)) if (!schema.properties?.[key]) issues.push(issue(`${field}.${key}`, '不允许未声明的配置项'));
    for (const [key, child] of Object.entries(schema.properties || {})) if (!empty(value[key])) issues.push(...validateConfigurationValue(child,value[key],`${field}.${key}`));
    return issues;
  }
  if (schema.type === 'string' && typeof value !== 'string') issues.push(issue(field,'必须是字符串'));
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) issues.push(issue(field,'必须是数字'));
  if (schema.type === 'integer' && !Number.isInteger(value)) issues.push(issue(field,'必须是整数'));
  if (schema.type === 'boolean' && typeof value !== 'boolean') issues.push(issue(field,'必须是布尔值'));
  if (schema.type === 'array' && !Array.isArray(value)) issues.push(issue(field,'必须是数组'));
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) issues.push(issue(field,'值不在允许范围内'));
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push(issue(field,`长度不能少于 ${schema.minLength}`));
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(issue(field,`长度不能超过 ${schema.maxLength}`));
    if (schema.pattern) { try { if (!new RegExp(schema.pattern).test(value)) issues.push(issue(field,'格式不正确')); } catch { issues.push(issue(field,'Schema pattern 无效')); } }
    if (schema.format === 'url') { try { const url=new URL(value); if (!['http:','https:'].includes(url.protocol)) throw new Error(); } catch { issues.push(issue(field,'请输入有效的 HTTP/HTTPS URL')); } }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(issue(field,`不能小于 ${schema.minimum}`));
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(issue(field,`不能大于 ${schema.maximum}`));
  }
  if (Array.isArray(value)) for (let index=0; index<value.length; index+=1) issues.push(...validateConfigurationValue(schema.items,value[index],`${field}[${index}]`));
  return issues;
}

export function schemaDefaults(schema) {
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).flatMap(([key,child])=>{
    const value=schemaDefaults(child); return value === undefined ? [] : [[key,value]];
  }));
  return undefined;
}

export function secretFields(schema) {
  return Object.entries(schema?.properties || {}).filter(([,rule])=>rule.secret === true || rule.format === 'password').map(([key])=>key);
}
