import fs from 'node:fs';
import path from 'node:path';

function canonical(candidate) {
  let current=path.resolve(candidate);const missing=[];
  while(!fs.existsSync(current)){
    const parent=path.dirname(current);
    if(parent===current)break;
    missing.unshift(path.basename(current));current=parent;
  }
  const base=fs.existsSync(current)?fs.realpathSync.native(current):current;
  return path.resolve(base,...missing);
}

function inside(candidate, root) {
  const relative = path.relative(canonical(root), canonical(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function enforcePolicy(manifest, input, context = {}) {
  if (Array.isArray(context.allowedCapabilities) && !manifest.capabilities.some((capability)=>context.allowedCapabilities.includes(capability))) {
    return { code:'PERMISSION_DENIED', message:`技能未授权工具能力：${manifest.capabilities.join('、')}` };
  }
  if (manifest.riskLevel === 'external-write' && context.authorizedExternalWrite !== true) {
    return { code:'PERMISSION_DENIED', message:'此工具需要明确的外部写入授权' };
  }
  for (const field of manifest.pathInputs || []) {
    if (!input?.[field]) continue;
    const roots = Array.isArray(context.allowedRoots) ? context.allowedRoots.filter(Boolean) : [];
    if (!roots.length) return { code:'PERMISSION_DENIED', message:`未授权访问路径参数：${field}` };
    if (!roots.some((root) => inside(input[field], root))) {
      return { code:'PATH_OUTSIDE_ALLOWED_ROOTS', message:`路径超出授权目录：${input[field]}` };
    }
  }
  return null;
}
