import { runConversationAgent } from './conversation-agent.mjs';
import { AgentContractError, normalizeAgentEnvelope, normalizeToolRequest, validateAgentEnvelope } from './tool-protocol.mjs';
import { parseModelJsonWithRepair } from '../llm/model-json.mjs';
import { buildNativeToolDefinitions, capabilityForToolName, providerSupportsNativeTools, providerSupportsToolCallStreaming } from './tool-catalog.mjs';

export const AI_VISUAL_PROJECT_READ = 'cap_filesystem_project_read';
export const AI_VISUAL_DOCUMENT_WRITE = 'cap_filesystem_project_document_write';
export const AI_VISUAL_DOCUMENT_CHUNK_MAX_CHARS = 8_000;
export const AI_VISUAL_AGENT_OUTPUT_MAX_TOKENS = 5_000;

function readRequest(requestId, workspaceFiles, reason = '读取 AI 视觉生成资料') {
  return {
    type: 'tool_requests',
    assistant_note: '先读取候选视觉生成资料',
    requests: [{
      requestId,
      capability: AI_VISUAL_PROJECT_READ,
      arguments: {
        resourceId: 'project:current',
        options: { includePaths: workspaceFiles, maxFiles: workspaceFiles.length, maxCharsPerFile: 100_000, maxTotalChars: 140_000 },
      },
      reason,
    }],
  };
}

function generationInstruction({ sourceRead, documentStarted, documentFinished, pageCount, maxPages, outputPath, documentLabel }) {
  if (!sourceRead) return '先读取 workspace.files 中的全部本次运行输入；技能内置参考已经随系统提示注入，并据此完成视觉解释；不要先写页面。';
  if (!documentStarted) return `资料已读取。现在开始一次完整的单 Agent ${documentLabel}生成会话：先用 cap_filesystem_project_document_write 的 begin 操作建立文档。不要返回 final。`;
  if (documentFinished) return `文档 ${outputPath} 已完成 finish。现在只返回严格合法的 {"type":"final","assistantReply":"已完成 AI 视觉 HTML 生成"}，不要调用工具，不要输出 HTML/CSS。`;
  if (pageCount < maxPages) return `当前检测到 ${pageCount}/${maxPages} 页。继续用 cap_filesystem_project_document_write 的 append 原样追加下一段完整 HTML/CSS，单个 content 不超过 ${AI_VISUAL_DOCUMENT_CHUNK_MAX_CHARS} 字符。当前仍未完成 ${documentLabel}，不要返回 final。每个 append 使用新的 requestId，并根据上一次工具结果填写 expectedRevision。服务端会自动注入固定的 resourceId、path 和 sessionId。`;
  return `当前检测到已达到 ${maxPages} 页。检查 ${outputPath} 是否已经包含完整主题 CSS、所有页面结构、闭合标签和可见主题装饰；如果还没写完，继续 append，每个 content 不超过 ${AI_VISUAL_DOCUMENT_CHUNK_MAX_CHARS} 字符。全部内容写完后，用 cap_filesystem_project_document_write 的 finish 结束会话，随后才能返回 final。`;
}

