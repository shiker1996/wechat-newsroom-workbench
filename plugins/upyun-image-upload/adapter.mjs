import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const fallback={ok:(data={},extras={})=>({status:'ok',data,artifacts:[],provenance:{},warnings:[],metrics:{durationMs:0},...extras}),failure:(code,message,options={})=>({status:'error',error:{code,message:String(message),retryable:Boolean(options.retryable),...(options.action?{action:options.action}:{})}})};

const run = promisify(execFile);
const script = fileURLToPath(new URL('./scripts/upyun-upload-image.mjs', import.meta.url));
const pluginRoot = path.dirname(fileURLToPath(import.meta.url));

export async function health(context={}) {
  const {failure,ok}=context.result||fallback;
  if(!context.configuration?.bucket||!context.configuration?.operator||!context.configuration?.password)return failure('DEPENDENCY_MISSING','又拍云上传配置尚未完成',{action:'前往系统与配置中心完成又拍云图片上传配置'});
  return fs.existsSync(script)
    ? ok({ available:true })
    : failure('DEPENDENCY_MISSING', '未安装 upyun-upload-image 技能', { action:'安装并配置 upyun-upload-image 技能' });
}

export async function execute(input, context = {}) {
  const {failure,ok}=context.result||fallback;
  if (!fs.existsSync(input.localPath)) return failure('INVALID_INPUT', '本地图片不存在');
  if (!fs.existsSync(script)) return failure('DEPENDENCY_MISSING', '未安装 upyun-upload-image 技能');
  try {
    const configuration=context.configuration||{};const args=[script,input.localPath,'--bucket',configuration.bucket,'--operator',configuration.operator,'--password',configuration.password,'--domain',configuration.domain||'img.shiker.tech','--prefix',configuration.prefix||'weedit'];const { stdout } = await run(process.execPath, args, {
      cwd:pluginRoot, windowsHide:true, timeout:context.timeoutMs || 120000, maxBuffer:1_000_000,
    });
    const result = JSON.parse(String(stdout).trim().split(/\r?\n/).at(-1));
    if (!result.success || !/^https:\/\//i.test(result.data?.url || '') || !result.data?.key) {
      return failure('UPLOAD_FAILED', result.message || 'CDN 上传未返回有效 HTTPS URL');
    }
    return ok({ url:result.data.url, key:result.data.key }, {
      artifacts:[{ type:'image', url:result.data.url, key:result.data.key }],
      provenance:{ provider:'upyun', uploadedAt:new Date().toISOString() },
    });
  } catch (error) {
    return failure(/timeout/i.test(String(error.message)) ? 'TIMEOUT' : 'UPLOAD_FAILED',
      String(error.stdout || error.stderr || error.message).trim(), { retryable:/timeout/i.test(String(error.message)) });
  }
}
