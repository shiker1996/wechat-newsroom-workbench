# 消费者能力体系下一批扩展技术方案

状态：已实施完成（阶段 A-D，2026-08-14）  
日期：2026-08-14  
上游文档：consumer-capability-adaptation-design.md（已实施完成，阶段 0-6）  
现状汇总：能力拓展的操作视图已汇总至 [capability-expansion-guide.md](./capability-expansion-guide.md)（2026-08-15）

## 1. 目标

### 1.1 最终目标

**实现三类消费者（Agent / Skill / Pipeline）的便捷接入**：新增一次"消费者—能力"关系，应该是一份固定、有限、可核对的清单，而不是跨模块考古。本批及后续所有工作都朝这个目标收敛；每完成一批，用清单的实际工作量检验是否更接近目标（清单见第 9 章）。

### 1.2 本批要做三件事

| 事项 | 内容 | 性质 |
|---|---|---|
| 一 | custom-social 接入 `filesystem.project.read` | Agent 接入清单的首次实战试点 |
| 二 | 4 条 feature 消费者补齐登记字段并上页面 | 消除不可见的消费者 |
| 三 | 技能消费者的定位澄清与页面展示 | 消除概念重复与展示缺口 |

## 2. 现状

上一批已落地的基座：登记（`config/capability-consumers.json`）、统一可用性计算（`lib/tools/capability-graph.mjs`）、"消费者接入"页签与授权编辑、通用资源适配层（`lib/agent/resource-adaptation.mjs`）、治理门禁（`scripts/check-consumer-capability-gates.mjs`）。

与本批相关的现状事实（均已核实）：

1. **custom-social 缺口**：`capability-consumers.json` 已登记 gaps"工具存在、消费者未适配"；`lib/agent/custom-social-adapter.mjs` 目前只有 URL 和文档根两类资源；通用层五个函数（`registerProjectResource`、`resolveResourceArguments`、`trimProjectReadResult`、`deterministicProjectReadRequest`、`buildAllowedRoots`）全部现成，编辑室 Adapter（`lib/agent/editorial-adapter.mjs:40-49`）提供了完整接入参照。
2. **feature 消费者已有 4 条**，在图谱中参与计算，但缺适配字段、不上页面：

   | 消费者 | 对应链路 | 依赖 |
   |---|---|---|
   | `feature.information-research` | 资料检索与来源抓取（lib/integrations/） | url.fetch / web.search / news.search / document.search / repository.inspect / project.read |
   | `feature.article-passage-retrieval` | 编辑会摘录检索（article-routes.mjs:34-41） | passage.retrieve（required/block） |
   | `feature.wechat-typeset` | 公众号排版 job（typeset-pipeline） | mermaid / echarts / image.cdn.upload |
   | `feature.diagram-preview` | 图表预览端点（media-routes） | mermaid / echarts |
3. **图文和文章流水线不需新增登记**：它们的能力消费经由 Agent 消费者（图文资料补充走 `agent.custom-social`，文章走 `agent.independent-writing`），流水线 LLM 主体不直接调工具。再新增 feature 记录会造成同一调用被重复计入。
4. **技能消费者机制已存在**：skill.json 声明运行时聚合为 `type:'skill'` 消费者，参与图谱计算；授权走 active.json 白名单；pipeline-runtime 将 allowedTools 冻结进快照。缺的是概念定位与页面展示。
5. **feature 消费者登记与运行时授权无耦合**：pipeline-runtime 只看技能配置 allowedTools，本批不改变这一点。

## 3. 事项一：custom-social 接入 filesystem.project.read

### 3.1 设计决策

- 触发策略用 `explicit-resource`（用户显式提供本地路径才注册项目资源），不用编辑室的 `deterministic-first-step`——图文生成多数会话不需要读本地项目，确定性首步会产生无谓读取。
- 结果边界沿用编辑室口径：本地项目内容只能进【素材】，用户明确陈述本人实际使用才能进【体验】。规则以 Prompt 注入 + 结果裁剪落实，不由配置产生。

### 3.2 改动点

- `lib/agent/custom-social-adapter.mjs`：用户输入含项目路径时 `registerProjectResource` 注册资源、allowedRoots 追加 projectPath；目录 overrides 增加 `RESOURCE_ID_SCHEMA`；能力常量加项；未启用时报错引导（同 editorial 语义）；Prompt 注入边界规则。
- `config/capability-consumers.json`：删除 gaps 条目，新增依赖记录（`declaration: optional`、`adapterStatus: ready`、`resourceKinds: ["local-project"]`、`triggerPolicy: "explicit-resource"`、`authorizationAction: "local-project-read"`、`resultPolicy: "sanitized-project-summary"`）。
- `skills/custom-card-storyboard/skill.json`：`optionalCapabilities` 同步增加（否则门禁失败）。

### 3.3 授权边界验收

