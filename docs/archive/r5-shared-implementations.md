# R5.3 公共实现收敛实施记录

实施日期：2026-08-14

## 结论

R5.3 已完成第一优先级公共能力的生产实现收敛。调用方可以保留领域命名包装，但安全边界和核心算法只由共享模块实现。

## 共享模块

| 能力 | 规范实现 | 已迁移范围 |
|---|---|---|
| 原子 UTF-8 / JSON 写入 | `lib/core/atomic-file.mjs` | HTTP 产物、工具/远程工具/采集器目录、能力路由、工具与采集设置、凭据元数据、技能包与技能配置、模型供应商配置 |
| HTML 转义 | `lib/rendering/html-utils.mjs` | 图文故事板、Markdown 渲染、封面编译、文章配图 |
| 颜色对比度与混色 | `lib/themes/color-utils.mjs` | 主题校验、发布门禁、问题修复建议、AI 主题归一化、封面编译 |
| 字体栈 | `lib/themes/font-utils.mjs` | 图文主题和封面主题编译器 |
| 模型 JSON 围栏解析 | `lib/llm/model-json.mjs` | R4 统一模型解析链，并继续迁移视觉规划、来源字段补齐、来源排序和突发分析 |
| URL/IP/SSRF | `lib/plugin-sdk/network.mjs` + `lib/tools/remote-adapter.mjs` | 插件网络访问与远程扩展共同复用保留地址判定和安全 URL 门禁 |

HTTP JSON 响应继续由服务器注入给各路由，`route-helpers.respond` 只负责统一“响应并结束路由”的控制流，不另行序列化。

## 有意保留的领域写入

目录安装、版本回滚和生成图片落盘涉及目录交换或二进制文件，不属于原子 UTF-8/JSON 写入，继续保留各自的 rename 流程。文章流水线中附带换行规范、返回 `fs.Stat` 的写入包装将在 R5.4 拆分大型 pipeline 时迁移，以避免本阶段同时改变产物契约。

专项回归位于 `test/r5-shared-implementations.test.mjs`。
