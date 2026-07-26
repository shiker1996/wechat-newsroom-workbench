/**
 * 账号上下文管理
 * 定义公众号的定位、读者群体、内容支柱、风格约束和转化承接。
 * 由编辑室和成稿流程读取，注入到 AI 上下文中。
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CONTEXT_FILE = path.join(process.cwd(), 'account-context.json');

let cached = null;

function getDefaults() {
  return {
    name: '我的公众号',
    description: '科技行业观察与深度分析',
    readerProfile: '技术从业者、产品经理、科技行业观察者',
    contentPillars: ['AI/技术动态', '大厂战略分析', '行业深度', '职场与成长'],
    voiceGuardrails: [
      '不写标题党，不夸大事实',
      '保持客观中立的分析立场',
      '有信息增量，不重复已知结论',
    ],
    packagingModes: ['搜索型', '分享型'],
    followReason: '关注后可获得持续的技术行业深度分析和独家观察视角',
    conversionBridge: '文末可承接课程推荐、行业报告或社群引流',
  };
}

export function loadAccountContext(filePath = DEFAULT_CONTEXT_FILE) {
  if (fs.existsSync(filePath)) {
    try {
      cached = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return cached;
    } catch (e) {
      // fall through to defaults
    }
  }
  cached = getDefaults();
  return cached;
}

export function getAccountContext() {
  if (!cached) return loadAccountContext();
  return cached;
}

export function formatAccountContext() {
  const ctx = getAccountContext();
  const parts = [];
  if (ctx.name) parts.push(`## 账号信息\n- 名称：${ctx.name}`);
  if (ctx.description) parts.push(`- 简介：${ctx.description}`);
  if (ctx.readerProfile) parts.push(`- 核心读者：${ctx.readerProfile}`);
  if (ctx.contentPillars?.length) parts.push(`\n## 内容支柱\n${ctx.contentPillars.map((p, i) => `${i + 1}. ${p}`).join('\n')}`);
  if (ctx.voiceGuardrails?.length) parts.push(`\n## 风格约束\n${ctx.voiceGuardrails.map((g) => `- ${g}`).join('\n')}`);
  if (ctx.packagingModes?.length) parts.push(`\n## 包装模式\n可用模式：${ctx.packagingModes.join('、')}。搜索型优先使用真实主体和事件词，分享型突出冲突和切身影响。`);
  if (ctx.followReason) parts.push(`\n## 关注理由\n${ctx.followReason}`);
  if (ctx.conversionBridge) parts.push(`\n## 转化承接\n${ctx.conversionBridge}`);
  if (ctx.differentiators?.length) parts.push(`\n## 差异化定位\n${ctx.differentiators.map((d) => `- ${d}`).join('\n')}`);
  if (ctx.articleFramework?.length) parts.push(`\n## 习惯文章结构\n${ctx.articleFramework.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  if (ctx.contentRatio && typeof ctx.contentRatio === 'object') parts.push(`\n## 内容配比\n${Object.entries(ctx.contentRatio).map(([k, v]) => `- ${k}：约 ${v}`).join('\n')}`);
  return parts.join('\n');
}

// Init on load
loadAccountContext();
