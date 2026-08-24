import { SOCIAL_CARD_PAGE_ROLES } from './social-card-role.mjs';

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

// 第一阶段只声明“允许补什么”，不负责从事实基座挑选内容。
// 事实索引和槽位填充会在后续阶段接入内容计划调整器。
export const SOCIAL_CARD_ROLE_SUPPLEMENT_SLOTS = freeze({
  cover: [],
  concept: [
    { id: 'context', label: '背景', blockTypes: ['text', 'note'], maxItems: 1, priority: 70 },
    { id: 'pain_point', label: '痛点', blockTypes: ['text', 'list'], maxItems: 4, priority: 90 },
    { id: 'mechanism', label: '工作机制', blockTypes: ['text', 'list'], maxItems: 4, priority: 80 },
    { id: 'conclusion', label: '核心判断', blockTypes: ['text', 'note'], maxItems: 1, priority: 100 },
  ],
  feature: [
    { id: 'capability', label: '具体能力', blockTypes: ['text', 'list', 'scenes'], maxItems: 6, priority: 100 },
    { id: 'usage', label: '使用方式', blockTypes: ['text', 'list', 'scenes'], maxItems: 6, priority: 80 },
    { id: 'output', label: '输入输出', blockTypes: ['text', 'note'], maxItems: 2, priority: 70 },
  ],
  steps: [
    { id: 'prerequisite', label: '前置条件', blockTypes: ['note', 'text'], maxItems: 1, priority: 80 },
    { id: 'install', label: '安装方式', blockTypes: ['code', 'steps'], maxItems: 3, priority: 100 },
    { id: 'run', label: '运行流程', blockTypes: ['code', 'steps', 'list'], maxItems: 4, priority: 100 },
    { id: 'verify', label: '验证方式', blockTypes: ['steps', 'list', 'note'], maxItems: 3, priority: 75 },
    { id: 'boundary', label: '步骤边界', blockTypes: ['note', 'text'], maxItems: 2, priority: 60 },
  ],
  data: [
    { id: 'metric', label: '关键指标', blockTypes: ['stats', 'compare', 'text'], maxItems: 6, priority: 100 },
    { id: 'scope', label: '覆盖范围', blockTypes: ['text', 'list', 'note'], maxItems: 4, priority: 80 },
    { id: 'source', label: '数据来源', blockTypes: ['note', 'list'], maxItems: 3, priority: 70 },
  ],
  compare: [
    { id: 'options', label: '方案选项', blockTypes: ['compare', 'list'], maxItems: 4, priority: 100 },
    { id: 'criteria', label: '选择标准', blockTypes: ['compare', 'list', 'note'], maxItems: 4, priority: 80 },
    { id: 'tradeoff', label: '取舍边界', blockTypes: ['text', 'note'], maxItems: 2, priority: 90 },
  ],
  evidence: [
    { id: 'source', label: '来源证据', blockTypes: ['list', 'note', 'text'], maxItems: 4, priority: 100 },
    { id: 'implementation', label: '实现证据', blockTypes: ['list', 'text', 'code'], maxItems: 4, priority: 90 },
    { id: 'release', label: '发布记录', blockTypes: ['timeline', 'list', 'note'], maxItems: 4, priority: 70 },
  ],
  timeline: [
    { id: 'event', label: '时间事件', blockTypes: ['timeline', 'list'], maxItems: 6, priority: 100 },
    { id: 'change', label: '阶段变化', blockTypes: ['timeline', 'text'], maxItems: 4, priority: 80 },
    { id: 'status', label: '当前状态', blockTypes: ['note', 'text'], maxItems: 1, priority: 70 },
  ],
  risk: [
    { id: 'permission', label: '权限边界', blockTypes: ['note', 'list', 'text'], maxItems: 3, priority: 100 },
    { id: 'network', label: '网络与环境', blockTypes: ['note', 'list'], maxItems: 3, priority: 90 },
    { id: 'maturity', label: '成熟度限制', blockTypes: ['note', 'text'], maxItems: 2, priority: 80 },
    { id: 'cost_security', label: '成本与安全', blockTypes: ['note', 'list'], maxItems: 3, priority: 90 },
  ],
  ending: [],
});

export function getSocialCardSupplementSlots(role = 'concept') {
  const slots = SOCIAL_CARD_ROLE_SUPPLEMENT_SLOTS[String(role)] || SOCIAL_CARD_ROLE_SUPPLEMENT_SLOTS.concept;
  return slots.map((slot) => ({ ...slot, blockTypes: [...slot.blockTypes] }));
}

export function findSocialCardSupplementSlot(role = 'concept', slotId = '') {
  return getSocialCardSupplementSlots(role).find((slot) => slot.id === String(slotId || '')) || null;
}

export function validateSocialCardSupplementSlotCatalog() {
  const issues = [];
  for (const role of SOCIAL_CARD_PAGE_ROLES) {
    const slots = SOCIAL_CARD_ROLE_SUPPLEMENT_SLOTS[role];
    if (!Array.isArray(slots)) { issues.push(`${role} 槽位不是数组`); continue; }
    const ids = new Set();
    for (const slot of slots) {
      if (!slot?.id || ids.has(slot.id)) issues.push(`${role} 存在重复或空槽位 id`);
      ids.add(slot.id);
      if (!Array.isArray(slot.blockTypes) || !slot.blockTypes.length) issues.push(`${role}.${slot.id} 未声明 blockTypes`);
      if (!Number.isInteger(slot.maxItems) || slot.maxItems < 1) issues.push(`${role}.${slot.id} maxItems 非法`);
      if (!Number.isInteger(slot.priority) || slot.priority < 0) issues.push(`${role}.${slot.id} priority 非法`);
    }
  }
  return { valid: issues.length === 0, issues };
}

