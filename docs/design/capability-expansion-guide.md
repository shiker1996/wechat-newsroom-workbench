# 能力拓展现状与操作手册

日期：2026-08-15（2026-08-16 更新遗留清单）
定位：能力拓展的单一视图。汇总分散在三份方案文档中的机制、SOP 与遗留，后续拓展先读本篇；权威设计细节仍回源文档。

源文档：
- [consumer-capability-adaptation-design.md](./consumer-capability-adaptation-design.md)：消费者—能力—工具实现统一治理（阶段 0–6，现行机制的权威描述）
- [consumer-capability-expansion-design.md](./consumer-capability-expansion-design.md)：三类消费者纳入与接入清单（阶段 A–D，§9 清单的操作细则）
- [capability-onboarding-configurability-plan.md](./capability-onboarding-configurability-plan.md)：五种情形分级与配置化改造（阶段 1–4；页面添加入口 2026-08-15 已下线）

## 1. 一页总览

接入成本由两个变量决定：**消费者类型** × **能力是否已在目录（及是否资源类）**。

| 消费者 | 已有纯参数能力 | 已有资源类能力 | 全新能力 |
|---|---|---|---|
| Skill | L0 页面配置（声明 + 开关） | 不可接入（安全边界，须走 Agent 通道） | 先走 S5 立项 |
| Agent | 改 `config/capability-consumers.json` 一条登记即生效，无代码 | L2 接线开发（六件清单，含 Adapter 代码） | 先走 S5 立项 |
| Pipeline / feature | 改代码（业务调用点接线）+ 登记 | 同左 | 先走 S5 立项 |

配置化分级定义：**L0** 页面完成不写文件；**L1** 改 config/ 下 JSON 即生效；**L2** 按固定清单接线、无新组件设计；**L3** 目录定义 + 实现 + 安全评估，单独立项。

判定原则：配置只表达声明与授权，不制造适配与调用。涉及资源语义、业务结果解释、调用点的保留开发通道。

## 2. 公共框架：能力生命周期状态机

所有情形共用"先定义 → 再实现 → 后消费"的顺序：

```text
draft（草稿/未登记）
  ↓ 目录定义（config/capabilities.json 条目：名称/描述/分类/风险级别）
registered（已定义）
  ↓ 至少一个实现通过健康检查且被允许启用
implemented（可提供）
  ↓ 消费者登记 + 适配就绪 + 技能授权
consumable（可消费，按消费者逐个计算）
```

顺序规则：

- **R1 消费者门禁**：消费者登记/技能 Manifest 引用非 registered 能力 → 审计报错或警告。
- **R2 实现侧收口**：`registered:false` 的实现允许存在（调试期宽容），但不得启用、不得设为路由首选；图谱与页面标注"未登记 · 仅调试"。六条启用/路由写路径统一 `CAPABILITY_NOT_REGISTERED` 拦截。
- **R3 目录草案辅助**：远程与第三方本地工具 Manifest 导入时若声明目录外能力，校验通过后均生成目录条目草案，人工确认经 `POST /api/system/capability-catalog` 入库（本地工具草案 2026-08-16 补齐）。
- **R4 门禁 warning**：图谱存在 `registered:false` 能力 → `npm run capability:gates` 输出 warning（不阻断，CI 可见）。

## 3. 各消费者 SOP

### 3.1 Skill 接入已有能力（两步，L0）

1. `skill.json` 的 `requiredCapabilities`/`optionalCapabilities` 加一项（门禁自动校验目录存在性与登记一致性）。
2. `active.json` 白名单放行，或在页面"技能与工具 → 消费者接入"开开关。

边界：resourceId 模式能力（`cap_filesystem_project_read`、`cap_content_url_fetch`、`cap_content_document_search`、`cap_content_repository_inspect`、`cap_content_passage_retrieve`，见 `RESOURCE_ADAPTED_CAPABILITIES`）技能单独运行时不可用，必须走 Agent 通道——有意的安全边界。

### 3.2 Agent 接入已有能力

**纯参数能力（半配置化，无代码）**：在 `config/capability-consumers.json` 为该 Agent 加一条登记依赖即生效。登记驱动机制（`server/platform/agent/entry-capabilities.mjs`）使 Adapter 目录从登记派生，纯参数能力不在 Adapter 常量上界约束内，登记了即生效。同步对应运行时技能的 `skill.json` Manifest 声明与白名单。

> 历史：2026-08-14 至 08-15 曾有页面"添加能力"入口（阶段 3），因候选仅限少数纯参数能力、实际价值不足已下线；登记驱动机制保留。

