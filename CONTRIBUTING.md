# 贡献指南

感谢对「见字 · 公众号编辑工作台」的兴趣。本项目是本地优先的 Windows 单用户工具，请在贡献前先阅读 README 的「安全边界」一节。

## 开发环境

- Windows 10/11 + PowerShell，Node.js ≥ 24（数据库使用内置 `node:sqlite`）。
- 克隆后执行 `npm ci`（会通过 `postinstall` 级联安装 `skills/*/package.json` 的技能级依赖，含 Puppeteer Chromium，首次约 1–2 GB）。
- 启动：`npm start`；开发热重载：`npm run dev`。
- LLM 服务商 Key 放入根目录 `.env`（参照 `.env.example`），缺失时界面与 AI 功能降级，不影响安装与测试。

## 分支与提交约定

- `master` 保持可发布状态；功能开发走 `codex/<主题>` 或 `feature/<主题>` 分支，经 Pull Request 合入。
- 提交信息使用中文简要说明，较大改动建议带范围前缀，如 `refactor(skills): …`、`fix(pipeline): …`；一次提交只做一件事。
- 不要提交 `.env`、`config.local.json`、`account-context.json`、`data/`、`logs/`、浏览器 Profile 或任何真实密钥与私有内容（已被 `.gitignore` 覆盖，不要强制添加）。

## 测试要求

提交前必须通过：

```powershell
npm run build
npm test
```

测试分层（`test/helpers/tiers.mjs`）：

- **快速层**：绝大多数测试，纯本地、无外部依赖；可用 `npm run test:fast` 单独跑（等价于 `SKIP_BROWSER_TESTS=1`）。
- **浏览器层**（当前 7 个）：布局审计、ECharts、浏览器内联化等渲染测试，依赖 `postinstall` 下载的 Puppeteer Chromium，不依赖用户 Chrome。
- **网络/平台约束**：测试不得访问真实第三方 API、用户 Chrome Profile、RSSHub 常驻进程或外部 CDN；新增网络类测试必须 mock 或本地起服务（参照 `test/firecrawl-mcp.test.mjs`），外部写入一律 mock。

一致性红线（改动相关文件时必须同步，CI 会直接拦截漂移）：

- 增删/修改 HTTP 路由 → 更新 `API.md`（`test/api-docs-routes.test.mjs` 双向校验）。
- 增删环境变量或默认配置 → 更新 `.env.example` / `config.example.json`（`test/example-config-sync.test.mjs`）。
- 修改 `social-card-prompts` 或故事板技能 references → 更新提示词快照测试。
- 涉及目录结构、命令、约定的变化 → 更新 `AGENTS.md` / README 对应章节。

## 技能与插件扩展

- 技能：在 `skills/<name>/` 添加 `SKILL.md` + `skill.json`，参照 `docs/examples/skill-package`；第三方技能包用 `npm run skill:validate -- <目录>` 校验。
- 本地工具插件：参照 `docs/examples/tool-plugin` 与 `plugins/` 下现有适配器，声明权限（网络域名、路径访问、外部写入），用 `npm run plugin:validate -- <目录>` 校验。
- 远程 API/MCP 插件：只接受声明式 Manifest（HTTPS、域名白名单、超时与响应上限），不允许随包分发可执行代码。
- 变更类管理路由（安装/更新/卸载/启停）必须保留 `x-admin-confirm` 确认头校验，前端走确认弹窗。

## 安全

- 漏洞请按 [SECURITY.md](./SECURITY.md) 私下报告，不要先开公开 Issue。
- 安全核心（密钥处理、备份恢复、确认头、SSRF 防护）的改动需要维护者逐行审阅，不作为新手任务。
- 建议启用提交前秘密扫描（命中高危密钥模式会阻止提交）：`git config core.hooksPath .githooks`；CI 中也会执行同一脚本（`scripts/quality/secret-scan.mjs`）。

## 仓库体积约定

- 仓库只收文本与小型素材；单个文件超过 1 MB 或总体明显膨胀时先在 PR 中说明理由。
- 截图、录屏、设计图默认不进仓库；确需保留的放入 `docs/` 并压缩，超过预算时改用外部链接或 Git LFS。
- 产物目录（`articles/`、`topics/`、`social-cards/`、`data/`、`logs/`）永远不进版本库。