- 模型目录只见 resourceId，不见绝对路径；allowedRoots = workspaceRoot + documentRoots + projectPath，逐项对照；
- 未提供路径时不注册资源、不触发该能力调用；
- 一次性确认语义不变（资源目录即授权范围）；
- 结果走 `trimProjectReadResult` 裁剪。

### 3.4 风险

- custom-social 的 final 后处理会把新【体验】降级改写为【素材】，需测试确认项目读取结果被该链路覆盖；
- `adapterStatus` 升 ready 后授权开关自动解锁，需测试启停往返。

## 4. 事项二：feature 消费者补齐登记并上页面

### 4.1 登记补齐

为 4 条 feature 依赖补显式字段（按现状逐条核实后填写）：

- `adapterStatus`：现有调用链都有真实接线，预期全部 ready；
- `triggerPolicy`：feature 均为代码确定性调用，新增枚举 `code-path`（语义比 `deterministic-first-step` 准确）；
- `resultPolicy`：按各链路结果去向登记。

Schema 校验扩展：feature 依赖带新字段时校验枚举合法；门禁的 sourceFiles 交叉校验维持不变。

### 4.2 页面展示

- `public/src/views/skills.js` 三处 `type === 'agent'` 过滤（L134/L207/L211）放宽为全量，按类型分组渲染；
- feature 卡片：隐藏技能授权开关区（无 runtimeSkillIds），改展示 requirement/failurePolicy 与 sourceFiles；
- feature 行同样进入停用影响预览。

### 4.3 接口

`GET /api/system/capability-consumers(/:id)` 已返回全量消费者，无需改动；feature 详情的 `skillAuthorizations` 为空数组属预期，前端按类型跳过。

## 5. 事项三：技能消费者的定位与展示

### 5.1 设计决策：技能是授权载体，不是独立业务消费者

- **挂在 Agent 入口下的技能**（runtimeSkillIds）不单列成行——其授权开关已在 Agent 卡片的"技能授权"区，再列一行就是同一声明的重复展示。页面按 id 去重。
- **无归属入口的技能**（流水线阶段技能、独立写作技能等）作为独立消费者行展示，归入「技能」组。它们没有适配层概念，`adapterStatus` 恒为 ready（其"适配"就是 Manifest 声明 + allowedTools 过滤），"已适配"列显示为固有值并加说明。
- 技能行的启停复用已有的授权写入路径（`saveSkillAuthorization`）和服务端边界校验。
- 空白名单语义已收紧：显式空数组 = 全部禁止（`SKILL_NOT_ALLOWED`），`null`/无字段 = 全放行；单能力技能可通过空白名单停用其唯一能力。

### 5.2 改动点

- 前端分组扩为三类：Agent / 技能 / 流水线功能；
- `GET /api/system/capability-consumers/:id` 对 skill 类型返回 `skillAuthorizations`（复用 `describeSkillAuthorization`，skill 的 runtimeSkillIds 即自身）；
- 门禁不变：技能 Manifest 一致性校验已有（内置技能失败级、第三方 warning）。

## 6. 实施顺序

```text
阶段 A：custom-social 接入 project.read（事项一）
  A0 基线：重跑 snapshot-consumer-capability-baseline，固化接入前快照
  A1 Adapter 接线 + Prompt 边界 + 未启用门禁
  A2 登记与 Manifest 更新（gaps → ready 依赖）
  A3 授权边界测试 + 启停往返测试 + 全量回归

阶段 B：feature 消费者登记补齐（事项二前半，纯数据+校验）
  B1 schema/枚举扩展（triggerPolicy 增 code-path）
  B2 四条 feature 依赖补字段，更新基线与快照
      （实施记录：snapshot-consumer-capability-baseline.mjs 静态表只跟踪
       agent 消费者，feature 不涉及，无需更新；tool-call-chain-baseline 需重跑）
  B3 门禁测试更新

阶段 C：页面分组展示（事项二后半 + 事项三，纯前端+接口小改）
  C1 放宽过滤、三分组渲染、Agent 与技能组按 runtimeSkillIds 去重
  C2 技能行授权开关；详情接口对 skill 类型返回 skillAuthorizations
  C3 feature 卡片适配（隐藏授权区、展示 requirement/failurePolicy）
  C4 集成测试与快照更新，API.md 同步

阶段 D：收尾
  D1 重跑两个基线脚本，确认产物新鲜
  D2 更新本文档状态与上游文档 §13 遗留清单
```

顺序理由：A 独立于 B/C 且是接入清单的首次实战，先行；B 先于 C，因为页面依赖登记字段就位，先补数据再放行前端，避免大面积 "—"；事项三并入 C，因为它是同一处过滤放宽 + 授权复用，服务端机制已存在，单独立阶段不划算。

## 7. 测试与验收

