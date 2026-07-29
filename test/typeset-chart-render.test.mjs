import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MERMAID_SCRIPT = path.resolve('skills/mermaid-render/scripts/render-mermaid.mjs');
const ECHARTS_SCRIPT = path.resolve('skills/wechat-echarts-blocks-to-images/scripts/render-echarts.mjs');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-render-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('mermaid 围栏渲染为 PNG 并替换为图片引用', { timeout: 120000 }, async (t) => {
  const dir = tempDir(t);
  const input = path.join(dir, 'in.md');
  const output = path.join(dir, 'out.md');
  fs.writeFileSync(input, '# 测试\n\n正文。\n\n```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```\n\n尾部。\n', 'utf8');
  const { stdout } = await execFileAsync(process.execPath, [MERMAID_SCRIPT, input, output], { windowsHide: true, timeout: 120000 });
  const report = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(report.converted, 1);
  assert.deepEqual(report.failed, []);
  const result = fs.readFileSync(output, 'utf8');
  assert.match(result, /!\[mermaid-1\]\(images\/mermaid-1\.png\)/);
  assert.doesNotMatch(result, /```mermaid/);
  assert.match(result, /正文。/);
  assert.match(result, /尾部。/);
  const png = path.join(dir, 'images', 'mermaid-1.png');
  assert.ok(fs.existsSync(png) && fs.statSync(png).size > 0, 'PNG 产物存在且非空');
});

test('mermaid 语法错误时保留原围栏并报告失败', { timeout: 120000 }, async (t) => {
  const dir = tempDir(t);
  const input = path.join(dir, 'in.md');
  const output = path.join(dir, 'out.md');
  fs.writeFileSync(input, '# 测试\n\n```mermaid\n这不是合法的 mermaid 语法 {{{\n```\n', 'utf8');
  await assert.rejects(
    execFileAsync(process.execPath, [MERMAID_SCRIPT, input, output], { windowsHide: true, timeout: 120000 }),
    (error) => {
      const report = JSON.parse(String(error.stdout).trim().split(/\r?\n/).at(-1));
      assert.equal(report.converted, 0);
      assert.equal(report.failed.length, 1);
      return true;
    },
  );
  assert.match(fs.readFileSync(output, 'utf8'), /```mermaid/);
});

test('echarts 围栏渲染为 PNG 并替换为图片引用', { timeout: 120000 }, async (t) => {
  const dir = tempDir(t);
  const input = path.join(dir, 'in.md');
  const output = path.join(dir, 'out.md');
  const option = { xAxis: { type: 'category', data: ['一', '二'] }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [3, 7] }] };
  fs.writeFileSync(input, `# 测试\n\n\`\`\`echarts\n${JSON.stringify(option)}\n\`\`\`\n`, 'utf8');
  const { stdout } = await execFileAsync(process.execPath, [ECHARTS_SCRIPT, input, output], { windowsHide: true, timeout: 120000 });
  const report = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(report.converted, 1);
  assert.deepEqual(report.failed, []);
  const result = fs.readFileSync(output, 'utf8');
  assert.match(result, /!\[echarts-1\]\(images\/echarts-1\.png\)/);
  assert.doesNotMatch(result, /```echarts/);
  const png = path.join(dir, 'images', 'echarts-1.png');
  assert.ok(fs.existsSync(png) && fs.statSync(png).size > 0, 'PNG 产物存在且非空');
});

test('echarts 非 JSON 配置被拒绝并保留围栏', { timeout: 120000 }, async (t) => {
  const dir = tempDir(t);
  const input = path.join(dir, 'in.md');
  const output = path.join(dir, 'out.md');
  fs.writeFileSync(input, '# 测试\n\n```echarts\noption = { malicious: alert(1) }\n```\n', 'utf8');
  await assert.rejects(
    execFileAsync(process.execPath, [ECHARTS_SCRIPT, input, output], { windowsHide: true, timeout: 120000 }),
    (error) => {
      const report = JSON.parse(String(error.stdout).trim().split(/\r?\n/).at(-1));
      assert.equal(report.converted, 0);
      assert.equal(report.failed.length, 1);
      return true;
    },
  );
  assert.match(fs.readFileSync(output, 'utf8'), /```echarts/);
});

test('没有图表围栏时原样输出并报告 converted 0', { timeout: 60000 }, async (t) => {
  const dir = tempDir(t);
  for (const script of [MERMAID_SCRIPT, ECHARTS_SCRIPT]) {
    const input = path.join(dir, `plain-${path.basename(script)}.md`);
    const output = path.join(dir, `plain-${path.basename(script)}.out.md`);
    fs.writeFileSync(input, '# 测试\n\n只有正文。\n', 'utf8');
    const { stdout } = await execFileAsync(process.execPath, [script, input, output], { windowsHide: true, timeout: 60000 });
    const report = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(report.converted, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), '# 测试\n\n只有正文。\n');
  }
});
