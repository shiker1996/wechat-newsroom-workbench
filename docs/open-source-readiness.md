# 开源准备与后续工作清单

> 创建：2026-07-30  
> 状态：待执行  
> 目标：在不泄露用户数据、密钥和第三方受限材料的前提下，把当前单机项目整理成可公开审阅、可复现安装、可持续维护的开源仓库。

## 1. 当前结论

项目已经具备较完整的产品链、自动化测试、示例配置、技能 / 插件校验器和本地数据隔离，但还不应直接把现有仓库设为公开。当前最主要的缺口是：

- 根目录没有 `LICENSE`、`SECURITY.md`、`CONTRIBUTING.md`、行为准则和版本变更记录。
- `package.json` 仍为 `private: true`、`0.1.0`，也没有仓库地址、许可证、作者、文件范围等发布元数据。
- 没有公开仓库 CI、依赖更新和安全扫描配置。
- 项目包含内置技能、第三方改编技能、前端 vendor 文件、设计图片和示例插件，发布前需要逐项确认来源、许可证和再分发条件。
- 当前服务是 Windows 本机单用户工具，只监听 `127.0.0.1`，没有账号、会话、CSRF、租户隔离和公网 API 鉴权；不能把“可本地运行”等同于“可安全部署到公网”。
- README、`.env.example`、`config.example.json` 和实际默认配置仍需建立自动一致性检查，防止继续漂移。

## 2. P0：公开仓库前必须完成

### 2.1 法律、版权与品牌

> 实施记录（2026-07-31）：完成全仓库第三方材料盘点（结论落盘为根目录 `THIRD_PARTY_NOTICES.md`）。选定 **MIT** 并新增根目录 `LICENSE`（`package.json` 补 `license` 字段）；唯一有外部血缘的 `skills/humanizer-zh` 已补上游 MIT 许可文本与维基百科 CC BY-SA 归属（`skills/humanizer-zh/LICENSE`）；`DESIGN_SYSTEM.md` 补 tokyo-night / solarized 署名；README 新增「许可证与商标」一节说明「见字」名称与印章样式的使用边界。盘点确认无 copyleft 材料进入发布物（RSSHub 为 AGPL 但未跟踪、不内嵌）；`plugins/` 全为自研薄适配器，无内嵌第三方库；`skills/`、`plugins/` 下无任何图片/字体二进制。

- [x] 确定开源许可证，并新增根目录 `LICENSE`。在选择 MIT、Apache-2.0 或其它许可证前，先确认所有贡献代码和素材都有权按该许可证发布。（MIT；全部代码与素材为原创或 MIT/Apache-2.0/BSD 上游，见 `THIRD_PARTY_NOTICES.md`）
- [x] 建立第三方材料清单，至少覆盖：
  - `public/vendor/markdown-it.min.js` 及其许可证；（MIT，许可文本已随附）
  - `skills/humanizer-zh` 等带外部来源元数据或改编历史的技能；（唯一一项，已补许可文本与归属）
  - Mermaid、ECharts、Puppeteer / Chromium 相关依赖；（MIT / Apache-2.0，均为运行时依赖不随仓库分发）
  - `artifacts/`、`docs/ux-audit-*` 中的截图、字体、Logo 和示例内容；（ux-audit 截图已删除，根目录无 artifacts/，无字体/Logo 文件分发）
  - `skills/**` 中的模板、参考文案、设计系统和图片。（无图片二进制；模板与文案均为原创）
- [x] 为需要保留的第三方内容补充版权声明、原始链接、许可证文本和修改说明；无法确认再分发权的内容从公开版本移除或替换。（humanizer-zh、tokyo-night/solarized 署名已补；无无法确认的材料）
- [x] 确认"见字"、产品图标和界面素材是否允许作为项目名称与品牌公开使用，并在 README 说明商标边界。（原创命名、纯 CSS 印章无图片素材；README 已声明商标边界。注：公开前建议自行检索「见字」商标冲突，属法务自查项）

