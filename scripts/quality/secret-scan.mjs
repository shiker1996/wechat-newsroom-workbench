// 秘密扫描：对全部 git 跟踪文件执行高危密钥模式匹配，CI 与提交前均可运行。
// 命中即非零退出。误报请优先调整代码写法（改用占位符），不要轻易加豁免。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const PATTERNS = [
  [/sk-[A-Za-z0-9_-]{20,}/g, 'OpenAI 风格 API Key'],
  [/ghp_[A-Za-z0-9]{30,}/g, 'GitHub Personal Access Token'],
  [/github_pat_[A-Za-z0-9_]{22,}/g, 'GitHub Fine-grained Token'],
  [/AIza[0-9A-Za-z_-]{35}/g, 'Google API Key'],
  [/tvly-[A-Za-z0-9_-]{20,}/g, 'Tavily API Key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'Slack Token'],
  [/AKIA[0-9A-Z]{16}/g, 'AWS Access Key ID'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, '私钥材料'],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'JWT'],
];

// 明显是占位符/文档示例的内容不告警
const PLACEHOLDER = /example|placeholder|sample|your[-_]?(key|token)|xxx|\.\.\./i;
const MAX_FILE_BYTES = 2_000_000;

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean);

const findings = [];
for (const file of files) {
  let text;
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_BYTES) continue;
    const buffer = fs.readFileSync(file);
    if (buffer.includes(0)) continue; // 二进制
    text = buffer.toString('utf8');
  } catch { continue; }
  for (const [pattern, label] of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const lineStart = text.lastIndexOf('\n', match.index) + 1;
      const line = text.slice(lineStart, text.indexOf('\n', match.index)).trim();
      if (PLACEHOLDER.test(line)) continue;
      const lineNumber = text.slice(0, match.index).split('\n').length;
      findings.push(`${file}:${lineNumber} 疑似${label}：${line.slice(0, 80)}`);
    }
  }
}

if (findings.length) {
  console.error(`秘密扫描命中 ${findings.length} 处：`);
  for (const item of findings) console.error(`  ${item}`);
  process.exit(1);
}
console.log(`秘密扫描通过：${files.length} 个跟踪文件无高危密钥模式`);
