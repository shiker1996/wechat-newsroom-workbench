# 扩展开发：技能包与工具插件

> 本文保留扩展类型的快速索引。包含采集器插件、完整 Manifest 字段、Adapter 示例、配置 Schema、安全检查和发布流程的最新版指南见 [plugin-development.md](./plugin-development.md)。

工作台支持三类扩展，均有最小可运行示例（可直接用校验命令验证），统一遵循 [CHANGELOG.md](../CHANGELOG.md)「兼容政策」一节：以 `schemaVersion`（当前均为 1）与 `compatibleApp`（ semver 下限，如 `>=0.1.0`）判定兼容，不兼容在安装时明确报错，不静默加载。

| 类型 | 示例 | 校验命令 | 安装方式 |
|---|---|---|---|
| 第三方技能包 | [examples/skill-package](./examples/skill-package/) | `npm run skill:validate -- docs/examples/skill-package` | 技能与插件页上传目录或 ZIP |
| 本地工具插件 | [examples/tool-plugin](./examples/tool-plugin/) | `npm run plugin:validate -- docs/examples/tool-plugin` | 技能与插件页安装受信目录 |
| 远程工具插件 | [examples/remote-tool-plugin](./examples/remote-tool-plugin/) | 安装时由 `server/platform/tools/remote-package-manager.mjs` 校验 | 声明式 Manifest 登记 |

变更类管理路由（安装 / 更新 / 卸载 / 启停 / 回滚）都要求 `x-admin-confirm: TRUSTED-LOCAL-PLUGIN` 确认头（防误操作，非鉴权），示例见 [API.md](../API.md)「可复制调用示例」。

## 第三方技能包（stage 技能）

- **形态**：目录或 ZIP，含 `SKILL.md`（frontmatter：`name` / `description` / `version`）+ `skill.json`（id、kind、entryPoints、inputContract/outputContract、`compatibleApp`、`source.type: "installed"`），只允许 `.md` / `.json` / `.txt` 与 LICENSE / NOTICE 文件，最多 100 个文件、5 MB。
- **权限说明**：技能本身只是提示词与契约声明，不执行代码；可用能力通过 `requiredCapabilities` / `optionalCapabilities` 声明，由工具注册中心按白名单授予，未授权能力在运行时不可见。
- **失败语义**：清单缺字段、文件越界、Markdown 引用不存在、`compatibleApp` 不满足、未知 `schemaVersion` 都会在安装前报错并拒绝；运行期输入契约不满足时该技能不会出现在路由候选中，而不是执行到一半失败。
- **版本兼容**：`compatibleApp` 与当前应用版本（`server/version.mjs`）比较；同技能多版本保留安装记录，可在界面切换启停。

## 本地工具插件（local-adapter）

- **形态**：目录含 `manifest.json`（`type: "local-adapter"`、capabilities、entry、riskLevel、input/output schema、`source` 受信 URL、`compatibleApp`、`permissions`）+ entry 指向的 `.mjs` adapter；只允许 `.mjs` / `.json` / `.md` / `.txt`，最多 100 个文件、10 MB；adapter 禁止未审计的第三方包依赖（import 仅限 `node:` 与包内相对路径）。
- **权限说明**（`permissions` 块，安装前展示）：`networkDomains`（可访问域名白名单）、`pathAccess`（可读写路径）、`externalWrite`（是否会向第三方写入）、`credentials`（需要的凭据位）。`riskLevel` 为 `external-write` 时必须声明 `externalWrite: true`。网页抓取类能力强制拒绝本机 / 内网 / 保留地址（SSRF 防护见 `docs/threat-model.md`）。
- **失败语义**：健康检查失败或执行抛错时，该能力调用返回结构化错误并写入执行审计（`server/platform/tools/execution-log.mjs`），不中断所在流水线；流水线按「无此工具」降级继续。
- **版本兼容**：同插件可保留多个版本，支持回滚到历史版本；`compatibleApp` 不满足或 `schemaVersion` 未知时拒绝安装。

## 远程工具插件（remote-api / mcp）

- **形态**：纯声明式 Manifest（JSON），**不允许随包分发可执行代码**；字段见示例 [remote-api.json](./examples/remote-tool-plugin/remote-api.json) 与 [mcp.json](./examples/remote-tool-plugin/mcp.json)：`endpoint`（必须 HTTPS）、`healthEndpoint`、`credentialProfile`、`timeoutMs`、`maxResponseBytes` 等。
- **权限说明**：`riskLevel` 仅允许 `network-read` / `external-write`；`external-write` 插件会向第三方发送内容，安装界面必须明确提示。凭据按 `credentialProfile` 隔离存储（`server/platform/tools/remote-credentials.mjs`），不写入数据库与备份。
- **首次执行确认**：安装与启用不代表信任——启用后的首次真实调用会被执行门禁拒绝（`FIRST_RUN_CONFIRM_REQUIRED`），用户必须在「技能与插件」页面看到域名、风险等级、外部写入与凭据摘要并显式确认（`POST .../first-run-confirm`）后才放行，避免“安装即信任所有能力”。健康检查（不携带业务输入）不受此限。
- **失败语义**：健康检查失败不允许启用；调用超时（`timeoutMs`）或响应超限（`maxResponseBytes`）按失败处理并写审计；目标域名解析到本机 / 内网 / 保留地址时直接拒绝。
- **版本兼容**：与本地插件相同的 `schemaVersion` + `compatibleApp` 判定。

## 上手路径

1. 复制对应示例目录改名，修改 id / 名称 / 契约字段。
2. 用上表校验命令本地验证（CI 也会校验 `docs/examples` 下的示例不腐化）。
3. 在「技能与插件」页面安装并做一次真实调用，确认权限声明与实际行为一致。
4. 扩展点契约（entryPoints、input/outputContract、能力槽位）以 `server/platform/skills/skill-manifest.schema.json` 与 `server/platform/tools/manifest-loader.mjs` 为准。
