# Star 增长路线图

> 类别：未来计划
> 状态：待评审
> 创建：2026-08-04
> 目标：在保持「本机单用户、源码仓库分发」边界不变的前提下，把仓库公开并让目标用户（公众号 / 小红书作者、AI 内容工具爱好者、Node.js 开发者）愿意 star。

## 0. 现状判断

`docs/open-source-readiness.md` 的 P0 / P1 已基本完成：许可证与第三方清单齐备、密钥与历史清理完成、威胁建模与安全测试落地、冷启动验收与 CI 全绿、版本 / CHANGELOG / release 流程就绪。**公开前的「硬门槛」已过，剩下的是发布动作与增长运营。**

据此把工作分为四档：

- **P0 发布临门一脚**：不改功能，只做公开前的最后收尾（1 天内可完成）。
- **P1 首个公开 Release**：让「第一次看到的人」在 30 秒内 get 到价值并想试用。
- **P2 可见性执行**：公开后第一波流量从哪里来、说什么。
- **P3 留存与社区**：让 star 不只是一次性冲动。

## P0 发布临门一脚（本周）

按 `open-source-readiness.md` §5 门禁逐条复核，处理仅剩的收尾项：

- [x] 商标自查：「见字」名称是否与他人商标冲突。
  - 2026-08-04 初步检索：Bing 网页搜索无同名软件 / 服务商标撞名结果；GitHub 仓库搜索无同名的公众号写作工具。**正式风险结论须在「中国商标网（CNIPA）」按第 9/41/42 类做一次官方检索后落定**，属发布人法务自查项。
- [x] 处理 GitHub `refs/pull/*` 旧提交残留。
  - 2026-08-04 复核：全部 17 个 `refs/pull/*/head` 与 #1–#3 的 `refs/pull/*/merge` 均为**历史重写后**的提交（`origin/master` 是其祖先），对全部分支可达的 189 个提交复查 `data/`、`logs/`、`.env`、`config.local.json`、`account-context.json` **零命中**。原「需联系 GitHub Support 清除」的风险已不存在，无需处理。
- [x] 发布前冷启动复验（2026-08-04）：干净临时目录复制 614 个跟踪文件 → `npm ci`（107+195 包）→ `npm run build`（主题与 31 模块校验通过）→ `npm test` **662/662 通过** → 无密钥启动：`/api/overview` 200、`/api/models` 全部 `configured:false` 降级、`/api/system/health` 正常 → `stop-workbench.ps1` 正常停止。**全绿。**
- [ ] 决定公开时机：切 Public 前先做好 P1 的 README 顶部物料，避免「裸公开」。

## P1 首个公开 Release（公开前 1 周）

Star 的第一印象来自仓库页，README 顶部决定去留。当前 README 信息密度高但**没有视觉钩子**，对路人不够友好。

### 1. README 顶部加「3 秒钩子」

- [x] 加 2–3 张截图到标题下：`docs/screenshots/` 已有工作台总览 / 热点全景 / 文章选题池 / 图文选题池四张整页截图（`scripts/render-ui-shots.mjs` 可重新生成）。README 顶部随后改为内嵌 2 分钟演示视频（`<video>` 引用 0.2.0 Release 附件 `demo-compressed.mp4`），截图保留作海报与渠道物料。
- [x] 标题下加一句「用它做了什么」的成果展示：顶部简介已改成场景导向的「是什么 / 不是什么 / 适合谁」三段。
- [x] 补「快速看效果」路径：README 新增「快速看效果（演示模式，无需 LLM Key）」小节，附 `npm start -- --demo` 与 `start-workbench.ps1 -Demo` 命令。

### 2. 定位句对外打磨

- [x] 在 README 顶部第一段采用「是什么 / 不是什么」句式，并打磨得更口语。
- [x] 增加「适合谁」一小节，明确三类目标用户（公众号 / 小红书作者、内容团队、Node.js 开发者）。

### 3. 降低「装了才能看」的摩擦

