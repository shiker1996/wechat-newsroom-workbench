# 见字插件开发指南

> 类别：现状。适用于应用 0.6.x、Manifest `schemaVersion: 1`。

## 1. 扩展模型

工作台有三条扩展轴：

| 扩展 | 作用 | 是否执行代码 | 示例 |
|---|---|---|---|
| 技能包 | 提供 Prompt、角色、输入输出契约和能力声明 | 否 | `docs/examples/skill-package/` |
| 工具插件 | 提供抓取、搜索、渲染、上传等通用能力 | 本地插件是；远程插件否 | `docs/examples/tool-plugin/`、`docs/examples/remote-tool-plugin/` |
| 采集器插件 | 提供可在采集源页面创建的来源类型 | 本地插件是；远程插件否 | `docs/examples/collector-plugin/` |

三者都使用 kebab-case ID、SemVer 版本、`schemaVersion: 1` 和 `compatibleApp`。第三方扩展安装后默认停用，启用和首次执行仍受权限门禁控制。

## 2. 新增能力

插件围绕**能力（capability）**开发：先定义能力，再有插件实现它，最后由消费者接入。本节是第一步与第三步；插件实现见第 3 节。

### 2.1 目录定义

在 `config/capabilities.json` 的 `capabilities` 下加条目：

```json
"text.stats": {"name": "文本统计", "description": "统计文本字符与词数。", "category": "内容工具"}
```

- 必填字段：`name`、`description`、`category`；资源类能力（需要用户传入路径、URL、文档目录等资源）另声明 `resourceKind`，取值与含义：

  | resourceKind | 资源形态 | 参数契约 |
  |---|---|---|
  | `project-path` | 已授权本地项目路径 | `resourceId → path` |
  | `url-fetch` | 网页 URL（可带标题） | `resourceId → targetUrl` |
  | `document-root` | 已授权文档目录 | `resourceId + query → root/query/maxResults` |
  | `github-url` | GitHub 仓库 URL | `resourceId → sourceUrl` |
  | `passage-content` | 已抓取正文条目 | `resourceIds → documents/query/k` |

  新增取值需先在 `lib/agent/resource-adaptation.mjs` 的 `RESOURCE_KIND_PROFILES` 增加档案（含 Schema 与参数改写）；目录条目填了非法值时校验报错会直接列出全部合法取值。授权拒绝文案按"Agent + capability"二维维护在 `config/agent-adaptation-messages.json`（`messages.<consumerId>.<capability>`），文件或条目缺失时回退档案内联兜底文案。

  档案（profile）的代码契约：

  ```js
  'my-resource-kind': {
    schema: RESOURCE_ID_SCHEMA,              // 注入给模型的输入 Schema；resourceId 单资源用 RESOURCE_ID_SCHEMA，带 query 用 RESOURCE_ID_QUERY_SCHEMA
    resolve(resource, args, ctx) {           // resource = 资源目录中 resourceId 命中的条目；args = 模型原始入参
      // 授权校验失败：throw resourceNotAllowed(ctx.messages[ctx.capability] || '兜底文案')
      // 成功：return 改写后的工具入参（即插件 execute 的输入）
    },
  }
  ```

  `ctx` 提供 `messages`（本 Agent 的文案表）、`capability`（当前能力 id）、`workspaceRoot`、`resources`（整个资源目录）。域名白名单、id 抽取、参数钳制等都在 `resolve` 内完成；**resolve 的返回值就是插件 `execute` 的入参契约**。完整示例见第 4 节。
- 能力定义永远保留人工环节：目录条目 + 威胁模型评估（见 [threat-model.md](./threat-model.md)），不做全自动入库。
- 插件 Manifest 声明目录外能力时，校验与安装接口会返回 `catalogDrafts`（目录条目草案，本地与远程插件均覆盖）；人工补全名称、描述与分类后，经 `POST /api/system/capability-catalog`（管理员）确认入库。
- 顺序约束：目录登记先于实现启用。声明了未登记能力的实现允许存在用于调试，但不得启用、不得设为路由首选（启用路径统一 `CAPABILITY_NOT_REGISTERED` 拦截），图谱与页面标注"未登记 · 仅调试"。

### 2.2 消费者配置能力（接入）

能力有了实现之后，按消费者类型接入：

| 消费者 | 接入方式 |
|---|---|
| Skill | `skill.json` 的 `requiredCapabilities`/`optionalCapabilities` 加一项 + `active.json` 白名单放行（或页面开关）。resourceId 模式能力技能单独运行时不可用，必须走 Agent 通道（有意的安全边界） |
| Agent | 在 `config/capability-consumers.json` 为该 Agent 的 `dependencies` 加一条登记（capability/requirement/failurePolicy/adapterStatus/resourceKinds/triggerPolicy/authorizationAction/resultPolicy）。纯参数能力登记即生效、零代码；资源类能力命中存量 `resourceKind` 时同样纯配置接入 |
| Pipeline / feature | 业务调用点接线（`executeCapabilityWithPreference`）+ 登记 feature 依赖（调用点代码须带 `// capability-call:` 注释且被登记的 `sourceFiles` 覆盖，否则基线审计失败） |

