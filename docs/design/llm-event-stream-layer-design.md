# LLM 统一事件流层设计

> 状态：阶段 1、阶段 2 已实施（2026-09-01）；Responses 双协议适配已加入，默认仍使用 Chat Completions
> 日期：2026-09-01
> 范围：`server/platform/llm` 流式调用、Agent 观测与后续原生工具调用接入

## 1. 背景

当前模型网关以 Chat Completions 的 `messages` 和 SSE `delta` 为主要接口。流式响应在网关内部被拼接成两个字符串：`content` 与 `reasoning`，最终返回：

```js
{
  content,
  reasoning,
  usage,
  id,
  finishReason,
}
```

现有实现主要存在四个边界问题：

1. 文本、推理、工具调用和结束状态没有统一的事件模型。
2. `rawStreamComplete()` 当前主要读取 `delta.content` 和 `delta.reasoning_content`，对原生 `tool_calls` 没有统一处理。
3. 当模型正常返回“无文本但有工具调用”的响应时，`!content.trim()` 会把合法工具轮次误判为失败。
4. 流中断时，调用方只能得到“最终字符串不存在/不完整”，无法知道中断发生在文本、推理、工具参数还是结束事件阶段。

当前 Agent 另有一套业务事件（如 `tool.requested`、`tool.completed`），但这套事件发生在工具分发之后，不能替代模型协议层事件。

## 2. 目标

### 2.1 本期目标

- 在模型网关内部建立轻量、供应商无关的 `LLMEvent` 事件模型。
- 同时保留 Chat Completions 与 Responses 两种协议，按模型配置选择，不要求一次性切换。
- 保留 `complete()` 和 `streamComplete()` 的旧调用契约，避免修改普通文章、热点、排版链路。
- 正确区分以下三种情况：
  - 有文本的正常响应；
  - 无文本但有工具调用的正常响应；
  - 既无文本也无工具调用的异常空响应。
- 为后续接入 OpenAI/DeepSeek Responses API 提供事件转换边界。
- 为流式日志、错误定位、重试和 Agent 工具调用提供稳定的事件序列。

### 2.2 非目标

- 本期不把所有模型默认切换到 Responses API；具体模型仍需经过真实接口验证。
- 本期不引入 OpenCode 的完整运行时、Effect 或 TypeScript 依赖。
- 本期不删除现有 `final` / `tool_requests` 自定义 Agent 协议。
- 本期不改变业务工具目录、权限校验和 capability 名称。
- 本期不承诺修复所有业务 JSON 格式错误或超长 HTML/CSS 截断。

## 3. 设计原则

### 3.1 事件层只负责模型一轮调用

`LLMEvent` 表示一次 provider turn 的模型输出，不负责：

- 执行本地工具；
- 决定 Agent 是否进入下一轮；
- 持久化业务会话；
- 计算 Agent 总步骤预算；
- 处理业务结果落库。

这些职责继续由 `conversation-agent.mjs` 和各业务 Adapter 负责。

### 3.2 旧接口兼容，新事件接口优先扩展

事件流是底层能力，旧接口通过消费事件重新聚合结果：

```text
Chat/Responses/其他供应商
        ↓
协议适配器
        ↓
LLMEvent
        ↓
streamComplete() 聚合为旧返回值
```

因此普通链路可以继续使用：

```js
const result = await gateway.complete(input);
const streamResult = await gateway.streamComplete(input, onDelta);
```

需要精细流式处理的新链路使用：

```js
for await (const event of gateway.streamEvents(input)) {
  // 消费统一事件
}
```

### 3.3 协议差异留在适配器

Chat Completions 的 `choices[].delta`、Responses 的 `response.output_text.delta`、Anthropic 的 `content_block_delta` 等原始事件，不能直接泄漏到 Agent 或业务层，必须在协议适配器内转换成统一事件。

## 4. 统一事件模型

新增文件：

```text
server/platform/llm/events.mjs
```

第一期定义以下事件：