- [x] 实现 `--demo` mock 数据启动模式：`server.mjs` 解析 `--demo` / `WORKBENCH_DEMO=1`，使用独立库 `data/demo.db`，写入两份虚构演示批次（热点、打标、选题池、排版 / 终稿产物），跳过 RSSHub 自动拉起；`start-workbench.ps1 -Demo` 与 `start-workbench.cmd -Demo` 已接通。测试 `test/demo-seed.test.mjs` 3 例，`npm run test:fast` 全绿。
- [x] 成品示例目录：演示产物（排版 HTML、文章终稿）落在 `articles/demo/`，产物中心视图可直接预览。

### 4. 打一个真实 Release

- [ ] 发布 `0.2.0`：CHANGELOG 已把 `[Unreleased]` 归入 `[0.2.0] - 2026-08-04` 并补演示模式条目，`package.json` 已升到 `0.2.0`；**待提交 + 打 tag + 推送后**用 `npm run release` 产出带 SHA256SUMS 的 zip（当前工作区有未提交改动，`git archive HEAD` 不会包含新功能）。

## P2 可见性执行（公开后 2 周内）

目标：把「想用的人」引导到仓库并完成首次 star。渠道按目标用户浓度排序。

### 渠道与动作

| 渠道 | 动作 | 期望 |
|---|---|---|
| 即刻 / V2EX / 掘金 / 知乎 | 发一条「我从 0 到 1 做了个本地公众号 AI 工作台」的图文帖：痛点（AI 稿味、排版痛苦、事实幻觉）+ 3 张截图 + 仓库链接 | 第一波脉冲流量 |
| 小红书 | 用项目自己的 pipeline 产出 demo 内容，文末「工具开源，见主页」；风格贴近「自媒体人效率工具」类目 | 长尾 + 非开发者受众 |
| 微信公众号 | 一篇教程向长文《我用本地工作台把公众号生产做成流水线》，结尾导流仓库 | 深度用户转化 |
| Hacker News | Show HN 帖：标题强调「local-first」「auditable」「no SaaS」；正文贴截图与安装命令 | 开发者圈层曝光 |
| GitHub 生态 | 项目名含 wechat-newsroom-workbench，可补 topics：`wechat`、`content-creation`、`local-first`、`llm`、`typesetting` | 站内搜索长尾 |

### 内容要点（跨渠道共用）

- 卖点排序：① 本地优先、数据不出机（对自媒体人有隐私吸引力）② 去 AI 味成稿链（解决核心痛点）③ 图文 / 排版一步到位（成果可视化）④ 全程审计可追溯。
- 明确边界：只支持 Windows、只监听 127.0.0.1、源码仓库不发布 npm 包——**不要承诺没做的事**，避免被当成「又一个没做完的开源项目」。
- 每次发布都配 gif/截图，评论区回复引导 star（自然引导，不刷）。

## P3 留存与社区（公开后持续）

- [ ] 从 `CONTRIBUTING.md` 已有扩展路径中标注 3–5 个 good first issue（避开安全核心 / 密钥 / 恢复逻辑），让首批贡献者有事可做。
- [ ] 建立 issue 模板 + 响应节奏承诺（现有模板已有，落实「多久回复」预期）。
- [ ] 每 2–4 周一个功能 / 修复 Release，配合 CHANGELOG 与渠道同步，保持活跃假象即真实活跃。
- [ ] 季度复查第三方服务条款与抓取合规（open-source-readiness P2 例行项）。
- [ ] 出现第二位活跃维护者时，启动维护者轮值（open-source-readiness P2 暂缓项）。

## 指标与复盘

- 公开后第 1 周：star 目标 30–80（健康脉冲，不依赖刷量）。
- 第 1 个月：100+；看 README 转化率、clone/use 反馈（issue / 讨论）。
- 复盘信号：若公开后无自然流量，优先怀疑「定位句 + 截图钩子」而不是渠道数量；若有人 clone 但没人 star，优先做 demo 模式与文档。

## 边界与约束（不因为增长而破例）

- 不引入遥测（开源禁止项，`open-source-readiness.md` P2）。
- 不把服务改造成可公网部署来「扩大受众」；跨平台与登录体系另立专项评估。
- 不刷 star、不买量、不虚假活跃。