function generationStageOverride({ requiredPageCount, canvas, outputPath, documentLabel, nativeTools = false }) {
  const width = Number(canvas?.width) || 375;
  const height = Number(canvas?.height) || 667;
  return `
## 当前 Agent 阶段：单一 AI 视觉生成

你是 ${documentLabel}的唯一视觉设计师、HTML/CSS 执行者和文件写入者。需要生成 ${requiredPageCount} 页，画布基准为 ${width}×${height}。不要把任务拆给 CSS Agent、页面 Agent 或任何后续程序。先完整读取 workspace.files 中的全部本次运行输入；布局、结构和组件参考已随技能提示注入；再在同一个会话中完成视觉解释、主题系统、组件 CSS、全部页面和 HTML 闭合。

- 当前只允许调用 cap_filesystem_project_read 和 cap_filesystem_project_document_write。
- 只使用 cap_filesystem_project_document_write 写入文件；不要输出完整 HTML/CSS 到 final 或普通回答。
- 写入目标固定为 project:current 下的 ${outputPath}；resourceId、path 和 sessionId 由服务端自动注入。
- 第一次写入必须是 operation=begin；之后使用 operation=append 原样追加 HTML/CSS 分块；所有内容写完后使用 operation=finish；finish 成功后才能返回 final。
- append 的 content 是原始 HTML/CSS，不要让程序替你拼接、改写、补 CSS、补结构或插入主题装饰。每块不超过 ${AI_VISUAL_DOCUMENT_CHUNK_MAX_CHARS} 字符，并为每块使用唯一 requestId；能填写时使用上一次结果中的 expectedRevision。
- 不要假设程序会保留预置页面壳，最终文件必须由你的分块内容本身构成完整 HTML。
- 生成阶段不调用浏览器审计，不调用修复能力，不调用旧的 cap_filesystem_project_write，不返回程序化补丁。
- 只有在 ${requiredPageCount} 页、主题 CSS、页面正文、闭合标签和主题装饰全部写完并成功 finish 后，才返回严格的 {"type":"final","assistantReply":"简短说明"}；assistantReply 必须是字符串。
${nativeTools ? '- 工具调用必须使用 API 提供的原生 function tool；不要在普通文本中伪造 tool_requests JSON。' : '- 所有工具请求必须是完整合法 JSON；HTML/CSS 放在 JSON 字符串 content 中，正确转义引号、反斜杠和换行。'}
`;
}

export function filterAiVisualGenerationCatalog(catalog = [], documentWriteCapability = AI_VISUAL_DOCUMENT_WRITE) {
  return (Array.isArray(catalog) ? catalog : []).filter((item) => [AI_VISUAL_PROJECT_READ, documentWriteCapability].includes(item.capability));
}

export function shouldUseAiVisualPlanningThinking({ sourceRead = false, documentStarted = false, planningThinkingUsed = false } = {}) {
  return Boolean(sourceRead && documentStarted && !planningThinkingUsed);
}

