# 威胁建模（开源前置）

> 2026-07-31 首次盘点。本文记录项目的安全边界假设、各类入口的现有防护、已修复问题与已接受风险。配套文档：`README.md` 安全边界一节、`SECURITY.md`、`docs/data-flow.md`。

## 0. 边界模型

- 工作台 HTTP 服务**硬编码绑定 `127.0.0.1`**（`server.mjs` 末尾 `listen` 字面量），没有任何配置项可以改成 `0.0.0.0`（`config.local.json` / `.env` 均无 host 项）。这是整个系统唯一真实的网络边界：所有 API 都假定调用方是本机用户本人。
- 确认头（`x-admin-confirm: TRUSTED-LOCAL-PLUGIN`、`x-admin-confirm: DELETE-BATCH`、`x-restore-confirm: RESTORE`）是**防误触的 UI 语义**，不是鉴权。前端在对应操作前弹确认框，确认后才带头。
- 密钥永不入库、永不回读：LLM Key 在 `~/.codex`（或用户本地配置），远程插件凭据按 profile 哈希存 `.env.remote-plugins`（服务端只写不读回页面）；审计日志只记参数名不记正文（`lib/tools/execution-log.mjs`）。

## 1. 入口与防护清单

### 1.1 本地目录读取 / 路径穿越

- 本地项目读取器：`lib/integrations/local-project-reader-core.mjs`——跳过密钥文件名（`SECRET_FILE` 正则）、跳过 symlink、跳过依赖目录、大小/字符上限。
- 策略层：`lib/tools/policy.mjs` `enforcePolicy` 校验 `allowedRoots`，`realpathSync` 防 symlink 绕过。
- 产物资产：`lib/artifacts/artifact-indexer.mjs` `isInsideRoots` / `resolveArtifactRelativeAsset` 防 `../`；内容路由（preview/content/asset）全部过 `isInsideRoots`。
- 测试：`test/local-project-reader.test.mjs`、`test/tool-registry.test.mjs`、`test/artifact-relative-assets.test.mjs`。

### 1.2 备份包（Zip Slip / 恢复回滚）

- `lib/artifacts/backup-archive.mjs`：只接受 method 0 存储条目（天然无解压炸弹），条目名统一 `\`→`/` 后拒绝绝对路径、`../` 与重复名；manifest 逐文件 size + SHA-256 校验。
- 恢复路由：`x-restore-confirm` 确认头、恢复前自动安全备份、SQLite `integrity_check`、技能目录 staging+swap+rollback（自带路径越界检查）。
- 上传上限：备份 100 MB（`binaryBody`），技能包 zip 6 MB。
- 测试：`test/backup-archive.test.mjs`、`test/security-boundaries.test.mjs`（Zip Slip：路径穿越/绝对路径/重复条目拒绝）。

### 1.3 本地插件/技能包安装（确认头）

- 工具插件包管理器（`lib/tools/package-manager.mjs`）：manifest 全字段校验、禁 symlink、扩展名白名单、≤100 文件/10 MB、import 仅限 `node:` 与包内相对路径、SHA-256 内容哈希、staging+归档回滚、事件审计 jsonl。
- 确认头 `requirePluginAdmin` 覆盖：工具插件 install/status/rollback/delete，**以及技能包 install/update/status/delete**（2026-07-31 补齐，原先缺失，与工具插件不一致）。
- 测试：`test/tool-plugin-package-manager.test.mjs`、`test/tool-plugin-management.test.mjs`、`test/security-boundaries.test.mjs`（四条技能包路由缺头→400、带头→进入正常流程）。

### 1.4 远程 API/MCP 插件（DNS / 重定向 / SSRF / 凭据）

- `lib/tools/remote-adapter.mjs`：`privateIp`（IPv4 全保留段 + IPv6 映射/ULA/保留段）、`assertSafeRemoteUrl`（仅 HTTPS、禁内嵌凭据、域名白名单、DNS 逐地址检查）、`safeFetch`（手动重定向 ≤3 次且每跳重新校验）、`readLimitedJson`（响应大小上限，超限即中断读取）、超时控制；输入禁带本地绝对路径。
- 远程包管理器：endpoint 仅 HTTPS、`allowedDomains` 锁死主机、timeoutMs 1000–30000、maxResponseBytes ≤2 MB；凭据按 profile 隔离存储、卸载即清。
- 测试：`test/remote-tool-plugin.test.mjs`（私网拒绝、跨域重定向拒绝、凭据生命周期、MCP 握手）、`test/security-boundaries.test.mjs`（保留段判定、响应超限中断）。

### 1.5 URL 抓取（RSS 订阅 / 热点原文）

- RSS 直连：`collectors/rsshub.mjs` `assertPublicFeedUrl`——仅 HTTP(S)、禁内嵌凭据、禁 localhost、DNS 解析后逐地址过 `privateIp`（2026-07-31 起复用 remote-adapter 的全量实现，补上 100.64/10、198.18/15、0.0.0.0、192.0.0/24、240/4 等漏段），手动重定向 ≤4 次每跳重校验，12 MB 上限。
- url-fetch 插件：`plugins/url-fetch/adapter.mjs` 增加 `publicTargetError`（2026-07-31）——禁 localhost、IP 字面量直接判定、域名先解析再逐地址过 `privateIp`；URL 规范化解析天然覆盖十进制/十六进制 IP 字面量（如 `2130706433` → `127.0.0.1`）。
- Firecrawl MCP：`lib/integrations/firecrawl-mcp.mjs` `validatePublicUrl` 拒绝 localhost/.local/内网 IPv4/`::1`，10 MB 上限。
- Python 抓取脚本 `scripts/fetch-hotspot-url.py` 自带本机/内网拒绝（第二道防线）。
- 测试：`test/firecrawl-mcp.test.mjs`、`test/source-fetcher.test.mjs`、`test/security-boundaries.test.mjs`（url-fetch 拒绝本机/内网/十进制 IP/IPv6 回环）。

### 1.6 CDN 上传（external-write 授权与审计）

- 策略：`lib/tools/policy.mjs`——`riskLevel === 'external-write'` 必须显式 `authorizedExternalWrite === true`。
- 授权点两个：媒体路由用户点上传按钮（逐次人工授权）；**typeset 流水线自动生成图后自动上传（`lib/llm/typeset-pipeline.mjs` 硬编码 true）——这是设计决策，见 §2.3**。
- 审计：`tool-executions.jsonl` + 库表只记参数名、状态、时长，不复制输入正文；上传结果 URL 必须 HTTPS。
- 测试：`test/tool-registry.test.mjs`（未授权外部上传被拦截、权限拒绝也写审计、日志不记正文）、`test/image-workflow.test.mjs`。

### 1.7 HTML / Markdown 预览注入

- Markdown 预览：markdown-it `html: false`，链接 `rel=noopener`，依赖 `validateLink` 拦 `javascript:`/`file:`/`data:`。
- 图片产物预览页：`lib/artifacts/artifact-preview.mjs` 对 URL 与 title 转义（2026-07-31 补上 title 的 `"` 转义，堵 `alt` 属性注入）。
- HTML 产物预览原样输出（无 CSP/sandbox）——见 §2.2 已接受风险。
- 测试：`test/editor-preview.test.mjs`、`test/artifact-preview.test.mjs`、`test/security-boundaries.test.mjs`（title 引号转义）。

