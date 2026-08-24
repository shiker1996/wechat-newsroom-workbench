# 插件边界收敛与独立安装改造方案

> 文档类别：未来计划  
> 状态：Phase 0–6 已完成  
> 最后更新：2026-08-13

## 1. 背景

当前内置工具插件与采集插件已统一打平到 `plugins/<directory>/`，并通过 Manifest 的 `kind` 区分 `tool` 与 `collector`。目录结构已经统一，但插件代码仍存在三类隐式耦合：

1. 插件直接 import 另一个插件的源码；
2. 插件通过 `plugins/shared` 复用业务实现；
3. 插件引用项目的 `skills/`、`scripts/` 或用户目录中的 Codex Skill。

这些依赖使插件无法真正独立安装、升级、卸载和回滚。第三方插件包校验禁止 import 越过包目录，但部分内置插件仍依赖内置仓库结构，导致“内置插件模型”和“第三方插件模型”不一致。

本方案的目标不是把所有代码集中到 `shared`，而是收敛插件边界：

> 公共的是协议与宿主能力，业务实现归插件所有；插件之间通过能力调用，不通过源码引用。

## 2. 目标与非目标

### 2.1 目标

- 每个插件目录可以作为独立安装包校验和加载；
- 插件只依赖自身文件、Node.js 内置模块、宿主运行上下文及明确声明的外部依赖；
- 禁止插件 import 其他插件、`server/`、`scripts/`、`skills/` 或用户主目录文件；
- 插件间协作统一通过 capability 调用；
- 插件代码与缓存、Profile、PID、临时文件分离；
- 内置与第三方插件使用相同的包边界和安全门禁；
- 允许少量实现重复，以换取独立安装和独立演进。

### 2.2 非目标

- 本轮不追求消除所有重复代码；
- 不把 GitHub、RSS、CDP 等具体业务实现全部变成宿主 SDK；
- 不改变现有能力 ID 和业务结果契约，除非迁移阶段明确记录兼容层；
- 不要求一次性完成全部插件重写。

## 3. 最终边界模型

### 3.1 插件允许依赖

```text
plugins/<plugin-id>/**
node:*
宿主注入的 configuration / logger / storage / credentials / network / capabilities
Manifest 明确声明并由宿主校验的外部运行依赖
```

### 3.2 插件禁止依赖

```text
plugins/<other-plugin>/**
plugins/shared/**（最终删除）
server/**
scripts/**
skills/**
%USERPROFILE%/.codex/**
工作区外绝对路径
```

### 3.3 协作方向

正确依赖方向：

```text
Skill → capability → Plugin
Plugin → context.capabilities.invoke(...) → Plugin
Plugin → context.sdk / context.network / context.storage → Host
```

禁止方向：

```text
Plugin → import 其他 Plugin 源码
Plugin → Skill 脚本
Plugin → 用户目录中的 Skill
```

## 4. 当前依赖基线

### 4.1 插件间直接引用

| 调用方 | 被引用插件 | 当前引用 | 目标处置 |
|---|---|---|---|
| `browser-web-page` | `declarative-web-page` | URL 公网安全校验 | 各插件内聚校验；宿主网络策略作为强制兜底 |
| `feed` | `rsshub` | RSS 采集与测试实现 | 保持独立；Feed 内聚直连 RSS/Atom，RSSHub 仅负责路由与服务生命周期 |
| `rsshub` | `github-discovery` | GitHub 仓库发现 | 移除源码引用；Trending 标准化留在 Feed，Discovery 独立运行 |
| `url-fetch` | `repository-inspector` | 仓库检查实现 | 改为可选 capability 调用并支持普通网页降级 |

### 4.2 `plugins/shared` 当前职责

| 文件/职责 | 目标归属 |
|---|---|
| `schemas.mjs`、`result.mjs` | 宿主结果协议；过渡期可在插件内保留极小封装 |
| `manifest-contract.mjs` | 宿主插件 SDK / Manifest 校验层 |
| `network-safety.mjs` | 宿主强制网络策略；插件可内置场景化预检 |
| `github-client.mjs` | 短期分别内聚；长期由宿主提供受控 GitHub HTTP 服务 |
| `chart-adapter.mjs` | Mermaid、ECharts 各自插件内实现 |
| `cdp-client.mjs` | 归入唯一消费者 `reddit` |