### 2.2 密钥、隐私与仓库清理

> 扫描记录（2026-07-31）：对全部提交历史与当前工作树执行模式扫描（sk-/ghp_/github_pat_/AIza/tvly-/xox/AKIA/JWT，及 password/secret/api_key/token/cookie 赋值），零真实密钥命中（占位符除外）；`.env`、`config.local.json`、`account-context.json` 从未进入历史；历史 `data/github-cache/*.json` 不含令牌；抽查历史 walkthrough / ux-demo 截图无账号、路径、密钥泄露。密钥无需轮换。

- [x] 对当前工作树和完整 Git 历史执行密钥扫描，覆盖 API Key、Cookie、Token、又拍云凭据、GitHub Token、Firecrawl / Tavily 密钥和远程插件凭据。只检查当前 `.gitignore` 不足以证明历史安全。
- [ ] 检查并清理可能包含个人信息、真实选题、文章正文、来源缓存、浏览器 Profile、数据库、日志、备份和绝对路径的文件；确认 `data/`、`articles/`、`topics/`、`social-cards/`、`.env`、`config.local.json`、`account-context.json` 均未进入历史。
  - 2026-07-31 扫描发现：`data/write-assistant.db`（空文件）、`data/rsshub.pid`、`data/github-cache/*.json`、`data/walkthrough-*` 与 `data/ux-demo-*` 截图曾在历史中出现（现已不跟踪）；`articles/`、`topics/`、`social-cards/`、浏览器 Profile、真实数据库从未进入历史。需决定保留历史还是重写清理。
  - `.env.example` 与 `skills/upyun-upload-image/opts.js` 默认值含个人标识 `UPYUN_DOMAIN=img.shiker.tech`、`UPYUN_PREFIX=weedit`，公开前建议改为占位符。
- [ ] 审核已跟踪的 `.idea/` 和 UX 审计图片。删除只属于个人 IDE 的配置；保留截图时确保没有账号、路径、密钥、未公开内容或第三方受限素材。
  - 2026-07-31 扫描发现：`.idea/` 9 个文件仍在 HEAD 跟踪（内容均为 `$PROJECT_DIR$` 占位，无敏感信息），建议取消跟踪并加入 `.gitignore`；`docs/ux-audit-2026-07-29/*.png` 在工作树已删除但未提交，历史（1921679）中仍存在。
- [ ] 提供完全虚构且可公开的 `account-context.example.json`，或者在 README 中明确说明字段格式；不得提交真实账号画像。
- [ ] 增加提交前秘密扫描规则，并在 CI 中执行。若历史曾泄密，先轮换密钥，再重写历史；两步缺一不可。

### 2.3 安全边界

> 实施记录（2026-07-31）：完成 7 类入口威胁建模盘点（结论见 `docs/threat-model.md`），修复 4 个真实问题——技能包 install/update/status/delete 补 `x-admin-confirm` 校验（服务端+前端确认弹窗）、图片预览页 title 补 `"` 转义、rsshub 内网判定补 100.64/10 等漏段（复用 remote-adapter `privateIp`）、url-fetch 插件增加本机/内网目标拒绝；新增 `test/security-boundaries.test.mjs` 7 例（确认头、Zip Slip、保留段、url-fetch 拦截、响应超限、title 转义）。已接受风险（DNS TOCTOU、产物 HTML 无 CSP、typeset 自动上传 CDN、确认头无 Origin 校验）均记录在威胁建模文档。

