# 见字 · 公众号编辑工作台

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/shiker1996/wechat-newsroom-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/shiker1996/wechat-newsroom-workbench/actions/workflows/ci.yml)
[![Node.js ≥ 24](https://img.shields.io/badge/Node.js-%E2%89%A5%2024-339933?logo=nodedotjs&logoColor=white)](./package.json)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows&logoColor=white)](./docs/user-guide.md#1-安装与启动)

「见字」是一套本地优先、面向中文内容创作者的编辑与生产工作台。它把信息采集、事件研判、选题决策、文章成稿、公众号排版、封面图和社交图文放在同一个可追溯流程中。

项目适合个人公众号作者、自媒体编辑和希望研究“技能 + 工具 + AI 流水线”架构的 Node.js 开发者。它不是 SaaS 或多人协作系统：服务只监听 `127.0.0.1`，没有登录、租户隔离或公网 API 鉴权，请勿暴露到局域网或互联网。

<p align="center">
  <a href="https://img.shiker.tech/project/export-1785841213192.mp4"><img src="docs/screenshots/ui-demo-cover.png" alt="点击播放见字工作台演示" width="760"></a>
</p>

## 主要能力

| 工作阶段 | 当前能力 |
|---|---|
| 信息采集 | RSS / Atom、RSSHub、Reddit、GitHub 项目发现、静态网页与浏览器网页采集；网页来源支持静态优先、动态降级和 AI 候选排序 |
| 事件研判 | 热点打标、事件聚类、事实卡、国内受众相关度、全景视图、文章池与图文池双轨评分 |
| 编辑决策 | 对话式编辑会、补充来源抓取、作者实践门禁、历史内容去重和结构化简报锁定 |
| 文章生产 | 类型化初稿、标题、去 AI、审稿、SEO、字数与事实门禁、版本修订、公众号 HTML 排版 |
| 视觉交付 | 900×383 封面图、配图工作台、Mermaid / ECharts 转图、公众号预览、逐页社交图文 PNG |
| 独立创作 | 心得经验、使用教程、本地项目只读导入、批次早报和突发任务 |
| 扩展与运维 | 技能包、工具插件、采集器插件、动态配置、能力路由、执行审计、备份恢复和主题中心 |

## 5 分钟开始

### 环境

- Windows 10/11（当前完整验证平台）
- Node.js 24 或更高版本
- 至少一个 OpenAI 兼容模型服务；只浏览演示数据时可不配置
- 可选：Chrome、RSSHub、Python 3、Tavily、GitHub Token、又拍云

### 安装与启动

最简单的方式是双击：

1. `setup-workbench.cmd`：安装依赖并启动配置向导。
2. `start-workbench.cmd`：启动后自动打开 `http://127.0.0.1:4317`。

也可以在 PowerShell 中运行：

```powershell
npm run setup
npm start
```

只想查看界面和示例数据：

```powershell
npm start -- --demo
```

演示模式使用独立的 `data/demo.db`，不会污染正式数据；需要模型的操作仍会提示配置服务商。

## 推荐的首次使用顺序

1. 在“运行与配置 → 模型接入”添加并测试模型。
2. 在“采集源”添加 RSS、Reddit 或“网页自动采集”来源，并先执行测试预览。
3. 创建每日批次，运行采集、打标、事件卡和研判。
4. 从文章池或图文池选择候选，完成编辑决策与事实确认。
5. 生成文章、排版或图文产物，在产物柜中统一查看。

完整的页面说明、常见任务、登录 Profile、备份恢复和故障排查见[详细使用手册](./docs/user-guide.md)。

## 项目结构

```text
server.mjs              HTTP 服务装配与静态资源入口
server/platform/http/routes/        API 路由
server/platform/core/               配置、Store 与工作区路径
server/platform/llm/                模型网关、AI 任务与内容流水线
server/platform/skills/ + skills/   技能运行时与内置技能
server/platform/tools/ + plugins/   工具、采集器与能力注册中心
server/shared/themes/             文章、图文与封面主题
public/                 原生 ES Modules 前端
data/                   SQLite、配置状态、缓存与扩展目录（运行时生成）
articles/ topics/ social-cards/  内容产物（运行时生成）
```

架构细节见[架构总览](./docs/architecture.md)。

## 架构图

| 图表 | 说明 |
|---|---|
| ![功能架构图](docs/diagrams/architecture.png) | **功能架构图** — 整体系统分层：前端 SPA、HTTP 服务层、平台核心层、业务特性层、共享领域层、存储与插件系统 |
| ![主流程](docs/diagrams/mainWorkflow.png) | **主流程时序图** — 用户操作 → 路由分发 → API 调用 → AI/DB 操作 → 响应渲染的完整数据流 |
| ![批次管线](docs/diagrams/batchPipeline.png) | **批次自动化管线** — 从数据采集到稿件生成的完整流水线，含 AI 辅助的标注/研究/撰稿与社交卡片生成 |

> 架构图由 [LikeC4](https://likec4.dev/) 从 `likec4/model.c4` 生成，更多视图（平台核心层、业务特性层详解）见[架构总览](./docs/architecture.md)。

## 配置与数据

- 默认配置内置于代码，工作区覆盖写入 `config.local.json`。
- 模型和扩展配置优先在界面的“运行与配置”中维护。
- 秘密凭据可使用配置中心的凭据字段或对应环境变量回退，不写入 SQLite 备份。
- 主数据库为 `data/workbench.db`，使用 Node.js 内置 `node:sqlite` 和 WAL。
- 内容产物保存在 `articles/`、`topics/`、`social-cards/`；运行日志在 `logs/`。
- 可从“设置与数据 → 备份与恢复”导出带 SHA-256 清单的 ZIP。

完整字段参考见[配置文档](./docs/configuration.md)，数据外发边界见[数据流说明](./docs/data-flow.md)。

## 开发与验证

```powershell
npm ci
npm run dev
npm run build
npm run test:fast
# 完整测试
npm test
```

扩展开发：

```powershell
npm run skill:validate -- docs/examples/skill-package
npm run plugin:validate -- docs/examples/tool-plugin
```

详细契约、Manifest 字段、Adapter 接口、安全规则和发布清单见[插件开发指南](./docs/plugin-development.md)。

## 文档导航

- [详细使用手册](./docs/user-guide.md)
- [API 参考](./API.md)
- [插件开发指南](./docs/plugin-development.md)
- [配置参考](./docs/configuration.md)
- [架构总览](./docs/architecture.md)
- [安全边界](./SECURITY.md)与[威胁模型](./docs/threat-model.md)
- [发布、升级与恢复](./docs/release.md)
- [完整文档索引](./docs/README.md)

## 当前边界

- 仅 Windows 10/11 完整验证；macOS / Linux 尚未作为受支持平台验收。
- 仅面向本机可信用户，不具备公网部署所需的认证、CSRF 防护和多用户授权。
- 网页自动采集面向新闻、公告、博客和榜单等重复列表页；验证码、复杂登录、多步骤交互和任意脚本不在自动配置范围内。
- 本地项目读取结果只证明文件中存在相关材料，不证明命令已经真实执行成功。
- AI 输出必须经过结构、事实和交付门禁；仍需作者确认观点、来源、版权与发布风险。

## 许可证

代码采用 [MIT License](./LICENSE)。第三方材料与许可证见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。“见字”名称和印章样式仅用于标识本项目官方版本，衍生产品不得暗示官方关联或背书。
