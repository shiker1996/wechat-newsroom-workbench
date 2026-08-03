// 编辑室"未决问题"字段的清零归一。
// 各门禁（锁定简报、成稿链、前端就绪检查）以空串判定未决问题已清零，
// 但模型常把"没有未决问题"写成"无"、"无。"或"无。……（补充说明）"，
// 这里统一归一为空串，避免编辑室假性卡死。
// 注意只匹配"无"后紧跟标点/空白的形式，避免误伤"无版权数据能否使用？"这类真问题。
const NONE_DECLARATION = /^(?:无|没有了?|暂无|无未决问题|none|n\/a)(?:[。．.，,、：:；;\s]|$)/i;

export function normalizeOpenQuestions(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return NONE_DECLARATION.test(text) ? '' : text;
}

export function hasOpenQuestions(value) {
  return normalizeOpenQuestions(value) !== '';
}
