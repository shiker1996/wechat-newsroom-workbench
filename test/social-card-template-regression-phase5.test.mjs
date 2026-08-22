import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderStoryboardHtml } from '../lib/llm/social-card-pipeline.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const auditScript = path.join(root, 'skills', 'xiaohongshu-article-generator', 'scripts', 'layout-audit.mjs');

function sharedRepositoryPlan() {
  return [
    { kind: 'cover', role: 'cover', title: 'Stop Pay Bilibili：工具说明', lead: '把仓库能力、上手步骤和使用边界整理成一组可读卡片。' },
    { kind: 'content', role: 'concept', title: '为什么需要它', content_blocks: [
      { type: 'text', title: '背景', content: '项目把停止自动续费的操作路径整理成可检查的流程，重点是减少误操作并保留人工确认。' },
      { type: 'list', title: '核心判断', items: ['先确认账户与订单状态', '再执行取消或停止操作', '最后检查结果是否生效', '保留必要的来源和边界说明'] },
    ] },
    { kind: 'content', role: 'feature', title: '能力与使用方式', content_blocks: [
      { type: 'list', title: '主要能力', items: ['展示当前可处理的支付项目', '按步骤引导完成停止操作', '把验证结果留在页面上下文中', '遇到异常时保留人工处理入口', '不把未知状态写成成功'] },
      { type: 'note', title: '适合谁', content: '适合希望先看清操作边界，再自行确认每一步的用户。' },
    ] },
    { kind: 'content', role: 'steps', title: '三步完成检查', page_group_id: 'steps-story', continuation_of: 4, continuation_index: 1, content_blocks: [
      { type: 'steps', title: '操作步骤', items: [{ title: '打开项目', content: '阅读说明并确认当前环境满足要求。' }, { title: '执行操作', content: '按页面提示完成停止或取消动作。' }, { title: '检查结果', content: '回到订单或账户页面确认状态已更新。' }] },
      { type: 'code', title: '启动命令', content: 'npm install\nnpm run start' },
    ] },
    { kind: 'content', role: 'steps', title: '三步完成检查（续）', page_group_id: 'steps-story', continuation_of: 4, continuation_index: 2, content_blocks: [
      { type: 'list', title: '验证与边界', items: ['页面状态应与账户状态一致', '网络异常时不要重复提交', '无法确认时回到人工入口处理'] },
      { type: 'note', title: '不要忽略', content: '停止操作只代表流程完成，不等于对历史订单或退款结果作出承诺。' },
    ] },
    { kind: 'content', role: 'risk', title: '使用边界', content_blocks: [
      { type: 'list', title: '需要留意', items: ['权限不足时应停止继续操作', '远程服务异常时保留当前页面证据', '不要把模型建议当成账户最终状态', '涉及扣款争议时仍需联系平台处理'] },
      { type: 'note', title: '事实边界', content: '本文只依据仓库公开说明整理操作路径，不替代平台的订单记录和客服结论。' },
    ] },
    { kind: 'ending', role: 'ending', title: '先确认，再操作', content_blocks: [{ type: 'text', title: '最后检查', content: '完成后回到原页面确认状态，并保留必要的操作记录。' }] },
  ];
}

test('阶段 4 同一仓库故事板在四个内置模板下通过真实浏览器硬布局审计', async (t) => {
  if (process.env.SKIP_BROWSER_TESTS === '1') return t.skip('SKIP_BROWSER_TESTS=1');
  const cases = [
    ['clean-v1', 'ice-blue'],
    ['neon-v1', 'neon'],
    ['brutalist-v1', 'brutalist'],
    ['editorial-v1', 'paper-craft'],
  ];
  const results = [];
  for (const [template, visualStyle] of cases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `social-card-template-regression-${template}-`));
    try {
      const htmlPath = path.join(dir, 'design.html');
      const reportPath = path.join(dir, 'report.json');
      const html = renderStoryboardHtml({ topic: 'Stop Pay Bilibili', repository: 'shiker1996/stop-pay-bilibili', visualStyle, channelMode: 'xiaohongshu', pages: sharedRepositoryPlan() });
      assert.match(html, new RegExp(`data-template-pack="${template}"`));
      assert.match(html, /class="continuation-badge"/);
      fs.writeFileSync(htmlPath, html, 'utf8');
      await execFileAsync(process.execPath, [auditScript, htmlPath, '--json', reportPath], { cwd: dir, windowsHide: true }).catch(() => {});
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      const hardIssues = report.pages.flatMap((page) => (page.issues || []).filter((issue) => ['overflow', 'clipped', 'horizontal_overflow', 'text_too_small', 'invalid_page_grid_structure', 'missing_content_stack', 'empty_page_body'].includes(issue)).map((issue) => `P${page.page}:${issue}`));
      results.push({ template, report, hardIssues });
      assert.deepEqual(hardIssues, [], `${template} 存在硬布局问题：${JSON.stringify(report.pages)}`);
      assert.equal(report.valid, true, `${template} 未通过布局审计：${JSON.stringify(report.pages)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  assert.equal(results.length, 4);
});