Agent 接入的补充说明：

- **Adapter 的 `*_AGENT_CAPABILITIES` 常量不用改**。Agent 工具目录从登记派生（`lib/agent/entry-capabilities.mjs`）；常量只声明"本 Adapter 为哪些能力写过特化适配代码"，规则是常量 ⊆ 登记。纯参数能力、以及命中档案（目录声明了 `resourceKind`）的资源类能力，登记即可生效。
- **资源类能力**还需确认该 Agent 的 `adaptation.resourceSources` 里有产出对应资源的注册器；需要业务化结果解释时在 `adaptation.resultHandlers` 引用具名处理器（`fact-attachment` 等），默认 `sanitize-only` 进【素材】。
- **授权拒绝文案**（可选）：`config/agent-adaptation-messages.json` 按 `messages.<consumerId>.<capability>` 加条目；不加则用档案内联兜底文案。
- 仅当需要新 `resourceKind`、新资源来源或新结果处理逻辑时才改代码，集中在 `lib/agent/resource-adaptation.mjs` 的三张注册表。

接入后图谱可用性、页面展示、停用影响预览自动生效；以 `npm run capability:gates` 验证零违规。成本矩阵、生命周期状态机与各消费者 SOP 详见 [design/capability-expansion-guide.md](./design/capability-expansion-guide.md)。

## 3. 新增插件

为能力开发实现：选择插件形态，在 Manifest 的 `capabilities` 中声明所实现的能力，按对应章节契约编写：

- 本地工具插件 → 第 6 节；远程工具插件 → 第 7 节；采集器插件（`collect.*` 能力）→ 第 8 节。
- 一个插件可实现多个能力，一个能力也可有多个实现（按优先级与健康状况路由）。
- 校验与发布：`npm run plugin:validate -- <目录>` 校验；`npm run plugin:audit-boundaries` 审计包边界；独立分发前 `npm run plugin:verify-distribution`。

## 4. 完整示例：新增小红书读取能力

目标：用户提供小红书笔记链接，Agent 可读取笔记正文。授权要钉死 xiaohongshu.com 域名，且实现端按笔记 id 抓取——资源校验与出参契约都不同于通用 `url-fetch`，因此新增一个 resourceKind。全流程如下（标记 ⚙ 的是代码改动，其余都是配置）。

### 4.1 新增 resourceKind 档案

`lib/agent/resource-adaptation.mjs` 的 `RESOURCE_KIND_PROFILES` 加一项：

```js
'xiaohongshu-note': {
  schema: RESOURCE_ID_SCHEMA,
  resolve(resource, args, { messages, capability }) {
    const url = resource?.url || '';
    const match = /^https:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9a-f]+)/i.exec(url);
    if (!match) throw resourceNotAllowed(messages[capability] || '小红书链接不属于当前素材');
    return { noteId: match[1], sourceUrl: url };   // 即插件 execute 的入参契约
  },
}
```

短链（xhslink.com）建议在此拒绝、由用户转成规范链接，保持授权边界只认规范域名。配套加一条档案级测试（参考 `test/agent-adapter-default-profile.test.mjs`）。

### 4.2 能力目录立项

`config/capabilities.json` 加条目（含威胁模型评估，见第 2.1 节）：

```json
"content.xiaohongshu.fetch": {
  "name": "小红书内容读取",
  "description": "读取用户授权的小红书笔记链接并提取正文。",
  "category": "信息获取",
  "resourceKind": "xiaohongshu-note"
}
```

### 4.3 开发实现插件

`xiaohongshu-fetch/manifest.json`：

```json
{
  "schemaVersion": 1,
  "id": "xiaohongshu-fetch",
  "name": "小红书内容读取",
  "version": "1.0.0",
  "kind": "tool",
  "type": "local-adapter",
  "capabilities": ["content.xiaohongshu.fetch"],
  "entry": "./adapter.mjs",
  "riskLevel": "network-read",
  "inputSchema": {
    "type": "object",
    "required": ["noteId"],
    "properties": {
      "noteId": {"type": "string"},
      "sourceUrl": {"type": "string", "format": "url"}
    }
  },
  "outputSchema": {"type": "object", "required": ["noteId", "content"]},
  "runtime": {},
  "compatibleApp": ">=0.6.0",
  "source": {"type": "reviewed-package", "url": "https://example.com/xiaohongshu-fetch"},
  "permissions": {"networkDomains": ["xiaohongshu.com"], "pathAccess": [], "externalWrite": false, "credentials": []},
  "healthCheck": true,
  "enabledByDefault": false
}
```

`adapter.mjs`（入参即档案 resolve 的出参）：