- [x] 新增 `SECURITY.md`，说明支持版本、私下报告渠道、响应预期和不应公开提交的漏洞材料。
- [x] 在 README 和部署文档显著声明：当前版本仅支持本机可信用户，不支持公网部署。确认服务始终绑定回环地址，配置不能无提示改为 `0.0.0.0`。（`server.mjs` `listen('127.0.0.1')` 为硬编码，无 host 配置项）
- [x] 对以下高风险入口完成威胁建模与安全测试：
  - 本地项目目录读取、产物相对资产读取与路径穿越；
  - ZIP 备份校验 / 恢复、Zip Slip、超大压缩包和恢复回滚；
  - 受信本地 adapter 的安装、版本回滚与管理员确认头；
  - 远程 API / MCP 插件的 DNS 重绑定、重定向、SSRF、凭据隔离和响应大小；
  - URL 抓取的内网地址、IPv6、混合编码和重定向绕过；
  - CDN 等 `external-write` 操作的逐次授权和审计脱敏；
  - HTML / Markdown 预览的脚本注入、事件属性、危险 URL 与本地文件暴露。
- [x] 明确 `x-admin-confirm`、`x-restore-confirm` 只是本机防误操作确认，不是鉴权。若未来支持局域网或公网，另立项目实现登录、CSRF、最小权限、速率限制、审计主体和密钥管理。（见 `docs/threat-model.md` §0 与 §2.4）
- [x] 为模型服务商、Firecrawl、Tavily、GitHub、RSSHub、Reddit 和又拍云整理数据流说明：发送什么、何时发送、保存多久、如何删除。（`docs/data-flow.md`）

### 2.4 可复现安装与基础文档

> 实施记录（2026-07-31）：`.env.example` 补 `TAVILY_API_KEY`、`GITHUB_TOKEN`；`config.example.json` 对齐内置默认值（补 GitHub Trending 路由、`githubDiscovery`、`tavily`、`sourceFetch`、`taggingChunkSize/Concurrency`、`webSearchConfig`，修正 `keepAlive`）；新增 `test/example-config-sync.test.mjs` 与 `test/api-docs-routes.test.mjs` 把示例配置、API.md 与代码双向钉死（API.md 补 2 条护栏路由记录）。README 新增「支持矩阵」与 `node:sqlite`/生成目录/备份/删除/升级说明。冷启动验收（`scripts/cold-start-acceptance.sh`，临时目录重建 → `npm ci` → `build` → `test` → 无密钥启动 → 停止脚本）全绿：432/432 测试通过，无密钥时 `/api/overview` 200、`/api/models` 返回 `configured:false` 降级视图。验收中发现并修复 3 个真实问题：`article-pipeline` 测试硬编码仓库目录名、`research-pipeline` 测试隐式依赖本机 `account-context.json`（`selectDimensionPool` 新增 `accountContext` 注入参数）、技能级依赖无自动化安装（新增 `scripts/install-skill-deps.mjs` 挂 `postinstall` 级联安装 `skills/*/package.json`）。

- [x] 校准 `.env.example` 与 `lib/integrations/runtime-settings.mjs` 的字段，补齐 `TAVILY_API_KEY`、`GITHUB_TOKEN` 等当前支持项，并确保注释 UTF-8 正常。（`APP_FIELDS` 已导出，一致性由 `test/example-config-sync.test.mjs` 固化，含乱码检测）
- [x] 校准 `config.example.json` 与 `lib/core/config.mjs` 的当前默认结构，特别是 GitHub 项目发现、GitHub Trending 路由、`sourceFetch`、Tavily、RSSHub `keepAlive` 和模型并发参数。（键集合与叶子值逐条比对，路径字段除外）
- [x] 明确支持矩阵：Windows 版本、PowerShell、Node.js 24、Python 的必要 / 可选范围、Chrome / Chromium、RSSHub、网络服务商和磁盘空间。（README「启动 → 支持矩阵」）
- [x] 从全新目录按公开文档执行一次冷启动验收：`npm ci`、`npm run build`、`npm test`、首次启动、无密钥降级、单服务商配置和停止脚本。（`scripts/cold-start-acceptance.sh` 全绿；单服务商配置与无密钥共用 `/api/models` 的 `configured` 标记，界面层按此降级）
- [x] 说明 Node.js 24 的 `node:sqlite` 依赖、生成目录、备份内容、数据删除方法和升级兼容策略。（README「数据与产物」节）
- [x] 为 `API.md` 增加自动路由清单校验，至少保证代码中的方法 + 路径不会无文档新增或在删除后残留。（`test/api-docs-routes.test.mjs`：覆盖字面量/数组/变量正则/内联正则路由与 `###`、行内代码两种文档形式，双向比对）