### 4.3 跨项目引用

| 插件 | 当前跨界依赖 | 目标处置 |
|---|---|---|
| `url-fetch` | `scripts/fetch-hotspot-url.py`、工作区缓存路径 | 脚本移入插件；缓存改用 `context.storage` |
| `mermaid-render` | `skills/mermaid-render/scripts/*` | 渲染实现移入插件，Skill 通过 capability 调用插件 |
| `echarts-render` | `skills/wechat-echarts-blocks-to-images/scripts/*` | 渲染实现移入插件 |
| `upyun-image-upload` | `%USERPROFILE%/.codex/skills/upyun-upload-image/*` | 上传实现移入插件，凭据由宿主配置注入 |
| `reddit` | 插件目录内浏览器 Profile | 迁移到 `data/plugin-runtime/reddit-collector/` |

## 5. 目标目录结构

```text
plugins/
  feed/
    manifest.json
    adapter.mjs
    rss-parser.mjs
    rsshub-runtime.mjs
  reddit/
    manifest.json
    adapter.mjs
    collector.mjs
    cdp-client.mjs
    scripts/
  url-fetch/
    manifest.json
    adapter.mjs
    implementation.mjs
    scripts/
  repository-inspector/
  mermaid-render/
    manifest.json
    adapter.mjs
    render.mjs
  echarts-render/
    manifest.json
    adapter.mjs
    render.mjs
  upyun-image-upload/
    manifest.json
    adapter.mjs
    upload.mjs

server/platform/plugin-sdk/
  contracts.mjs
  errors.mjs
  runtime-context.mjs
  policy.mjs

data/plugin-runtime/<plugin-id>/
  cache/
  profiles/
  state/
  tmp/
```

`server/plugin-sdk` 是宿主实现，不允许插件通过相对路径 import。运行时通过上下文注入服务；第三方包不需要携带 SDK 源文件。

## 6. Manifest 扩展

增加显式能力依赖：

```json
{
  "requiredCapabilities": [],
  "optionalCapabilities": ["repository.inspect"]
}
```

语义：

- `requiredCapabilities` 缺失时，插件标记为不可用，并展示阻断原因；
- `optionalCapabilities` 缺失时允许加载，由插件执行降级路径；
- 能力依赖必须进入统一能力图、停用影响分析和执行审计；
- Manifest 依赖只声明能力，不声明另一个插件 ID，保持实现可替换。

## 7. 宿主运行上下文

逐步统一 Adapter 上下文：

```js
export function createAdapter({
  configuration,
  logger,
  network,
  credentials,
  storage,
  capabilities,
  result,
}) {}
```

职责：

- `network`：公网地址校验、域名权限、超时、响应大小和审计；
- `storage`：返回当前插件专属的数据目录，不接受任意工作区路径；
- `credentials`：按 Manifest 声明读取凭据 Profile，不暴露配置文件路径；
- `capabilities`：按能力 ID 调用其他实现，保留候选链、降级和审计；
- `result`：生成统一 `ok`、`failure` 结果；
- `logger`：结构化日志，不复制秘密和大段正文。

## 8. 分阶段实施方案

### Phase 0：冻结新增耦合

> 实施状态：已完成（2026-08-13）。当前基线记录 28 项存量违规，新增违规为 0。执行 `npm run plugin:audit-boundaries` 可复查；基线位于 `docs/plugin-boundary-baseline.json`。

目标：先建立门禁，避免迁移期间继续增加跨目录依赖。

任务：

1. 新增插件边界扫描测试；
2. 同时扫描静态 import、动态 import、`new URL()`、`path.resolve/join` 和硬编码用户目录；
3. 为现有违规项建立精确临时基线，不允许新增；
4. 内置和第三方插件共用同一包边界校验器；
5. CI 输出插件、文件、依赖目标和建议处理方式。

