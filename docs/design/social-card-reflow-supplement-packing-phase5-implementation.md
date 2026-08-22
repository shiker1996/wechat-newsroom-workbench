# Social 图文补充装箱模板回归与灰度：阶段 5 实施记录

## 目标

把阶段 0–4 的装箱、拆页、尺寸兜底和浏览器审计结果纳入现有模板指标与灰度判定，验证 `clean-v1`、`neon-v1`、`brutalist-v1`、`editorial-v1` 不会因为某一模板的静态模型偏差而被错误推广。

## 实施内容

- `social-template-metrics.json` 和数据库运行指标新增联合装箱审计字段：审计轮次、判断不一致次数、浏览器独有溢出、静态独有溢出、平均利用率偏差。
- 模板/主题/页面角色维度报告新增 `jointPackingMismatchRate` 和 `averageJointPackingMeanAbsoluteUtilizationDelta`。
- 当静态模型与浏览器判断不一致比例达到 20% 时，容量校准报告标记 `jointPackingCalibrationNeeded`，但不替代布局硬门禁。
- 灰度推广新增 `auditAlignmentNotWorse` 门禁：新链路的审计偏差不能劣于基线。
- 数据库 schema 升级到 v11，旧库启动时自动补齐联合装箱指标字段。

## 验收

- 四套内置模板继续使用真实 Chromium 回归；
- 来源原子损失仍为零门禁；
- 溢出率、计划调整轮次和联合审计偏差同时进入灰度比较；
- 只有通过样本数、成功率、溢出率、计划轮次、来源守恒和审计一致性，才允许推广。

## 测试

阶段 5 新增模板指标和灰度门禁测试，并运行：

```text
node --test test/social-card-*.test.mjs
```