```js
export async function health() {
  return { status: "ok", data: { available: true } };
}

export async function execute(input) {
  const response = await fetch(`https://www.xiaohongshu.com/explore/${input.noteId}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const content = /* …提取正文… */ "";
  return { status: "ok", data: { noteId: input.noteId, content } };
}
```

校验：`npm run plugin:validate -- xiaohongshu-fetch`。

### 4.4 消费者接入（以自定义图文 Agent 为例）

`config/capability-consumers.json` 的 `agent.custom-social` 加一条依赖：

```json
{"capability": "content.xiaohongshu.fetch", "requirement": "optional",
 "failurePolicy": "continue-with-warning", "declaration": "optional",
 "adapterStatus": "ready", "resourceKinds": ["material-url"],
 "triggerPolicy": "explicit-resource", "authorizationAction": null,
 "resultPolicy": "fact-attachment", "source": "builtin"}
```

配套：

- `adaptation.resourceSources` 已有 `materials`（素材 URL 自动进入资源目录），无需改动；如需模型结果进事实附件，`adaptation.resultHandlers` 加 `"content.xiaohongshu.fetch": "fact-attachment"`；
- `config/agent-adaptation-messages.json` 的 `agent.custom-social` 加 `"content.xiaohongshu.fetch": "小红书链接不属于当前素材"`；
- 运行时技能的 `skill.json` 声明 `optionalCapabilities` + `active.json` 白名单放行。

### 4.5 验证

```powershell
npm run capability:gates     # 登记 / 目录 / 适配一致性
npm run test                 # 全量回归
```

页面"技能与工具"中该能力显示可用；会话中传入非小红书链接应收到上面配置的拒绝文案。

## 5. 通用设计原则

> 插件边界规则由 `npm run plugin:audit-boundaries` 强制校验（基线见 `test/fixtures/`）。新增插件不得直接 import 其他插件、项目 `lib/` / `scripts/` / `skills/` 或用户目录文件；插件间协作应声明并调用 capability。现有内置插件的少量跨目录依赖记录在基线中，不应作为开发范例。

1. Manifest 是唯一能力与权限声明，不要在运行时偷偷扩大范围。
2. 输入输出必须是 JSON 可序列化对象，并通过 Schema 校验。
3. 本地 Adapter 只允许 `node:` 和包内相对 import，不允许未审计 npm 依赖。
4. 远程端点必须使用 HTTPS，并拒绝 localhost、内网、保留地址和重定向绕过。
5. `external-write` 必须由用户显式授权；健康检查不得产生外部写入。
6. 插件抛出可读错误；不要吞掉失败或伪造空成功。
7. 安装目录内容会计算 SHA-256；安装后直接修改文件会导致完整性校验失败。

## 6. 本地工具插件

### 6.1 目录

```text
my-tool/
├─ manifest.json
├─ adapter.mjs
├─ README.md       可选
└─ LICENSE         可选
```

允许 `.mjs`、`.json`、`.md`、`.txt`，最多 100 个文件、10 MB，禁止符号链接和越界 import。

### 6.2 Manifest

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

### 6.3 Adapter

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

### 6.4 校验

```powershell
npm run plugin:validate -- docs/examples/tool-plugin
```

## 7. 远程工具插件

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

## 8. 采集器插件

采集器把“某类来源配置”转换为标准内容条目。来源由 `pluginId + sourceType + config` 持久化，运行时按来源类型和优先级选择实现并支持候选兜底。

### 8.1 本地采集器目录

```text
my-collector/
├─ manifest.json
└─ adapter.mjs
```

### 8.2 Manifest

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

### 8.3 Adapter 契约

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

### 8.4 安装与测试

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

## 9. 技能包

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

## 10. 配置 Schema

工具和采集器可通过 `configuration` 声明全局运行配置，通过 `sourceConfigSchema` 声明每个来源独立配置。遵循以下约定：

- 根类型必须为 `object`；
- 建议 `additionalProperties: false`；
- 使用 `title` 作为界面标签；
- 使用 `enum` 与 `enumNames` 提供稳定选项；
- 数值给出 `minimum` / `maximum`；
- URL 使用 `format: "url"`；
- 密钥使用 `secret: true` 与 `format: "password"`；
- 不要把来源数组放入全局配置，来源实例由统一来源服务管理。

## 11. 版本、升级与卸载

- `compatibleApp` 表示最低兼容应用版本，例如 `>=0.5.0`。
- 未知 `schemaVersion` 或不兼容版本会在安装前拒绝。
- 工具、技能和采集器都保留版本历史并支持回滚；采集器目录同时记录安装事件。
- 停用不会删除配置和来源；卸载后来源配置仍可保留为不可用状态，便于恢复。
- 发布新版本时应保持已有 capability、sourceType 和配置字段的兼容；破坏性变化使用新的 ID 或主版本。

## 12. 安全检查清单

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

## 13. 调试建议

1. 先运行目录校验，不要直接复制到 `data/installed-*`。
2. 在界面检查 Manifest 权限摘要和配置状态。
3. 先运行健康检查，再运行最小测试输入。
4. 查看“工具执行审计”“采集源健康”和 `logs/`。
5. 出现完整性错误时重新安装，不要直接修改已安装目录。
6. 出现能力未找到时检查 capability 拼写、启用状态、优先级和技能工具白名单。

实现参考以 `lib/tools/manifest-loader.mjs`、`lib/plugin-sdk/manifest-contract.mjs`、`lib/collectors/contracts.mjs` 和各 package manager 为准。