```js
// 仅展示核心字段；事件对象应保持不可变。

{ type: 'turn-start', turnId, seq }

{ type: 'text-start', turnId, seq, blockId }
{ type: 'text-delta', turnId, seq, blockId, text }
{ type: 'text-end', turnId, seq, blockId }

{ type: 'reasoning-start', turnId, seq, blockId }
{ type: 'reasoning-delta', turnId, seq, blockId, text }
{ type: 'reasoning-end', turnId, seq, blockId }

{ type: 'tool-input-start', turnId, seq, callId, name }
{ type: 'tool-input-delta', turnId, seq, callId, name, delta }
{ type: 'tool-input-end', turnId, seq, callId, name }

{
  type: 'tool-call',
  turnId,
  seq,
  callId,
  name,
  input,
  providerExecuted: false,
}

{ type: 'usage', turnId, seq, usage }
{ type: 'finish', turnId, seq, reason }
{ type: 'error', turnId, seq, code, message, retryable }
```

### 4.1 字段约束

- `turnId`：一次模型请求的唯一 ID。
- `seq`：该轮事件内单调递增的序号，用于日志排序和断点定位。
- `blockId`：文本或推理内容块的 ID；供应商没有对应 ID 时由适配器生成。
- `callId`：工具调用 ID，优先使用供应商原生 ID；没有时由适配器生成。
- `providerExecuted`：供应商托管工具已执行时为 `true`；本地工具调用为 `false`。
- 事件对象不得直接暴露 API 密钥、完整敏感原文或未清洗的供应商响应。

### 4.2 典型序列

普通文本：

```text
turn-start
text-start
text-delta*
text-end
usage
finish
```

工具调用：

```text
turn-start
tool-input-start
tool-input-delta*
tool-input-end
tool-call
usage
finish
```

推理加文本：

```text
turn-start
reasoning-start
reasoning-delta*
reasoning-end
text-start
text-delta*
text-end
usage
finish
```

流中断：

```text
turn-start
text-start
text-delta*
error
```

没有 `finish` 不应被伪装成正常完成；如果网络层在没有终止事件的情况下结束，应产生可诊断的 `error`。

## 5. 网关改造

### 5.1 新增 `streamEvents()`

在 `ModelGateway` 中新增：

```js
async *streamEvents(input) {}
```

职责：

1. 发送请求并读取 SSE。
2. 将原始供应商事件转换为 `LLMEvent`。
3. 维护 `turnId`、`seq`、工具参数累加器和终止状态。
4. 在响应结束时检查是否收到合法终止事件。
5. 在网络中断、供应商错误或参数解析失败时输出 `error`。

### 5.2 现有 Chat Completions 映射

```text
choices[0].delta.content
        → text-delta

choices[0].delta.reasoning_content
        → reasoning-delta

choices[0].delta.tool_calls[].function.arguments
        → tool-input-delta

完整工具参数
        → tool-call

choices[0].finish_reason
        → finish

usage
        → usage
```

工具参数需要按 `callId` 或供应商提供的 index 独立累加，不能把多个并行工具调用的参数拼在一起。

### 5.3 旧 `streamComplete()` 改为事件聚合器

```js
async streamComplete(input, onDelta, onThinking) {
  let content = '';
  let reasoning = '';
  const toolCalls = [];

  for await (const event of this.streamEvents(input)) {
    if (event.type === 'text-delta') {
      content += event.text;
      onDelta?.(event.text, content);
    }

    if (event.type === 'reasoning-delta') {
      reasoning += event.text;
      onThinking?.(event.text, reasoning);
    }

    if (event.type === 'tool-call') toolCalls.push(event);
    if (event.type === 'error') throw eventToError(event);
  }

  if (!content.trim() && !toolCalls.length) {
    throw new Error('模型既未返回文本，也未返回工具调用');
  }

  return { content, reasoning, toolCalls, usage, id, finishReason };
}
```

第一期可以保留旧返回字段，并以新增的 `toolCalls` 字段向后扩展。

### 5.4 空文本判断规则

当前的：

```js
if (!content.trim()) throw ...;
```

改为：