## 2. 已接受风险（服务绑 127.0.0.1 前提下）

### 2.1 DNS 解析 TOCTOU（DNS rebinding）

`assertSafeRemoteUrl` / `assertPublicFeedUrl` 自己解析一次域名，`fetch` 发起连接时再解析一次，两者之间攻击者理论上可换绑 IP（无连接级 IP 钉扎）。窗口极短且需要攻击者控制目标域名 DNS，本地单机场景收益极低，接受。

### 2.2 产物 HTML 预览可执行脚本

`content-routes` 对 HTML 产物原样吐 `text/html`，无 CSP、无 sandbox iframe——产物 HTML 内脚本可执行并访问同源 API。缓解因素：产物来自本机流水线生成或用户自己导入，服务只绑回环地址。若未来开放局域网访问，必须先加 sandbox/CSP。

### 2.3 typeset 流水线自动上传 CDN

自动生成图片完成后自动上传又拍云（`typeset-pipeline.mjs` 硬编码 `authorizedExternalWrite: true`），不是逐次人工确认。原因：排版产物必须拿到公网 URL 才能进最终 HTML，逐次确认会打断批量流水线。**这是确认过的设计决策**（2026-07-31）；凭据不出本机，审计有记录。

### 2.4 确认头无 Origin/Referer 校验（CSRF 面）

两个确认头是固定字符串，浏览器里任意恶意网页理论上可以带这两个头向 `127.0.0.1` 发请求。缓解因素：确认头只能触发"用户本已授权过语义"的安装/恢复操作，且技能/插件包仍要过 manifest 校验；`fetch` 跨域读取响应受 CORS 限制。接受，不引入 Origin 校验（本地工具无受信 Origin 列表可配）。

## 3. 变更记录

- 2026-07-31：首次盘点并修复——①技能包 install/update/status/delete 四路由补 `x-admin-confirm` 校验（服务端 + 前端确认弹窗）；②图片预览页 title 补 `"` 转义；③rsshub 内网判定复用 remote-adapter 的 `privateIp` 全量实现；④url-fetch 插件增加内网/本机目标拒绝；⑤新增 `test/security-boundaries.test.mjs`（确认头、Zip Slip、保留段、url-fetch 拦截、响应超限、title 转义共 7 例）。
