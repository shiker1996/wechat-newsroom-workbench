# Agent 能力适配层配置化设计

日期：2026-08-15
状态：阶段 1 已实施（2026-08-15，通用层三张表抽出，纯重构行为不变；全量 1052 通过、门禁零违规）；阶段 2 已实施（2026-08-15，Adapter 适配段改为声明 + buildAdaptation 通用装配，行为不变；登记上界校验放宽为档案表命中即合法）；阶段 3 已实施（2026-08-15，resourceKind 声明落在目录条目 capabilities.json，新资源类能力接入全程不改 .mjs，test/agent-adapter-default-profile.test.mjs 验证）；阶段 4 已实施（2026-08-15，适配声明挪到 capability-consumers.json 的 adaptation 字段为权威来源，页面只读展示；Adapter 保留等价内联 fallback，行为不变）
上游：capability-expansion-guide.md §5 遗留 1（S3 默认适配档案）；本文将其具体化

## 1. 背景与目标

Agent 接入资源类能力目前要走六件清单，其中三件是 Adapter 代码（资源注册、参数改写、结果边界）。观察现有三个 Adapter（editorial / tutorial / custom-social）后确认：这些代码的差异是**声明差异而非逻辑差异**——注册的是哪几个资源来源、启用哪些能力、结果解释有没有特化，全部可以用 map 表达。

目标：把 Agent 的能力适配层配置化。接入新资源类能力从"改代码"降为"维护两张 map"；没有特化需求时纯登记、零代码。

**明确分离两层**：

- **对话功能层**（不动）：信封协议、JSON 修复、对话历史、ready 判定、cacheLookup 这类编排逻辑，永远留在各 Agent 的业务代码里。
- **toolcall 适配层**（本次配置化）：资源目录构建 → Schema 注入 → 参数改写与授权检查 → 结果清洗与解释。即当前 `runConversationAgent` 的 `resolveArguments`/`sanitizeToolResult` 钩子 + 调用前的资源注册段。

## 2. 目标模型

### 通用层（一次写好，`lib/agent/resource-adaptation.mjs` 扩展）

- **resourceKind 档案表**：每种 resourceKind（path / url / root / content 列表…）定义参数改写、输入 Schema、校验规则（可选约束如 URL 模式白名单）。替代 `resolveResourceArguments` 的 switch 成为默认实现；现有五能力的分支降级为具名特化。
- **资源注册器表**：具名注册器（`materials` / `documentRoots` / `project` / `hotspotSources`…），各带参数（如素材上限）。
- **结果处理器注册表**：具名结果解释函数（如 `fact-attachment`、`material-url-backfill`），供各 Agent 引用；通用层收敛存量重复实现。
- **默认行为（无声明时）**：标准资源注册、标准未启用门禁、结果一律进【素材】的最保守边界、通用报错文案。默认路径必须能独立跑通。

### Agent 声明（配置，非代码）

每个 Agent 消费者维护两张 map（**已落地为 `config/capability-consumers.json` Agent 条目的 `adaptation` 字段**，阶段 4；读取处校验 source/handler 名合法，非法启动报错）：

```text
Map 1  resourceSources: [ {source: 'materials', limit: 8}, {source: 'documentRoots'}, … ]
Map 2  resultHandlers:  { capability → 注册表中的具名处理器 }（无条目的能力走默认边界）
```

能力清单本身沿用登记驱动（`entry-capabilities.mjs`），不再要求资源类能力出现在 Adapter 常量中——常量上界校验改为"档案表命中即合法"。

### 接入新资源类能力的新路径

1. 目录条目标注 resourceKind（`config/capabilities.json` 条目的 `resourceKind` 字段，值必须是档案表 key；+ 可选约束）→ L3 立项不变
2. 实现接入不变（插件/远程）
3. Agent 接入 = 登记依赖 + （可选）Map 2 加一条具名处理器引用——命中存量 resourceKind 时全程不改任何 `.mjs`
4. 默认边界先跑，有业务特殊解释再写具名处理器（写一次，全 Agent 可复用）

## 3. 边界

- 对话功能层不配置化：信封、修复、编排留在业务代码。
- Map 2 的值是**注册表中的名字**，不是内联函数——业务结果解释仍允许写代码，但写成可复用的具名处理器，而非塞进某个 Adapter。
- editorial 的 cacheLookup 属对话层优化，不纳入适配层配置。
- 技能消费者不变（resourceId 能力仍走 Agent 通道的安全边界）；feature 消费者不变。

## 4. 迁移策略

- 现有三个 Agent 不动，继续用各自的 Adapter（特化保留）。
- 用**下一个新增的资源类能力**走通默认档案路径验证；跑通后现有 Agent 按需迁移（预期 tutorial/custom-social 可砍掉约一半代码，editorial 只换适配部分）。
- 快照基线与 `npm run capability:gates` 全程兜底；迁移任一 Agent 时先重跑基线。

## 5. 验收

- 新资源类能力接入某 Agent：不改任何 `.mjs`，仅目录条目 + 登记 +（可选）具名处理器引用，页面链路显示"可用"，实际会话调用成功。
- 默认边界生效：无 Map 2 条目时结果按最保守策略进【素材】，未启用门禁报错可读。
- 全量测试 0 失败；门禁零违规；基线新鲜。