- 阶段 A：提供/不提供项目路径两种会话的工具目录快照；授权边界逐项对照；页面该行从"缺少接入"变"可用"；授权启停往返不影响其他消费者；**按 9.2 清单逐项打勾，清单外出现的工作必须记录并回第 9 章修正**。
- 阶段 B：`npm run capability:gates` 零违规；四条 feature 依赖字段校验正反用例。
- 阶段 C：页面三分组展示；Agent 的 runtimeSkill 不重复出现；无归属技能行可启停授权且走既有服务端边界校验；feature 行无授权开关、无误导性操作；停用影响预览覆盖三类消费者。
- 全程全量 `npm test` 0 失败（当前基线 1015）。

## 8. 明确边界

- 不新增 feature.social-card-generation / feature.article-generation 记录（避免重复登记，理由见 2.3）；
- 不改变 pipeline-runtime 的 allowedTools 授权与快照冻结语义；
- 不接入真实健康检查（implementationHealthy 代理维持现状，属上一批遗留）；
- 不做全新能力定义（新 capability + 新插件实现单独立项）；
- tutorial/custom-social 的 passage content 回填维持遗留记录，不在本批。

## 9. 接入清单（最终目标的操作化）

每次接入对照打勾；发现清单之外的工作，视为体系缺口，回本章修正。

### 9.1 Skill 接入一项能力（两步）

- [ ] skill.json `requiredCapabilities`/`optionalCapabilities` 加一项（门禁自动校验目录存在性与登记一致性）
- [ ] active.json 白名单放行，或页面"消费者接入"开开关
- [ ] 注意：resourceId 模式能力（project.read、url.fetch 等）必须走 Agent 通道，技能单独运行时不可用——这是有意的安全边界

### 9.2 Agent 接入一项能力（六件）

- [ ] Adapter：资源注册（通用层函数）+ 目录 Schema override + 能力常量加项
- [ ] Adapter：未启用门禁（用户提供了资源但能力未启用时报错引导）
- [ ] Adapter：Prompt 结果边界规则（素材/体验归属）
- [ ] 入口路由：资源参数检测/传入 Adapter + 一次性确认（`localSecurity.consume`，仅资源类能力需要；阶段 A 试点发现的清单外工作，已补入）
- [ ] capability-consumers.json：登记依赖（declaration/adapterStatus/resourceKinds/triggerPolicy/authorizationAction/resultPolicy）
- [ ] skill.json Manifest 同步
- [x] 纯参数能力（如 news.search）已半配置化：登记驱动落地后只需在 capability-consumers.json 加一条登记依赖即生效，无需改 Adapter 代码（页面"添加能力"入口已于 2026-08-15 下线，因候选范围过窄）；以下六件清单仅适用于资源类能力

### 9.3 Pipeline / feature 接入一项能力（两件）

- [ ] 业务调用点接线（`executeCapabilityWithPreference` / integrations，本是业务代码）
- [ ] capability-consumers.json：登记 feature 依赖（capability/requirement/failurePolicy + 适配字段）
- [ ] `npm run capability:gates` 验证通过

### 9.4 接入后自动生效（无需工作）

图谱可用性计算与原因码、页面展示、停用影响预览、CI 门禁。

注意：`scripts/snapshot-consumer-capability-baseline.mjs` 内含手工维护的 adaptation 静态表与 gaps，登记变更后需同步修改该表再重跑脚本（阶段 A 试点发现；后续可考虑消除静态表、改为从登记推导）。

### 9.5 全新能力（目录外，单独立项）

能力目录定义 + 插件实现 + 健康检查 + 威胁模型评估，不混入消费者接入流程。

## 10. 实施记录与遗留

实施结果（2026-08-14）：阶段 A-D 全部完成；全量测试 1021 通过 / 0 失败；`npm run capability:gates` 零违规；基线产物新鲜。

试点验证结论（事项一）：9.2 清单五件全部命中，另发现两件清单外工作（入口路由传参与一次性确认、基线脚本静态表手工维护），已分别补入 9.2 第六件与 9.4 注记。

遗留：

1. ~~空白名单等同全放行的边角~~ 已裁定并收紧：显式空数组 = 全部禁止，`null`/无字段 = 全放行（见 5.1）；
2. ~~基线脚本 adaptation 静态表手工维护，可考虑改为从登记推导（9.4 注记）~~ 已实施（2026-08-16）：`snapshot-consumer-capability-baseline.mjs` 从 `config/capability-consumers.json` 登记推导，gaps 改为声明未登记的派生判定；
3. ~~`implementationHealthy` 仍为配置就绪代理~~ 已接真实 `registry.health()`：`lib/tools/health-check.mjs` 构建前并发预取健康表（进程内 TTL 45s 缓存，写操作后失效），检查异常回退代理并在 warnings 标注 `HEALTH_CHECK_UNAVAILABLE`；
4. ~~tutorial/custom-social 的 passage content 回填未实施（上一批遗留）~~ 已实施（2026-08-16）：url.fetch 结果回填资源目录正文，passage.retrieve 严格分支在这两个入口可用；
5. feature 详情接口的 `skillAuthorizations` 恒为空数组属预期；feature 行无授权开关是设计决策而非缺口。
