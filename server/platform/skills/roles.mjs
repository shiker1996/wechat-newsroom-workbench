export const RUNTIME_POLICY_SKILLS = Object.freeze(new Set([
  'wechat-mp-composite',
  'wechat-mp-daily',
  'wechat-mp-deep-dive',
  'wechat-mp-gossip-chill',
  'wechat-mp-personal-writing',
  'wechat-mp-tech-deep',
  'wechat-mp-tech-hotspot',
  'wechat-mp-tutorial',
  'wechat-article-typeset',
  'xiaohongshu-article-generator',
]));

export function ownsRuntimePolicy(skillId) {
  return RUNTIME_POLICY_SKILLS.has(String(skillId || ''));
}