验收：

- 新增跨插件或跨项目依赖会使测试失败；
- 基线中的每项违规都有后续 Phase 和负责人字段；
- `plugins/<id>` 复制到临时目录后能独立完成 Manifest 静态校验。

已交付：

- `server/plugins/boundary-audit.mjs`：仓库级与包级边界扫描；
- `docs/plugin-boundary-baseline.json`：带 Phase、owner、resolution 的存量治理基线；
- `scripts/quality/audit-plugin-boundaries.mjs`：CI/本地审计命令；
- `scripts/quality/snapshot-plugin-boundary-baseline.mjs`：仅在经评审后刷新基线；
- `test/plugin-boundary.test.mjs`：冻结现有违规并阻止新增；
- 工具与采集器安装校验：拒绝越界 import、项目 `skills/scripts` 和用户 Codex Skill 路径。

### Phase 1：回收低成本共享代码

> 实施状态：已完成（2026-08-13）。边界基线由 28 项降至 21 项；Reddit、两类网页采集器和采集结果封装已解除对应 shared 依赖。

目标：清理没有共享价值或只有单一消费者的代码。

任务：

1. `cdp-client.mjs` 移入 `reddit`；
2. URL 网络预检分别内聚到 `browser-web-page` 与 `declarative-web-page`；
3. `result` 极小封装暂时复制进需要的采集插件；
4. 运行时网络策略继续作为不可绕过的第二道防线；
5. 迁移 Reddit Profile 到 `data/plugin-runtime/reddit-collector/profiles`，保留旧路径兼容迁移。

验收：

- 删除对应 `plugins/shared` 文件；
- Reddit 升级、卸载不会影响登录 Profile；
- 两种网页采集器可分别打包并通过健康检查。

已交付：

- Reddit 的 `cdp-client.mjs`、`result.mjs` 已内聚到插件目录；
- `browser-web-page` 与 `declarative-web-page` 分别拥有场景化网络预检；
- Feed、RSSHub、GitHub Discovery 的极小结果封装已内聚，`plugins/shared/result.mjs` 已删除；
- Reddit Profile 改存 `data/plugin-runtime/reddit-collector/profiles/<profile-id>`；
- 新目录不存在时自动迁移旧 `plugins/reddit/data` Profile，不覆盖已有新数据；
- 手动启动脚本与批次采集统一使用新 Profile 路径。

### Phase 2：收敛采集插件

> 实施状态：已完成（2026-08-13）。Feed 与 RSSHub 保持两个独立插件，边界基线由 21 项降至 19 项；插件 ID、来源类型和订阅数据结构均未改变，无需迁移。

目标：减少职责重叠和采集器源码耦合。

任务：

1. 保持 `feed-collector` 与 `rsshub-collector` 独立，不改变插件 ID 和来源绑定；
2. Feed 内聚 RSS/Atom 解析、公网 URL 校验、直连抓取与测试实现；
3. RSSHub 仅负责路由采集、服务启停及 GitHub Trending 路由结果标准化；
4. 移除 `rsshub → github-discovery` 源码引用；
5. GitHub Search/AI Discovery 继续由独立插件提供；
6. 订阅测试和失败重试按来源类型路由到对应插件，不再借用 RSSHub 处理直连 Feed。

验收：

- Feed 插件可独立安装和运行；
- 旧订阅源无需用户重新创建；
- 历史执行记录仍能识别旧插件 ID；
- 两个插件目录间不存在直接 import。

### Phase 3：能力调用替代插件源码引用

> 实施状态：已完成（2026-08-13）。工具 Manifest 已支持必需/可选能力依赖，Adapter 可通过受控上下文调用子能力；`url-fetch` 已移除对 `repository-inspector` 的源码引用，边界基线由 19 项降至 18 项。

目标：让插件协作只依赖能力契约。

任务：