### 2.5 仓库治理与质量门禁

- [x] 新增 `CONTRIBUTING.md`，说明开发环境、分支 / 提交约定、测试要求、技能和插件扩展流程、文档同步要求。
- [x] 新增 `CODE_OF_CONDUCT.md`、Issue 模板、Pull Request 模板和维护者 / CODEOWNERS 规则。
- [x] 建立 CI，至少执行：
  - `npm ci`；
  - `npm run build`；
  - `npm test`；
  - 技能包和内置工具插件校验；
  - 依赖漏洞、许可证和秘密扫描。
- [x] 区分快速、浏览器、网络和平台相关测试；CI 不应依赖真实 API Key、用户 Chrome Profile、RSSHub 常驻进程或外部 CDN 写入。
- [x] 决定是否保留 `.idea/`、审计产物和大型截图；用仓库体积预算或 Git LFS 管理确需保留的大文件。

> 实施记录（2026-07-31）：
>
> - 测试分层：新增 `test/helpers/tiers.mjs`（`SKIP_BROWSER_TESTS=1` 时跳过浏览器层），7 个依赖真实浏览器/Puppeteer 缓存的测试已打标（`test/social-card-p2.test.mjs` 4 个、`test/typeset-chart-render.test.mjs` 2 个、`test/typeset-pipeline.test.mjs` 1 个）；新增 `npm run test:fast`（`scripts/test-fast.mjs`），实测 425 过 / 7 跳过 / 0 失败。CI 用缓存的 Puppeteer 跑全量，本地无浏览器缓存时用 test:fast。全部测试不依赖真实 API Key、用户 Chrome Profile、RSSHub 常驻进程或 CDN 写入（CDN 上传在测试中走 mock）。
> - 治理文件：`CONTRIBUTING.md`（开发环境、分支/提交约定、测试分层说明、技能与插件扩展流程、文档同步要求、仓库体积约定）；`CODE_OF_CONDUCT.md`（Contributor Covenant 2.1 中文版）；`.github/ISSUE_TEMPLATE/bug_report.md` 与 `feature_request.md`；`.github/PULL_REQUEST_TEMPLATE.md`；`.github/CODEOWNERS`（维护者 @shiker1996，安全核心文件单列）。
> - CI：`.github/workflows/ci.yml`（windows-latest + Node 24，缓存 npm 与 `~/.cache/puppeteer`），步骤为 `npm ci` → `npm run build` → `npm test`（全量含浏览器层）→ 校验 `docs/examples/skill-package` 与 `docs/examples/tool-plugin` 两个示例包 → `npm audit --audit-level=high --omit=dev`（实测 0 漏洞）→ `node scripts/license-scan.mjs` → `node scripts/secret-scan.mjs`。内置技能多数不过第三方包校验器（agents/openai.yaml、source.type 等属设计使然），故 CI 只校验示例包。
> - 扫描脚本：`scripts/secret-scan.mjs` 扫全部 git 跟踪文件（396 个）的高危密钥模式，实测 exit 0；`scripts/license-scan.mjs` 扫根 + 技能级 lockfile（528 依赖），强 copyleft 失败、弱 copyleft 警告，实测 exit 0（4 个警告：dompurify MPL-2.0 OR Apache-2.0、elkjs EPL-2.0、khroma 与 html-pages-to-images 未声明许可证）。
> - 顺带修复：`lib/skills/package-manager.mjs` 的包校验器此前只认 .md/.json/.txt，无扩展名的 LICENSE 文件会被拒——新增 `ALLOWED_LICENSE_FILES` 白名单（license/notice 各形态），目录校验与 ZIP 校验两处统一走 `allowedSkillFile()`。
> - 仓库体积：实测最大跟踪文件 public/styles.css 177KB、markdown-it.min.js 124KB、package-lock.json 111KB，无超 1MB 文件；`.git` 约 47MB（历史重写后）。体积预算与「大文件不入库」约定已写进 CONTRIBUTING「仓库体积约定」节，暂不引入 Git LFS。`.idea/` 已在 2.2 移出跟踪并加入 .gitignore。