**资源类能力（L2，六件清单）**：

- [ ] Adapter：资源注册（通用层函数）+ 目录 Schema override + 能力常量加项
- [ ] Adapter：未启用门禁（用户提供了资源但能力未启用时报错引导）
- [ ] Adapter：Prompt 结果边界规则（素材/体验归属）
- [ ] 入口路由：资源参数检测/传入 Adapter + 一次性确认（`localSecurity.consume`）
- [ ] capability-consumers.json：登记依赖（declaration/adapterStatus/resourceKinds/triggerPolicy/authorizationAction/resultPolicy）
- [ ] skill.json Manifest 同步

六件清单经 custom-social 接入 `cap_filesystem_project_read` 实战验证（阶段 A）。
2026-08-15 起（agent-adapter-configurability 阶段 3）：新能力命中存量 resourceKind 时在 `config/capabilities.json` 条目声明 `resourceKind` 即走默认档案路径，前三件 Adapter 清单免除，纯配置接入、不改 `.mjs`。
2026-08-16 起：授权拒绝文案外置 `config/agent-adaptation-messages.json`（`messages.<consumerId>.<capability>` 二维），Adapter 不再传 messages；缺省回退档案内联兜底文案。

### 3.3 Pipeline / feature 接入已有能力（两件）

- [ ] 业务调用点接线（`executeCapabilityWithPreference` / integrations，本是业务代码）
- [ ] capability-consumers.json：登记 feature 依赖（capability/requirement/failurePolicy + 适配字段）
- [ ] `npm run capability:gates` 验证通过

feature 的能力调用是业务流程里确定性的一环，"改代码"即功能开发本身；体系负责让登记、图谱、门禁自动跟上。feature 消费者无授权开关（设计决策，`skillAuthorizations` 恒为空数组）。

### 3.4 全新能力（S5，单独立项）

任何"想要新能力"的需求必须先立项，再回到上述消费者路径：

- 能力定义：永远 L3 人工立项（目录条目 + 风险级别 + 威胁模型评估），不做全自动入库；远程场景可由 R3 草案把文件编写降为确认操作。
- 实现接入：远程 API/MCP 走扩展工作室 Manifest 导入 + R2 收口 + R3 草案；本地插件走管理员安装，同受 R2 约束。

### 3.5 接入后自动生效（无需工作）

图谱可用性计算与原因码、页面展示、停用影响预览、CI 门禁。

注意：`scripts/quality/snapshot-consumer-capability-baseline.mjs` 的 adaptation 信息自 2026-08-16 起从 `config/capability-consumers.json` 登记推导，不再手工维护静态表；登记变更后重跑 `npm run capability:consumer-baseline` 刷新基线即可。

## 4. 明确边界

- 配置不制造适配与调用：资源语义、业务结果解释、调用点保留开发通道。
- `collect.*` 采集能力由来源接入驱动，不出现在会话候选中。
- 技能单独运行时不可用 resourceId 能力（安全边界）。
- 能力定义永远保留人工环节。
- pipeline-runtime 快照冻结语义不变：接入变更不影响历史 run 快照。

## 5. 遗留与演进方向

1. ~~S3 默认适配档案~~ 已实施（2026-08-15，[agent-adapter-configurability-design.md](./agent-adapter-configurability-design.md) 阶段 1–4）：resourceKind 档案表 + 目录条目 resourceKind 声明 + Agent 适配声明（`capability-consumers.json` 的 `adaptation` 字段），资源类能力接入从 L2 降为纯配置。
2. ~~第三方本地工具 Manifest 声明目录外能力时不产出目录草案~~ 已实施（2026-08-16）：本地工具包 validate/install 路由与远程一样返回 `catalogDrafts`，R3 缺口闭合。
3. ~~基线脚本 adaptation 静态表手工维护~~ 已实施（2026-08-16）：`snapshot-consumer-capability-baseline.mjs` 改为从 `config/capability-consumers.json` 登记推导（3.5 注记）。
4. ~~tutorial/custom-social 的 passage content 回填~~ 已实施（2026-08-16）：url.fetch 成功结果回填资源目录条目正文，`cap_content_passage_retrieve` 的 resourceIds 严格分支在这两个入口可用。
5. Agent 纯参数能力的声明路径当前是"手改 JSON"；如需更低成本，可考虑只读登记 + 草案辅助的轻量入口（原页面入口的教训：候选范围太窄时不值得做完整写入链路）。