1. Manifest 支持 `requiredCapabilities`、`optionalCapabilities`；
2. Adapter 上下文增加 `capabilities.invoke`；
3. `url-fetch` 通过 `repository.inspect` 可选能力处理 GitHub 仓库；
4. 缺少仓库检查能力时降级为普通网页抓取；
5. 将依赖状态纳入能力图、工具卡和停用影响分析；
6. 执行日志记录父调用、子调用和降级原因。

验收：

- `url-fetch` 不再 import `repository-inspector`；
- 卸载 `repository-inspector` 不会阻断普通 URL 抓取；
- 安装其他 `repository.inspect` 实现后无需修改 `url-fetch`。

### Phase 4：收回跨项目执行实现

> 实施状态：已完成（2026-08-13）。URL 抓取、Mermaid、ECharts 与 Upyun 上传脚本已归入各自插件；插件不再从项目 `scripts/`、`skills/` 或用户 Codex 目录加载运行实现，也不再自行扫描用户目录中的 Python。边界基线由 18 项降至 12 项。

目标：插件包包含完整运行实现。

任务：

1. URL 抓取 Python 脚本移入 `url-fetch/scripts`；
2. Mermaid 渲染脚本移入 `mermaid-render`；
3. ECharts 渲染脚本移入 `echarts-render`；
4. Upyun 上传实现移入 `upyun-image-upload`；
5. Skill 改为调用 capability，不再被插件反向依赖；
6. 缓存、临时文件和产物路径改用宿主 storage/artifact 服务。

验收：

- 插件源码不引用 `skills/`、项目 `scripts/` 或 `%USERPROFILE%/.codex`；
- 每个插件从独立临时目录加载并通过健康检查；
- 未安装外部二进制时返回标准 `DEPENDENCY_MISSING` 和修复动作。

### Phase 5：建立正式 Plugin SDK

> 实施状态：已完成（2026-08-13）。宿主已通过运行上下文注入结果协议、网络策略、GitHub 请求服务与能力调用器；`plugins/shared` 已删除，插件间与插件到项目源码的边界基线归零。

目标：删除复制的协议代码和剩余 `plugins/shared`。

任务：

1. 建立 `server/plugin-sdk` 宿主实现；
2. 通过 Adapter 上下文注入结果、网络、凭据、存储、日志服务；
3. GitHub 凭据、限流、缓存和审计收敛为宿主受控网络服务；
4. 插件移除对 `shared/schemas`、`network-safety`、`github-client` 的源码依赖；
5. 删除 `plugins/shared`；
6. 冻结 SDK 版本并纳入 `compatibleApp` 校验。

验收：

- `plugins/shared` 不存在；
- 插件目录间没有源码依赖；
- SDK 不暴露任意文件系统和未审计网络访问；
- SDK 升级具有版本兼容测试。

### Phase 6：独立安装与升级验收

> 实施状态：已完成（2026-08-13）。15 个内置插件均可生成不携带其他插件源码、运行数据和 `node_modules` 的独立分发包，并通过与第三方插件相同的 Manifest、依赖白名单、边界、加载、启停和卸载校验；工具与采集插件均具备升级归档和回滚能力。

目标：证明所有内置插件与第三方插件遵循同一模型。

对每个插件执行：

1. 复制到独立临时目录；
2. 不携带其他插件源码；
3. 校验 Manifest 和 import 边界；
4. 加载入口并执行健康检查；
5. 验证启用、停用、升级、回滚和卸载；
6. 验证插件数据不随代码卸载丢失；
7. 验证必需能力缺失时阻断、可选能力缺失时降级；
8. 验证执行日志不泄露秘密或正文。

验收：全部内置插件通过同一套第三方插件生命周期测试。

已交付：

- `server/plugins/distribution.mjs`：补齐分发元数据并生成独立包；
- `npm run plugin:verify-distribution`：逐包执行第三方插件校验；
- `test/plugin-isolated-install.test.mjs`：覆盖 15 个内置插件的隔离加载、安装、启停和卸载；
- 采集插件升级采用原子替换和版本归档，并支持版本列表与回滚；
- 插件包允许受控的 `.py`、`.ps1` 实现和白名单 `runtimeDependencies`；
- 分发包强制排除 `data` 与 `node_modules`，运行数据保留在 `data/plugin-runtime/<plugin-id>`；
- 工作台备份与恢复纳入 `collector-plugin-archive`，不纳入浏览器登录 Profile。