```text
有文本       → 正常文本结果
有工具调用   → 正常工具轮次
有推理但无文本且无工具 → 按当前业务策略重试或报错
全部为空     → 真正的空响应错误
```

这可以修复“`finish=stop` 但响应实际包含工具调用”的误判；不能修复模型真的返回空响应。

## 6. Agent 接入策略

### 6.1 第一阶段：事件层与旧协议兼容（已实施）

`conversation-agent.mjs` 保持现有 `final` / `tool_requests` 逻辑不变。网关的事件流用于：

- 统一前端流式展示；
- 保存或输出诊断日志；
- 区分文本、推理和结束状态；
- 判断空文本是否伴随工具调用；
- 识别缺少终止事件的断流。

普通业务链路和现有 Agent Adapter 不需要改写。

### 6.2 第二阶段：按 Agent 引入原生工具调用

当某个 Agent 需要摆脱自定义 JSON 工具协议时，再让它消费：

```text
tool-input-delta
tool-call
tool-result
```

执行关系：

```text
LLMEvent: tool-call
        ↓
AgentEvent: tool.requested
        ↓
executeConversationTool()
        ↓
AgentEvent: tool.completed / tool.failed
        ↓
下一次 provider turn
```

现有 `capability` 继续作为业务授权和工具路由标识。由于部分供应商的 function name 不允许点号，需要建立传输名映射：

```text
业务 capability：content.url.fetch
传输工具名：    cap_content_url_fetch
```

`callId` 与现有 `requestId` 建立映射，不要求业务层立刻更换 ID。

### 6.3 上下文兼容

第一阶段不改变 Agent 的业务协议；第二阶段已让 `compactAgentHistory()` 保留原生 assistant/tool 消息。

第二阶段引入原生工具调用后，`context.mjs` 保留：

- assistant 的工具调用 item；
- 对应的 tool result item；
- `callId` 配对关系；
- 最近一次工具轮次的顺序。

不能把原生工具调用重新压扁成普通 `user` 文本，否则会丢失协议语义。

## 7. Responses API 适配

Responses API 已作为可选协议接入。模型配置增加：

```json
{ "protocol": "chat_completions" }
```

或：

```json
{ "protocol": "responses" }
```

默认值为 `chat_completions`，因此既有配置和模型调用行为不变。适配器负责将 Responses 的 `input`、`function_call`、`function_call_output` 和命名 SSE 事件转换为网关已有的消息、工具调用和 `LLMEvent`。

当前映射：

```text
response.output_text.delta
        → text-delta

response.reasoning_text.delta
        → reasoning-delta

response.function_call_arguments.delta
        → tool-input-delta

response.output_item.done
        → tool-call / text-end

response.completed
        → finish

response.failed / response.incomplete
        → error / finish
```

Agent 不应感知具体供应商事件名称。

## 8. 文件改动清单

### 第一阶段

| 文件 | 改动 |
|---|---|
| `server/platform/llm/events.mjs` | 新增事件类型、构造器、事件校验和错误转换 |
| `server/platform/llm/gateway.mjs` | 抽出 `streamEvents()`；保留旧接口；解析工具调用；修正空文本判断 |
| `server/platform/llm/stream-parser.mjs` | 可选新增，承载 SSE 分帧、事件累加和终止状态机 |
| `test/platform/llm-event-stream.test.mjs` | 新增事件映射、断流和空文本测试 |
| 现有调用方 | 原则上不改，仅按需接入事件监听 |

### 第二阶段（已实施）

