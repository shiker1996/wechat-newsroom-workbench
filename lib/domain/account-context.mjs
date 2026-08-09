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
    packagingModes: ['搜索型', '分享型', '双栖型', '推荐型', '通知型'],
    followReason: '关注后可获得持续的技术行业深度分析和独家观察视角',
    conversionBridge: '文末可承接课程推荐、行业报告或社群引流',
    distributionStrategy: {
      recommendation: {
        purpose: '拉新、分享、收藏与搜索长尾',
        preferredTopics: ['工具', '开源项目', '工程实践'],
        titleRule: '场景痛点 + 可信证据 + 可获得结果',
      },
      notification: {
        purpose: '维护存量读者与表达账号判断',
        preferredTopics: ['职场变化', '平台事件', '读者切身利益'],
        titleRule: '事件 + 对目标读者的直接影响',
      },
      experiment: {
        purpose: '验证新栏目、新角度和不确定需求',
        preferredTopics: ['新技术认知', '弱相关热点的新切口'],
        titleRule: '明确待验证的问题，不伪装成已确认需求',
      },
    },
    notificationPolicy: {
      minimumMatchedCriteria: 2,
      minimumNotificationFit: 4,
      minimumFactSupport: 4,
      maxPerBatch: 2,
      blockedRiskLevels: ['高', '较高'],
      readerStakes: ['工作', '收入', '岗位', '效率', '成本', '选择'],
      criteria: [
        '影响读者的工作或选择',
        '标题能说明为什么与读者有关',
        '除新闻复述外有明确判断或行动增量',
      ],
    },
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
  if (ctx.distributionStrategy && typeof ctx.distributionStrategy === 'object') {
    const laneNames = { recommendation: '推荐池', notification: '通知池', experiment: '实验池' };
    const lanes = Object.entries(ctx.distributionStrategy).map(([key, lane]) => {
      if (!lane || typeof lane !== 'object') return '';
      const lines = [`### ${laneNames[key] || key}`];
      if (lane.purpose) lines.push(`- 目标：${lane.purpose}`);
      if (Array.isArray(lane.preferredTopics) && lane.preferredTopics.length) lines.push(`- 优先内容：${lane.preferredTopics.join('、')}`);
      if (lane.titleRule) lines.push(`- 标题规则：${lane.titleRule}`);
      return lines.join('\n');
    }).filter(Boolean);
    if (lanes.length) parts.push(`\n## 分发策略\n${lanes.join('\n\n')}`);
  }
  if (ctx.notificationPolicy && typeof ctx.notificationPolicy === 'object') {
    const policy = ctx.notificationPolicy;
    const lines = [];
    if (Number.isFinite(Number(policy.minimumMatchedCriteria))) lines.push(`- 最少满足条件数：${Number(policy.minimumMatchedCriteria)}`);
    if (Number.isFinite(Number(policy.minimumNotificationFit))) lines.push(`- 最低通知适配分：${Number(policy.minimumNotificationFit)}/5`);
    if (Number.isFinite(Number(policy.minimumFactSupport))) lines.push(`- 最低事实支持分：${Number(policy.minimumFactSupport)}/5`);
    if (Number.isFinite(Number(policy.maxPerBatch))) lines.push(`- 每批通知池上限：${Number(policy.maxPerBatch)} 条（允许为空）`);
    if (Array.isArray(policy.blockedRiskLevels) && policy.blockedRiskLevels.length) lines.push(`- 禁止进入通知池的风险等级：${policy.blockedRiskLevels.join('、')}`);
    if (Array.isArray(policy.readerStakes) && policy.readerStakes.length) lines.push(`- 读者利益：${policy.readerStakes.join('、')}`);
    if (Array.isArray(policy.criteria) && policy.criteria.length) lines.push(...policy.criteria.map((item, index) => `${index + 1}. ${item}`));
    if (lines.length) parts.push(`\n## 通知资格\n${lines.join('\n')}`);
  }
  return parts.join('\n');
}

// Init on load
loadAccountContext();
