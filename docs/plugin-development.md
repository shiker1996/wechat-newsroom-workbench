# 见字插件开发指南

> 类别：现状。适用于应用 0.5.x、Manifest `schemaVersion: 1`。

## 1. 扩展模型

工作台有三条扩展轴：

| 扩展 | 作用 | 是否执行代码 | 示例 |
|---|---|---|---|
| 技能包 | 提供 Prompt、角色、输入输出契约和能力声明 | 否 | `docs/examples/skill-package/` |
| 工具插件 | 提供抓取、搜索、渲染、上传等通用能力 | 本地插件是；远程插件否 | `docs/examples/tool-plugin/`、`docs/examples/remote-tool-plugin/` |
| 采集器插件 | 提供可在采集源页面创建的来源类型 | 本地插件是；远程插件否 | `docs/examples/collector-plugin/` |

三者都使用 kebab-case ID、SemVer 版本、`schemaVersion: 1` 和 `compatibleApp`。第三方扩展安装后默认停用，启用和首次执行仍受权限门禁控制。

## 2. 通用设计原则

> 插件边界正在按 [插件边界收敛与独立安装改造方案](./plugin-boundary-convergence-plan.md) 统一。新增插件不得直接 import 其他插件、项目 `lib/` / `scripts/` / `skills/` 或用户目录文件；插件间协作应声明并调用 capability。现有内置插件的少量跨目录依赖属于待迁移项，不应作为开发范例。

1. Manifest 是唯一能力与权限声明，不要在运行时偷偷扩大范围。
2. 输入输出必须是 JSON 可序列化对象，并通过 Schema 校验。
3. 本地 Adapter 只允许 `node:` 和包内相对 import，不允许未审计 npm 依赖。
4. 远程端点必须使用 HTTPS，并拒绝 localhost、内网、保留地址和重定向绕过。
5. `external-write` 必须由用户显式授权；健康检查不得产生外部写入。
6. 插件抛出可读错误；不要吞掉失败或伪造空成功。
7. 安装目录内容会计算 SHA-256；安装后直接修改文件会导致完整性校验失败。

## 3. 本地工具插件

### 3.1 目录

```text
my-tool/
├─ manifest.json
├─ adapter.mjs
├─ README.md       可选
└─ LICENSE         可选
```

允许 `.mjs`、`.json`、`.md`、`.txt`，最多 100 个文件、10 MB，禁止符号链接和越界 import。

### 3.2 Manifest

最小示例：

```json
{
  "schemaVersion": 1,
  "id": "example-text-stats",
  "name": "示例文本统计",
  "version": "1.0.0",
  "kind": "tool",
  "type": "local-adapter",
  "capabilities": ["text.stats"],
  "entry": "./adapter.mjs",
  "riskLevel": "read-only",
  "inputSchema": {
    "type": "object",
    "required": ["text"],
    "properties": {"text": {"type": "string"}}
  },
  "outputSchema": {"type": "object"},
  "runtime": {},
  "compatibleApp": ">=0.5.0",
  "source": {"type": "reviewed-package", "url": "https://example.com/my-tool"},
  "permissions": {
    "networkDomains": [],
    "pathAccess": [],
    "externalWrite": false,
    "credentials": []
  },
  "healthCheck": true,
  "enabledByDefault": false
}
```

`riskLevel` 可用值：`read-only`、`local-write`、`network-read`、`external-write`。内置浏览器采集器还使用 `browser-read`，普通工具插件应按校验器允许范围选择。

`configuration` 可声明由配置中心渲染的 JSON Schema；秘密字段使用 `"secret": true`，不要把 Key 写入普通默认值。

### 3.3 Adapter

```js
export async function health() {
  return { status: "ok", data: { available: true } };
}

export async function execute(input, context) {
  const text = String(input.text || "");
  return {
    status: "ok",
    data: { characters: [...text].length },
    provenance: { source: "local" }
  };
}
```

成功返回 `status: "ok"` 和 `data`；失败可以抛出 `Error`，注册中心会标准化并写入执行审计。输出必须满足 `outputSchema`。

路径输入应在 Manifest 的 `pathInputs` 中登记，并在输入 Schema 声明为字符串。运行时会使用 realpath 检查授权根目录，符号链接不能绕过边界。

### 3.4 校验