| 文件 | 改动 |
|---|---|
| `server/platform/agent/conversation-agent.mjs` | 消费原生 `tool-call`，保留旧协议回退 |
| `server/platform/agent/context.mjs` | 保留结构化 assistant/tool item 和 call ID 配对 |
| `server/platform/agent/tool-catalog.mjs` | 增加原生 function schema 与传输名映射、供应商能力登记读取 |
| `server/platform/llm/stream-events.mjs` | 解析非流式原生 `tool_calls`，复用统一流式工具事件 |
| `server/platform/llm/gateway.mjs` | 发送 `tools` schema、保留原生历史、返回 `toolCalls` |
| `server/platform/extensions/model-provider-configuration.mjs` | 登记 `supportsNativeTools` 与 `supportsToolCallStreaming` |
| `server/platform/integrations/model-provider-settings.mjs` | 持久化模型能力登记 |
| 三个对话 Agent Adapter | 编辑室、自主写作、自定义图文按供应商能力启用原生工具，旧协议回退 |
| `server/platform/agent/ai-visual-document-agent.mjs` | 图文与封面共享 Agent 按供应商能力启用原生 `append/finish` 工具，保留 JSON 修复回退 |
| 各 Agent Adapter | 按 Agent 逐个启用原生工具调用，不做全量一次性切换 |

### Responses 适配

| 文件 | 改动 |
|---|---|
| `server/platform/llm/responses-api.mjs` | Responses 请求、工具定义、历史 item、非流式响应和命名 SSE 事件转换 |
| `server/platform/llm/gateway.mjs` | 根据 `provider.protocol` 选择 Chat Completions 或 Responses，继续输出统一结果 |
| `server/platform/core/config.mjs` | 内置模型增加显式协议字段，默认保持 Chat Completions |
| `server/platform/extensions/model-provider-configuration.mjs` | 配置中心提供协议选择 |
| `server/platform/integrations/model-provider-settings.mjs` | 持久化协议选择并兼容旧配置 |
| `test/gateway-responses-api.test.mjs` | 覆盖请求转换、工具历史和流式事件序列 |

## 9. 测试方案

至少覆盖：

1. 普通文本 SSE：多个 `text-delta` 正确聚合。
2. 推理加文本：两类增量互不串线。
3. 工具调用且 `content` 为空：产生 `tool-call`，不报空文本错误。
4. 工具参数拆成多个 chunk：按 `callId` 正确累加。
5. 同一轮多个工具调用：参数和 ID 不交叉。
6. `finish=stop` 且有工具调用：正常完成该轮。
7. 无文本、无工具调用：产生明确空响应错误。
8. 没有终止事件就断流：产生断流错误，不伪装成正常完成。
9. SSE 中存在无效 JSON 行：忽略可忽略噪声，并在无法恢复时报告错误。
10. 旧 `streamComplete()` 返回值与改造前兼容。

## 10. 验收标准

- 现有全量测试通过。
- 现有非 Agent 链路无需修改即可正常调用模型。
- `finish=stop` 且包含工具调用时，不再报“未返回流式文本内容”。
- 日志可以按 `turnId + seq` 重建一次模型调用的完整事件顺序。
- 断流、供应商错误和空响应可以区分。
- 事件层不依赖具体业务 capability，不改变现有权限边界。
- 不引入 OpenCode 的完整运行时依赖。
- 第二阶段可以在不修改事件消费者的情况下新增 Responses 适配器。

## 11. 风险与边界

### 11.1 事件层不是输出质量保证

事件流不能阻止模型生成错误内容，也不能保证超长 HTML/CSS 不达到输出上限。视觉 Agent 的超长结构化输出仍需要分块写入、Schema 校验或工具化改造。

### 11.2 工具参数仍可能不合法

即使工具参数以增量事件传输，模型仍可能生成无效 JSON 或不符合 Schema 的参数。解析失败应转成工具级错误，不应让整个 Agent 运行时失去上下文。

### 11.3 事件持久化要控制敏感信息和体积

默认日志只记录事件类型、ID、长度、状态和摘要；完整文本、工具参数和工具结果按现有脱敏及截断策略处理，不直接复制完整上游 payload。

## 12. 结论

本方案只把模型调用从“最终字符串接口”升级为“统一事件流接口”，不强迫现有业务立即迁移 Responses API，也不要求复制 OpenCode 的完整架构。

第一阶段的核心收益是：

```text
更准确地表示一次模型调用发生了什么
→ 正确识别无文本工具轮次
→ 定位断流和解析失败位置
→ 为后续原生工具调用和 Responses 适配预留边界
```

该方案的改造范围可控，适合作为当前项目的独立基础设施改造。
