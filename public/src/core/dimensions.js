// src/core/dimensions.js — 维度词典（who/what/where），topics / daily / atlas 共用
// 显示名采用 daily/atlas 的口径（"动作"）；topics 原用的"对比"与多数视图不一致，已统一。
export const dimensionLabels = { who: "主体", what: "动作", where: "场合" };
// 维度选题的池角色名（atlas 创建维度选题时随请求写入后端）
export const dimensionRoles = { who: "主体动态", what: "横向对比", where: "场合盘点" };