export async function runAiVisualDocumentAgent({
  gateway,
  store,
  batchId,
  candidateId,
  provider,
  registry,
  catalog,
  agentSystem = '',
  renderRequest = {},
  workspaceFiles = [],
  requiredPageCount = 1,
  canvas = { width: 375, height: 667 },
  outputPath = 'ai-visual.html',
  documentLabel = 'AI 视觉文档',
  entryPoint = 'ai-visual-document-generation',
  skillId = 'ai-visual-document-generator',
  purpose = 'ai-visual-document-generation-agent',
  documentWriteCapability = AI_VISUAL_DOCUMENT_WRITE,
  getPageCount,
  documentWriteSessionId,
  markSourceRead = () => {},
  onPhaseChange = () => {},
  resolveArguments,
  sanitizeToolResult,
  toolContext = {},
  maxOutputTokens = AI_VISUAL_AGENT_OUTPUT_MAX_TOKENS,
  budget = {},
  onProgress = () => {},
  onEvent = () => {},
} = {}) {
  if (typeof getPageCount !== 'function') throw new TypeError('AI 视觉文档 Agent 缺少 getPageCount');
  if (!documentWriteSessionId) throw new TypeError('AI 视觉文档 Agent 缺少 documentWriteSessionId');
  const pageFiles = [...new Set(Array.isArray(workspaceFiles) ? workspaceFiles : [])];
  const maxPages = Math.max(1, Number(requiredPageCount) || 1);
  const generationCatalog = filterAiVisualGenerationCatalog(catalog, documentWriteCapability);
  const nativeTools = providerSupportsNativeTools(gateway, provider);
  const nativeToolDefinitions = nativeTools ? buildNativeToolDefinitions(generationCatalog) : [];
  const nativeToolStreaming = nativeTools && providerSupportsToolCallStreaming(gateway, provider);
  const allowedCapabilities = [AI_VISUAL_PROJECT_READ, documentWriteCapability];
  const baseMessages = [{ role: 'user', protected: true, content: JSON.stringify({ render_request: renderRequest }) }];
  let sourceRead = false;
  let documentStarted = false;
  let documentFinished = false;
  let pendingOperation = null;
  let lastModelResult = null;
  let planningThinkingUsed = false;

  const complete = async ({ history, step, signal, instruction, outputMaxTokens = AI_VISUAL_AGENT_OUTPUT_MAX_TOKENS, thinking = false, emit = () => {}, native = false }) => {
    const input = {
      provider,
      purpose,
      batchId,
      candidateId,
      thinking,
      temperature: step ? 0.35 : 0.25,
      maxOutputTokens: Math.min(outputMaxTokens, maxOutputTokens),
      adaptiveOutput: false,
      jsonMode: !native,
      tools: native ? nativeToolDefinitions : [],
      nativeTools: native,
      signal,
      messages: [...history, { role: 'user', protected: true, content: instruction }],
    };
    if (native && nativeToolStreaming && typeof gateway.streamComplete === 'function') {
      return gateway.streamComplete(input, () => {}, (text) => emit('assistant.thinking', { text }));
    }
    return gateway.complete(input);
  };

  const describeModelResponseError = (error) => {
    const issueText = Array.isArray(error?.issues) && error.issues.length
      ? `；字段问题：${error.issues.map((issue) => `${issue.path || '未知字段'}（${issue.code || 'INVALID'}）`).join('、')}`
      : '';
    return `${error?.code || 'MODEL_RESPONSE_INVALID'}：${error?.message || '响应不符合要求'}${issueText}`.slice(0, 900);
  };

  const jsonRecoveryInstruction = (error, attempt, maxAttempts) => `上一条模型响应无法安全解析为完整 JSON。第 ${attempt}/${maxAttempts} 次恢复。具体问题：${describeModelResponseError(error)}。只返回一个完整合法的 cap_filesystem_project_document_write append 工具请求；content 只放尚未写入的更短 HTML/CSS 分块，不超过 ${AI_VISUAL_DOCUMENT_CHUNK_MAX_CHARS} 字符；不要返回解释，不要返回完整 HTML。服务端会补齐 resourceId、path、sessionId、assistant_note 和 reason。`;

  const protocolRecoveryInstruction = (parsed, error) => {
    const detail = describeModelResponseError(error);
    if (parsed?.type === 'final') return `上一条响应 JSON 语法正确，但 final 信封不符合协议。具体问题：${detail}。只返回完整合法的 {"type":"final","assistantReply":"阶段已完成"}，不要调用工具，不要输出解释。`;
    return `上一条响应 JSON 语法正确，但工具请求信封不符合协议。具体问题：${detail}。只返回一个完整合法的 cap_filesystem_project_document_write append 工具请求；必须保留外层 requestId、capability、arguments.operation 和 append 的 content。assistant_note、reason、resourceId、path、sessionId 可以省略，服务端会自动补齐；不要返回解释。`;
  };

  const parseAndValidateVisualEnvelope = async ({ result, history, step, signal, label }) => {
    const parsed = await parseModelJsonWithRepair(result, {
      store,
      label,
      allowMissingToolRequestReason: true,
      allowMissingToolRequestAssistantNote: true,
      maxRepairAttempts: 2,
      repair: async (error, { attempt, maxAttempts }) => {
        onProgress(`AI 视觉 Agent 输出结构异常，第 ${attempt} 次反馈具体错误并缩短分块…`);
        const recoveryResult = await complete({ history, step, signal, instruction: jsonRecoveryInstruction(error, attempt, maxAttempts) });
        lastModelResult = recoveryResult;
        return recoveryResult;
      },
    });
    try {
      return validateAgentEnvelope(normalizeAgentEnvelope(parsed), { maxRequests: 1 });
    } catch (error) {
      onProgress('AI 视觉 Agent 输出字段不符合协议，反馈具体字段问题…');
      const corrected = await complete({ history, step, signal, instruction: protocolRecoveryInstruction(parsed, error) });
      lastModelResult = corrected;
      const correctedParsed = await parseModelJsonWithRepair(corrected, {
        store,
        label: `${label}协议反馈结果`,
        allowMissingToolRequestReason: true,
        allowMissingToolRequestAssistantNote: true,
        maxRepairAttempts: 1,
        repair: async (jsonError, { attempt, maxAttempts }) => {
          const recoveryResult = await complete({ history, step, signal, instruction: jsonRecoveryInstruction(jsonError, attempt, maxAttempts) });
          lastModelResult = recoveryResult;
          return recoveryResult;
        },
      });
      return validateAgentEnvelope(normalizeAgentEnvelope(correctedParsed), { maxRequests: 1 });
    }
  };

  const recoverToolRequest = async ({ parsed, history, step, signal, instruction, label }) => {
    const recoveryHistory = [...history, { role: 'assistant', content: JSON.stringify(parsed), protected: true }];
    const corrected = await complete({ history: recoveryHistory, step, signal, instruction });
    lastModelResult = corrected;
    return parseAndValidateVisualEnvelope({ result: corrected, history: recoveryHistory, step, signal, label });
  };

  onPhaseChange('generation');
  const agent = await runConversationAgent({
    entryPoint,
    registry,
    catalog: generationCatalog,
    messages: [{ role: 'system', protected: true, content: `${agentSystem}${generationStageOverride({ requiredPageCount: maxPages, canvas, outputPath, documentLabel, nativeTools })}` }, ...baseMessages],
    store,
    budget: {
      maxModelSteps: Number(budget.maxModelSteps) || Math.max(18, maxPages + 12),
      maxToolCalls: Number(budget.maxToolCalls) || Math.max(18, maxPages + 12),
      maxParallelToolCalls: 1,
      maxToolResultChars: Number(budget.maxToolResultChars) || 80_000,
      maxTotalToolResultChars: Number(budget.maxTotalToolResultChars) || 220_000,
      maxHistoryChars: Number(budget.maxHistoryChars) || 220_000,
      timeoutMs: Number(budget.timeoutMs) || 300_000,
    },
    toolContext: { ...toolContext, skillId, generationPhase: 'generation', allowedCapabilities },
    resolveArguments,
    sanitizeToolResult,
    onEvent: (event) => {
      if (event?.type === 'tool.completed' && event?.capability === AI_VISUAL_PROJECT_READ) {
        sourceRead = true;
        markSourceRead();
      }
      if (event?.type === 'tool.completed' && event?.capability === documentWriteCapability) {
        if (pendingOperation === 'begin') documentStarted = true;
        if (pendingOperation === 'finish') documentFinished = true;
        onProgress(`AI 视觉 Agent 已原样追加 ${documentLabel} HTML/CSS 分块…`);
        pendingOperation = null;
      }
      onEvent(event);
    },
    modelStep: async ({ messages: history, step, signal, emit }) => {
      if (!sourceRead) return validateAgentEnvelope(readRequest(`tr_visual_read_${step + 1}`, pageFiles), { maxRequests: 1 });
      if (!documentStarted) {
        pendingOperation = 'begin';
        return validateAgentEnvelope({
          type: 'tool_requests',
          assistant_note: `建立 AI 视觉 ${documentLabel}写入会话`,
          requests: [{
            requestId: `tr_visual_begin_${step + 1}`,
            capability: documentWriteCapability,
            arguments: { resourceId: 'project:current', path: outputPath, operation: 'begin', sessionId: documentWriteSessionId },
            reason: `开始由同一个视觉 Agent 分块写入完整${documentLabel} HTML/CSS`,
          }],
        }, { maxRequests: 1 });
      }

      const usePlanningThinking = shouldUseAiVisualPlanningThinking({ sourceRead, documentStarted, planningThinkingUsed });
      planningThinkingUsed = true;
      let result = await complete({ history, step, signal, emit, native: nativeTools, thinking: usePlanningThinking, instruction: generationInstruction({ sourceRead, documentStarted, documentFinished, pageCount: Number(getPageCount()) || 0, maxPages, outputPath, documentLabel }) });
      lastModelResult = result;
      if (nativeTools && result?.toolCalls?.length) {
        const call = result.toolCalls[0];
        const capability = capabilityForToolName(call.name, generationCatalog);
        const operation = String(call.input?.operation || '');
        if (capability === documentWriteCapability && ['begin', 'append', 'finish', 'abort'].includes(operation)) pendingOperation = operation;
        return { nativeTools: true, content: result.content || '', toolCalls: result.toolCalls };
      }
      let parsed = await parseAndValidateVisualEnvelope({ result, history, step, signal, label: 'AI 视觉 Agent' });
      let recoveryAttempts = 0;
      while (true) {
        if (parsed?.type === 'final') {
          if (documentFinished && (Number(getPageCount()) || 0) >= maxPages) return validateAgentEnvelope(parsed, { maxRequests: 1 });
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续过早返回 final，文档尚未完成，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 完成前恢复', instruction: `${generationInstruction({ sourceRead, documentStarted, documentFinished, pageCount: Number(getPageCount()) || 0, maxPages, outputPath, documentLabel })} 你刚才过早返回了 final。必须继续写入，不能结束。` });
          continue;
        }
        if (parsed?.type !== 'tool_requests') return validateAgentEnvelope({ type: 'final', assistantReply: 'AI 视觉生成阶段结束' }, { maxRequests: 1 });

        const request = normalizeToolRequest(parsed.requests?.[0], { fallbackReason: `执行 AI 视觉${documentLabel}分块写入` });
        if (!request || ![AI_VISUAL_PROJECT_READ, documentWriteCapability].includes(request.capability)) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续返回不可用的工具能力，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 工具能力恢复', instruction: '上一条工具请求未执行，原因：只能使用 cap_filesystem_project_read 和 cap_filesystem_project_document_write。请保留尚未写入的 HTML/CSS 内容，只返回一个完整合法、能力正确的工具请求；不要输出空 append、解释或完整 HTML。服务端会补齐资源参数。' });
          continue;
        }
        if (request.capability === AI_VISUAL_PROJECT_READ) {
          sourceRead = true;
          markSourceRead();
          return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
        }
        const operation = String(request.arguments?.operation || '');
        if (!['begin', 'append', 'finish', 'abort'].includes(operation)) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续返回不可用的写入操作，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 写入操作恢复', instruction: '上一条文档写入请求未执行，原因：operation 必须是 begin、append、finish 或 abort。请只返回一个完整合法的文档写入请求，不要返回空 append、解释或完整 HTML。服务端会补齐资源参数。' });
          continue;
        }
        const content = String(request.arguments?.content ?? '');
        if (operation === 'append' && !content) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续返回空 append，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 分块大小恢复', instruction: '上一条 append 请求未执行，因为 content 为空。请继续写入尚未写入的 HTML/CSS，只返回一个 content 非空的完整合法 append 工具请求；不要返回空 append、解释或完整 HTML。服务端会补齐资源参数。' });
          continue;
        }
        request.arguments = { ...(request.arguments || {}), resourceId: 'project:current', path: outputPath, sessionId: documentWriteSessionId };
        pendingOperation = operation;
        return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
      }
    },
  });
  onPhaseChange('idle');
  return { ...agent, sourceRead, lastModelResult, cssChunkCount: 0, pageCount: Number(getPageCount()) || 0, documentStarted, documentFinished, allowedCapabilities, catalog: generationCatalog, outputPath, canvas: { width: Number(canvas?.width) || 375, height: Number(canvas?.height) || 667 } };
}