```powershell
npm run plugin:validate -- docs/examples/tool-plugin
```

## 4. 远程工具插件

远程插件只安装 JSON Manifest，不分发代码。支持 `remote-api` 与声明式 MCP 形态，示例见 `docs/examples/remote-tool-plugin/`。

关键字段包括：

- `endpoint`：HTTPS 执行端点；
- `healthEndpoint`：可选健康检查端点；
- `credentialProfile`：隔离凭据配置；
- `timeoutMs`：请求超时；
- `maxResponseBytes`：最大响应体；
- `permissions.networkDomains`：域名白名单；
- `riskLevel`：`network-read` 或 `external-write`。

安装、启用不等于获得执行信任。第一次真实调用会返回 `FIRST_RUN_CONFIRM_REQUIRED`，用户在界面确认域名、凭据与写入风险后才可执行。

## 5. 采集器插件

采集器把“某类来源配置”转换为标准内容条目。来源由 `pluginId + sourceType + config` 持久化，运行时按来源类型和优先级选择实现并支持候选兜底。

### 5.1 本地采集器目录

```text
my-collector/
├─ manifest.json
└─ adapter.mjs
```

### 5.2 Manifest

```json
{
  "schemaVersion": 1,
  "id": "example-local-collector",
  "name": "示例本地采集器",
  "version": "1.0.0",
  "kind": "collector",
  "type": "local-collector",
  "capabilities": ["collect.example-news"],
  "riskLevel": "network-read",
  "entry": "adapter.mjs",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["url"],
    "properties": {"url": {"type": "string", "format": "url"}}
  },
  "outputSchema": {
    "type": "object",
    "required": ["items"],
    "properties": {"items": {"type": "array", "items": {"type": "object"}}}
  },
  "runtime": {"timeoutMs": 15000, "concurrency": "parallel"},
  "collector": {
    "sourceTypes": ["example-news"],
    "sourceConfigSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["url"],
      "properties": {"url": {"type": "string", "format": "url", "title": "JSON 地址"}}
    }
  },
  "compatibleApp": ">=0.5.0",
  "permissions": {
    "networkDomains": ["example.com"],
    "pathAccess": [],
    "externalWrite": false,
    "credentials": []
  }
}
```

采集器不得声明本地路径访问或外部写入。远程采集器使用 `type: "remote-collector"` 和 `endpoint`，不含 `entry`；端点域名必须在白名单中。

### 5.3 Adapter 契约

```js
export async function collect(config, context) {
  const response = await fetch(config.url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const records = await response.json();
  return {
    status: "ok",
    items: records.map((item) => ({
      title: item.title,
      url: item.url,
      summary: item.summary || "",
      author: item.author || "",
      publishedAt: item.publishedAt || null
    })),
    warnings: [],
    provenance: { fetchMethod: "example-json" }
  };
}

export async function test(config) {
  const result = await collect(config);
  return {
    ok: true,
    title: "示例来源",
    itemCount: result.items.length,
    items: result.items.slice(0, 5)
  };
}
```

有效条目至少应有非空 `title` 和公开 HTTP/HTTPS `url`。建议提供 `summary`、`author`、`publishedAt` 和 provenance。单来源异常应抛错，由统一 Runner 隔离并记录，不要返回伪造成功。

### 5.4 安装与测试

采集器插件目前通过“采集器运行 / 扩展管理”界面或管理 API 校验、安装、启用。安装后默认停用。远程采集器首次真实执行需要确认。

可用 API：

```text
POST  /api/system/collector-plugins/validate
POST  /api/system/collector-plugins/install
PATCH /api/system/collector-plugins/:id/status
POST  /api/system/collector-plugins/:id/first-run-confirm
DELETE /api/system/collector-plugins/:id
```

变更请求需要 `x-admin-confirm: TRUSTED-LOCAL-PLUGIN`。完整请求见 [API.md](../API.md)。

## 6. 技能包

技能包由 `SKILL.md` 和 `skill.json` 构成，只提供提示词与契约，不直接执行代码。

```text
my-skill/
├─ SKILL.md
├─ skill.json
└─ references/     可选
```

`skill.json` 主要字段：`id`、`kind`、`entryPoints`、`inputContract`、`outputContract`、`requiredCapabilities`、`optionalCapabilities`、`compatibleApp` 和 `source`。技能声明的能力还会与用户配置白名单求交集，不能自行获得未授权工具。