## 3. P1：首次公开版本前建议完成

### 3.1 发布与版本

- [ ] 决定项目是“源码仓库”还是也发布 npm 包。若不发布 npm 包，可继续 `private: true`，但需在 README 说明；若发布，补齐 `name`、`version`、`license`、`repository`、`bugs`、`homepage`、`engines`、`files` 和发布前校验。
- [ ] 采用语义化版本，新增 `CHANGELOG.md`，定义数据库 Schema、技能契约、插件 Manifest 和 REST API 的兼容政策。
- [ ] 建立带校验和的 release 流程，明确升级、降级、备份和恢复步骤。
- [ ] 为数据库迁移、安装技能版本和插件版本建立跨版本验收样例。

### 3.2 架构与扩展文档

- [ ] 增加架构总览：HTTP 路由、SQLite Store、后台任务、LLM 网关、技能运行时、工具注册中心、文章链和图文链之间的关系。
- [ ] 把当前设计评审文档分成“现状”“历史决策”“未来计划”，避免读者把已经上线的功能误认为待办。
- [ ] 给技能包、本地工具插件和远程插件各提供一个最小可运行示例、权限说明、失败语义和版本兼容规则。
- [ ] 为 NDJSON 流、后台任务、错误响应和确认头补充可复制的 `curl` / PowerShell 示例；视维护成本决定是否生成 OpenAPI。

### 3.3 用户可控性

- [ ] 增加数据导出、按批次删除、完整清空和缓存清理说明；删除操作应先展示影响范围并可恢复。
- [ ] 在 UI 中统一标注会产生费用、会向第三方发送内容或会产生外部写入的操作。
- [ ] 为模型和信息工具提供超时、重试、并发和预算的安全默认值及说明。
- [ ] 给远程插件增加域名 / 权限摘要和首次执行确认，避免“安装即信任所有能力”。

## 4. P2：开源后的持续工作

- [ ] 建立维护者轮值、Issue 分类、版本节奏和安全修复发布流程。
- [ ] 配置 Dependabot 或同类依赖更新，并定期复核 Node.js、Puppeteer / Chromium、Mermaid 与 SQLite 兼容性。
- [ ] 采集匿名遥测前必须单独设计并默认关闭；当前不要因开源自动加入遥测。
- [ ] 增加 macOS / Linux 可行性评估。若继续只支持 Windows，应明确标注，不让社区误以为跨平台已经可用。
- [ ] 建立 API、数据库、技能契约和插件 Manifest 的弃用周期。
- [ ] 定期复查第三方服务条款、抓取合规、内容版权和模型输出使用政策。
- [ ] 发布贡献者指南中的“好首个 Issue”和可独立开发的扩展点，但不要把安全核心、密钥处理或恢复逻辑作为无审阅的新手任务。

## 5. 建议的公开门禁

满足以下条件后，再把仓库可见性切换为 Public：

1. 许可证与第三方再分发审计通过。
2. 当前工作树和 Git 历史的秘密 / 隐私扫描通过，发现的密钥已轮换。
3. `SECURITY.md`、`CONTRIBUTING.md`、行为准则和维护者信息就绪。
4. 在干净的 Windows 环境完成安装、构建、测试和本地启动。
5. CI 在无密钥环境通过，外部写入测试均为 mock 或显式跳过。
6. README 明确本机单用户边界，不提供误导性的公网部署步骤。
7. 示例配置与当前代码一致，API 路由清单校验通过。
8. 公开版本不包含真实数据、账号上下文、日志、数据库、浏览器 Profile、备份、私有图片或未获授权素材。