## 9. 合并与拆分标准

满足以下多数条件时合并插件：

- 面向同一用户任务；
- 使用相同配置、凭据和生命周期；
- 单独启停没有实际用户价值；
- 大部分实现必须共享；
- 故障诊断和权限边界一致。

满足以下条件时保持独立：

- 能提供独立能力；
- 可以独立启停、升级或替换；
- 风险、权限或运行依赖不同；
- 使用不同凭据和配置；
- 其他插件可能通过 capability 复用。

据此，`feed` 与 `rsshub` 应保持独立：前者是无外部服务生命周期的直连协议采集器，后者依赖独立 RSSHub 服务且具有启停配置；`url-fetch` 与 `repository-inspector`、`rsshub` 与 `github-discovery` 同样应保持独立并改为能力协作或职责解耦。

## 10. 测试与 CI 门禁

至少增加以下测试：

- `plugin-boundary.test.mjs`：禁止跨插件、跨项目和用户目录引用；
- `plugin-isolated-load.test.mjs`：逐个复制并独立加载；
- `plugin-capability-dependencies.test.mjs`：必需/可选能力行为；
- `plugin-runtime-storage.test.mjs`：代码与运行数据隔离；
- `plugin-lifecycle.test.mjs`：安装、重启、启停、升级、回滚和卸载；
- `plugin-sdk-compat.test.mjs`：SDK 与应用版本兼容。

扫描不能只检查静态 `import`，还要覆盖：

- `import()`；
- `new URL('./file', import.meta.url)`；
- `path.resolve()`、`path.join()`；
- `execFile()`、`spawn()` 调用的脚本；
- `%USERPROFILE%`、`HOME`、`.codex/skills` 等硬编码路径。

## 11. 迁移与回滚策略

- 每个 Phase 独立提交，禁止把目录移动、能力 ID 变更和数据迁移混为一次大提交；
- 旧插件 ID、配置字段和数据目录至少保留一个版本的读取兼容；
- 数据迁移采用复制/确认/切换流程，不直接删除旧 Profile 或缓存；
- 能力调用改造先保留旧实现兜底，验证后再删除源码依赖；
- 合并插件前导出来源绑定和配置快照，失败时可恢复旧路由；
- 每个 Phase 必须通过完整测试、构建、插件独立加载测试和 `git diff --check`。

## 12. 实施顺序与交付物

| 顺序 | Phase | 主要交付物 |
|---|---|---|
| 1 | Phase 0 | 边界扫描器、违规基线、CI 门禁 |
| 2 | Phase 1 | Reddit/CDP 与网页安全实现内聚、运行数据迁移 |
| 3 | Phase 2 | Feed/RSSHub 职责解耦、订阅测试与失败重试分流 |
| 4 | Phase 3 | Manifest 能力依赖、运行时 capability 调用 |
| 5 | Phase 4 | URL、图表、Upyun 实现回收到插件包 |
| 6 | Phase 5 | Plugin SDK、删除 `plugins/shared` |
| 7 | Phase 6 | 全插件独立安装与生命周期验收 |

建议从 Phase 0 开始实施。先建立门禁，后续每完成一个插件即可从临时违规基线中删除一项，直到基线清零。

## 13. 完成定义

同时满足以下条件，插件收敛改造才算完成：

- `plugins/<id>` 之间不存在源码 import；
- `plugins/shared` 已删除；
- 插件不引用项目 `server/`、`scripts/`、`skills/` 和用户目录；
- 插件间协作全部通过能力契约；
- 插件运行数据全部位于 `data/plugin-runtime/<id>`；
- 所有内置插件可以按第三方插件流程独立安装和运行；
- 单个插件的升级、停用或卸载不会破坏其他插件；
- 完整测试、构建和插件边界 CI 全部通过。
