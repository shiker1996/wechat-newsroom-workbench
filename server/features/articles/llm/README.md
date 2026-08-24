# llm

## 职责

文章业务专用的模型调用、提示词编排和结构化输出处理。

## 依赖边界

可依赖 `platform/llm` 的通用模型能力、文章 domain 和 shared；不得被 platform 基础设施反向依赖。
