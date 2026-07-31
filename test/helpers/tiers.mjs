// 测试分层标记。浏览器渲染类测试依赖 Puppeteer Chromium（布局审计、ECharts、浏览器内联化）。
// 设置 SKIP_BROWSER_TESTS=1 时跳过（npm run test:fast、无浏览器的 CI 环境）。
export const SKIP_BROWSER = process.env.SKIP_BROWSER_TESTS === '1';

export function skipBrowser(t) {
  if (!SKIP_BROWSER) return false;
  t.skip('浏览器渲染测试（SKIP_BROWSER_TESTS=1）');
  return true;
}