工具插件也可以在 Manifest 中声明 `requiredCapabilities` 和 `optionalCapabilities`。必需能力缺失时插件不会参与能力解析；可选能力缺失时插件仍可运行，并应实现明确的降级路径。Adapter 通过 `context.capabilities.invoke(capability, input)` 调用其他实现，不得 import 其他插件源码。

### 宿主运行上下文

工具 Adapter 的 `execute(input, context)` 和 `health(context)` 可使用以下只读服务：

- `context.result.ok/failure`：构造标准工具结果；
- `context.network.privateIp`：执行宿主统一的内网地址判定；
- `context.github.requestGitHubJson`：使用统一限流、缓存和健康状态的 GitHub 请求；
- `context.capabilities.invoke`：按 capability 调用其他插件实现并保留审计链；
- `context.configuration`：当前插件解析后的配置，不包含其他插件配置。

插件不得通过相对路径 import `lib/`、其他插件或历史 `plugins/shared`。采集插件通过 `createAdapter(context)` 接收对应的 `network`、`github` 与配置服务。

包只允许 Markdown、JSON、TXT、LICENSE、NOTICE 等静态文件，最多 100 个文件、5 MB。Markdown 引用必须存在且不能越界。

```powershell
npm run skill:validate -- docs/examples/skill-package
```

## 7. 配置 Schema

工具和采集器可通过 `configuration` 声明全局运行配置，通过 `sourceConfigSchema` 声明每个来源独立配置。遵循以下约定：

- 根类型必须为 `object`；
- 建议 `additionalProperties: false`；
- 使用 `title` 作为界面标签；
- 使用 `enum` 与 `enumNames` 提供稳定选项；
- 数值给出 `minimum` / `maximum`；
- URL 使用 `format: "url"`；
- 密钥使用 `secret: true` 与 `format: "password"`；
- 不要把来源数组放入全局配置，来源实例由统一来源服务管理。

## 8. 版本、升级与卸载

- `compatibleApp` 表示最低兼容应用版本，例如 `>=0.5.0`。
- 未知 `schemaVersion` 或不兼容版本会在安装前拒绝。
- 工具、技能和采集器都保留版本历史并支持回滚；采集器目录同时记录安装事件。
- 停用不会删除配置和来源；卸载后来源配置仍可保留为不可用状态，便于恢复。
- 发布新版本时应保持已有 capability、sourceType 和配置字段的兼容；破坏性变化使用新的 ID 或主版本。

## 9. 安全检查清单

发布前确认：

- [ ] ID、版本、`compatibleApp` 和 Schema 正确；
- [ ] 权限声明与真实行为完全一致；
- [ ] 没有硬编码密钥、Cookie、用户路径或真实账号；
- [ ] 网络域名最小化，拒绝内网和重定向；
- [ ] 外部写入需要显式授权；
- [ ] 错误信息可操作且不泄露秘密；
- [ ] 输入、输出和配置都通过校验；
- [ ] `health` / `test` 不产生破坏性副作用；
- [ ] 已运行 `npm run build`、相关测试和秘密扫描；
- [ ] README 说明数据发送位置、保留策略和卸载影响。

独立分发前运行 `npm run plugin:verify-distribution`。内置插件会先生成与第三方插件相同结构的临时分发包，再执行 Manifest、包边界和依赖校验。分发包不会包含 `data/`、浏览器 Profile 或 `node_modules/`。插件需要宿主提供的外部包时，必须在 `runtimeDependencies` 中声明，未声明或不在宿主白名单中的依赖会被拒绝。

## 10. 调试建议

1. 先运行目录校验，不要直接复制到 `data/installed-*`。
2. 在界面检查 Manifest 权限摘要和配置状态。
3. 先运行健康检查，再运行最小测试输入。
4. 查看“工具执行审计”“采集源健康”和 `logs/`。
5. 出现完整性错误时重新安装，不要直接修改已安装目录。
6. 出现能力未找到时检查 capability 拼写、启用状态、优先级和技能工具白名单。

实现参考以 `lib/tools/manifest-loader.mjs`、`lib/plugin-sdk/manifest-contract.mjs`、`lib/collectors/contracts.mjs` 和各 package manager 为准。
