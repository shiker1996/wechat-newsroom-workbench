import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { failure, ok } from '../../lib/tools/schemas.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scripts = {
  mermaid:path.join(root, 'skills', 'mermaid-render', 'scripts', 'render-mermaid.mjs'),
  echarts:path.join(root, 'skills', 'wechat-echarts-blocks-to-images', 'scripts', 'render-echarts.mjs'),
};

export async function chartHealth(type) {
  return fs.existsSync(scripts[type]) ? ok({ available:true, script:scripts[type] }) : failure('DEPENDENCY_MISSING', `未找到 ${type} 渲染脚本`);
}

export async function executeChartScript(type, input, context = {}) {
  if (!fs.existsSync(scripts[type])) return failure('DEPENDENCY_MISSING', `未找到 ${type} 渲染脚本`);
  try {
    const args = [scripts[type], input.inputPath, input.outputPath, input.imageDir];
    if (input.tokensPath) args.push(input.tokensPath);
    const result = await run(process.execPath, args, {
      cwd:context.cwd || root, windowsHide:true, timeout:context.timeoutMs || 180000, maxBuffer:1_000_000,
    });
    const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    return ok(report, { artifacts:(report.images || []).map((item) => ({ type:'image/png', path:item })) });
  } catch (error) {
    let report;
    try { report = JSON.parse(String(error.stdout || error.message).trim().split(/\r?\n/).at(-1)); } catch {}
    return failure(/timeout/i.test(String(error.message)) ? 'TIMEOUT' : 'RENDER_FAILED',
      report?.failed?.map((item) => `第 ${item.index} 个围栏：${item.error}`).join('；') || report?.error || error.message,
      { retryable:/timeout/i.test(String(error.message)) });
  }
}
