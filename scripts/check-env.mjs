// 启动前环境检测：缺少必须依赖或配置时给出提示并以非零码退出。
// 硬性问题（阻断启动）标记 [错误]，可选问题（不阻断）标记 [警告]。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

// 1. Node.js 版本 >= 24（与 package.json engines 一致）
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  errors.push(`Node.js 需要 24 或更高版本，当前为 ${process.versions.node}。请升级 Node.js。`);
}

// 2. 依赖已安装
if (!fs.existsSync(path.join(root, 'node_modules', 'markdown-it'))) {
  errors.push('缺少 node_modules 依赖。请先在项目根目录运行: npm install');
}

// 3. 配置文件（存在时必须为合法 JSON）
const configPath = path.join(root, 'config.local.json');
if (fs.existsSync(configPath)) {
  try {
    JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    errors.push(`config.local.json 不是合法 JSON：${err.message}`);
  }
} else {
  warnings.push('未找到 config.local.json，将使用默认配置（端口 4317）。可参考 config.example.json 创建。');
}

// 4. .env 与 LLM API Key（至少配置一个 provider，否则 LLM 功能不可用）
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !line.trim().startsWith('#')) result[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return result;
}
const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  warnings.push('未找到 .env 文件。请复制 .env.example 为 .env 并至少填写一个 LLM API Key，否则成稿/排版功能不可用。');
} else {
  const env = readEnvFile(envPath);
  const keys = ['DEEPSEEK_API_KEY', 'MINIMAX_API_KEY', 'MOONSHOT_API_KEY'];
  const hasKey = keys.some((k) => (env[k] || process.env[k] || '').trim());
  if (!hasKey) {
    warnings.push(`.env 中未配置任何 LLM API Key（${keys.join(' / ')}），成稿等 AI 功能将不可用。`);
  }
}

// 5. RSSHub 目录（热点采集依赖；缺失不阻断启动）
if (!fs.existsSync(path.join(root, 'RSSHub', 'lib'))) {
  warnings.push('未找到 RSSHub 目录，热点采集功能不可用。如需该功能请恢复 RSSHub/ 目录。');
}

// 输出结果
for (const message of warnings) console.warn(`[警告] ${message}`);
if (errors.length > 0) {
  for (const message of errors) console.error(`[错误] ${message}`);
  console.error('\n环境检测未通过，请解决上述问题后重试。');
  process.exit(1);
}
console.log(`环境检测通过（${warnings.length} 条警告）。`);
