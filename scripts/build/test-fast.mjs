// 快速测试层：跳过浏览器渲染类测试（布局审计、ECharts、浏览器内联化），无需 Chromium。
import { spawn } from 'node:child_process';

const child = spawn(process.execPath,
  ['--disable-warning=ExperimentalWarning', '--test', 'test/**/*.test.mjs'],
  { env: { ...process.env, SKIP_BROWSER_TESTS: '1' }, stdio: 'inherit' });
child.once('exit', (code) => process.exit(code ?? 1));
