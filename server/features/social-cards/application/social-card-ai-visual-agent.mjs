import { runConversationAgent } from '../../../platform/agent/conversation-agent.mjs';
import { AgentContractError, normalizeAgentEnvelope, normalizeToolRequest, validateAgentEnvelope } from '../../../platform/agent/tool-protocol.mjs';
import { parseModelJsonWithRepair } from '../../../platform/llm/model-json.mjs';

const PROJECT_READ = 'filesystem.project.read';
export const AI_VISUAL_DOCUMENT_WRITE = 'filesystem.project.document_write';

// 留出 JSON 信封、工具参数和结束符的余量，避免内容刚好填满模型输出上限后
// 只剩下不完整的 `tool_requests` 闭合符。
const DOCUMENT_CHUNK_MAX_CHARS = 8_000;
// 正常生成和 JSON/过早 final 恢复必须使用同一个输出预算，避免恢复请求
// 采用更小上限后，把同一个 append 请求再次截断。
const AGENT_OUTPUT_MAX_TOKENS = 5_000;

function readRequest(requestId, workspaceFiles, reason = '读取 AI 视觉生成资料') {
  return {
    type: 'tool_requests',
    assistant_note: '先读取候选视觉生成资料',
    requests: [{
      requestId,
      capability: PROJECT_READ,
      arguments: {
        resourceId: 'project:current',
        options: { includePaths: workspaceFiles, maxFiles: workspaceFiles.length, maxCharsPerFile: 100_000, maxTotalChars: 140_000 },
      },
      reason,
    }],
  };
}

function generationInstruction({ sourceRead, documentStarted, documentFinished, pageCount, maxPages }) {
  if (!sourceRead) return '先读取 workspace.files 中的全部本次运行输入；技能内置参考已经随系统提示注入，并据此完成整组页面的视觉解释；不要先写页面。';
  if (!documentStarted) {
    return '资料已读取。现在开始一次完整的单 Agent 视觉生成会话：先用 filesystem.project.document_write 的 begin 操作建立文档。不要返回 final。';
  }
  if (documentFinished) {
    return '文档已完成 finish。现在只返回严格合法的 {"type":"final","assistantReply":"已完成 AI 视觉 HTML 生成"}，不要调用工具，不要输出 HTML/CSS。';
  }
  if (pageCount < maxPages) {
    return `当前检测到 ${pageCount}/${maxPages} 页。继续用 filesystem.project.document_write 的 append 原样追加下一段完整 HTML/CSS，单个 content 不超过 ${DOCUMENT_CHUNK_MAX_CHARS} 字符。你负责自行决定 CSS、页面和闭合标签的分块顺序；当前仍未完成整组 ${maxPages} 页，不要返回 final。每个 append 使用新的 requestId，并根据上一次工具结果填写 expectedRevision。服务端会自动注入固定的 resourceId、path 和 sessionId。`;
  }
  return `当前检测到已达到 ${maxPages} 页。检查整份 HTML 是否已经包含完整主题 CSS、所有页面结构、闭合标签和可见主题装饰；如果还没写完，继续 append，每个 content 不超过 ${DOCUMENT_CHUNK_MAX_CHARS} 字符。全部内容写完后，用 filesystem.project.document_write 的 finish 结束会话，随后才能返回 final。服务端会自动注入固定的 resourceId、path 和 sessionId。`;
}

function generationStageOverride(requiredPageCount) {
  return `
## 当前 Agent 阶段：单一 AI 视觉生成

  你是整组 ${requiredPageCount} 页社交卡的唯一视觉设计师、HTML/CSS 执行者和文件写入者。不要把任务拆给 CSS Agent、页面 Agent 或任何后续程序。先完整读取 workspace.files 中的全部本次运行输入；布局、结构和组件映射参考已随技能提示注入；再在同一个会话中完成视觉解释、主题系统、组件 CSS、全部页面和 HTML 闭合。

- 当前只允许调用 filesystem.project.read 和 filesystem.project.document_write。
- 只使用 filesystem.project.document_write 写入文件；不要输出完整 HTML/CSS 到 final 或普通回答。
- 写入目标固定为 project:current 下的 ai-beautified.html；resourceId、path 和 sessionId 由服务端自动注入，不要为了补齐它们消耗输出空间。
- 第一次写入必须是 operation=begin；之后使用 operation=append 原样追加 HTML/CSS 分块；所有内容写完后使用 operation=finish；finish 成功后才能返回 final。
- append 的 content 是原始 HTML/CSS，不要让程序替你拼接、改写、补 CSS、补结构或插入主题装饰。每块不超过 ${DOCUMENT_CHUNK_MAX_CHARS} 字符，并为每块使用唯一 requestId；能填写时使用上一次结果中的 expectedRevision。
- 可以先追加完整 HTML 的 doctype/head/style，再追加 body/page，也可以按你认为最稳妥的顺序分块；不要假设程序会保留任何预置页面壳，最终文件必须由你的分块内容本身构成完整 HTML。
- 视觉判断必须来自 workspace.files 中的全部输入和你的整组设计决策：每页一个主焦点，主题装饰在 375×667 原尺寸可见，内容层级和页面节奏有变化，不能把所有页面退化为同一种普通卡片。
- 生成阶段不调用浏览器审计，不调用修复能力，不调用旧的 filesystem.project.write，不返回程序化补丁。
- 只有在 ${requiredPageCount} 页、主题 CSS、页面正文、闭合标签和主题装饰全部写完并成功 finish 后，才返回严格的 {"type":"final","assistantReply":"简短说明"}；assistantReply 必须是字符串。
- 所有工具请求必须是完整合法 JSON；HTML/CSS 放在 JSON 字符串 content 中，正确转义引号、反斜杠和换行。
`;
}

// AI 视觉模型只输出写入意图；内部 AgentEnvelope 由服务端补齐。
// 这样模型不需要重复生成 type/requests/capability/arguments 等包装层。
export function filterAiVisualGenerationCatalog(catalog = []) {
  return (Array.isArray(catalog) ? catalog : []).filter((item) => [PROJECT_READ, AI_VISUAL_DOCUMENT_WRITE].includes(item.capability));
}

export function shouldUseAiVisualPlanningThinking({ sourceRead = false, documentStarted = false, planningThinkingUsed = false } = {}) {
  return Boolean(sourceRead && documentStarted && !planningThinkingUsed);
}

export async function runSocialCardAiVisualGenerationAgent({
  gateway,
  store,
  batchId,
  candidateId,
  provider,
  registry,
  catalog,
  agentSystem,
  renderRequest,
  workspaceFiles,
  requiredPageCount,
  getPageCount,
  documentWriteSessionId,
  markSourceRead = () => {},
  onPhaseChange = () => {},
  resolveArguments,
  sanitizeToolResult,
  toolContext = {},
  maxOutputTokens = AGENT_OUTPUT_MAX_TOKENS,
  onProgress = () => {},
} = {}) {
  if (typeof getPageCount !== 'function') throw new TypeError('生成 Agent 缺少 getPageCount');
  if (!documentWriteSessionId) throw new TypeError('生成 Agent 缺少 documentWriteSessionId');
  const files = Array.isArray(workspaceFiles) ? [...workspaceFiles] : [];
  // 生成阶段只读取冻结的设计输入。ai-beautified.html 是本轮输出，不作为旧页面
  // 参考，避免上一轮的 CSS、类名或页面骨架污染当前 Agent 的视觉判断。
  const pageFiles = [...new Set(files)];
  const maxPages = Math.max(1, Number(requiredPageCount) || 1);
  const generationCatalog = filterAiVisualGenerationCatalog(catalog);
  const allowedCapabilities = [PROJECT_READ, AI_VISUAL_DOCUMENT_WRITE];
  const baseMessages = [{ role: 'user', protected: true, content: JSON.stringify({ render_request: renderRequest }) }];
  let sourceRead = false;
  let documentStarted = false;
  let documentFinished = false;
  let pendingOperation = null;
  let lastModelResult = null;
  let planningThinkingUsed = false;

  const complete = async ({ history, step, signal, instruction, outputMaxTokens = AGENT_OUTPUT_MAX_TOKENS, thinking = false }) => gateway.complete({
    provider,
    purpose: 'social-card-ai-visual-generation-agent',
    batchId,
    candidateId,
    thinking,
    temperature: step ? 0.35 : 0.25,
    maxOutputTokens: Math.min(outputMaxTokens, maxOutputTokens),
    adaptiveOutput: false,
    jsonMode: true,
    signal,
    messages: [...history, { role: 'user', protected: true, content: instruction }],
  });

  const describeModelResponseError = (error) => {
    const issueText = Array.isArray(error?.issues) && error.issues.length
      ? `；字段问题：${error.issues.map((issue) => `${issue.path || '未知字段'}（${issue.code || 'INVALID'}）`).join('、')}`
      : '';
    return `${error?.code || 'MODEL_RESPONSE_INVALID'}：${error?.message || '响应不符合要求'}${issueText}`.slice(0, 900);
  };

  const jsonRecoveryInstruction = (error, attempt, maxAttempts) => `上一条模型响应无法安全解析为完整 JSON。第 ${attempt}/${maxAttempts} 次恢复。具体问题：${describeModelResponseError(error)}。只返回一个完整合法的 filesystem.project.document_write append 工具请求；content 只放尚未写入的更短 HTML/CSS 分块，不超过 ${Math.min(8_000, DOCUMENT_CHUNK_MAX_CHARS)} 字符；不要返回解释，不要返回完整 HTML。服务端会补齐 resourceId、path、sessionId、assistant_note 和 reason。`;

  const protocolRecoveryInstruction = (parsed, error) => {
    const detail = describeModelResponseError(error);
    if (parsed?.type === 'final') {
      return `上一条响应 JSON 语法正确，但 final 信封不符合协议。具体问题：${detail}。只返回完整合法的 {"type":"final","assistantReply":"阶段已完成"}，不要调用工具，不要输出解释。`;
    }
    return `上一条响应 JSON 语法正确，但工具请求信封不符合协议。具体问题：${detail}。只返回一个完整合法的 filesystem.project.document_write append 工具请求；必须保留外层 requestId、capability、arguments.operation 和 append 的 content。assistant_note、reason、resourceId、path、sessionId 可以省略，服务端会自动补齐；不要返回解释。`;
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
        const recoveryResult = await complete({
          history,
          step,
          signal,
          instruction: jsonRecoveryInstruction(error, attempt, maxAttempts),
          outputMaxTokens: AGENT_OUTPUT_MAX_TOKENS,
        });
        lastModelResult = recoveryResult;
        return recoveryResult;
      },
    });
    try {
      return validateAgentEnvelope(normalizeAgentEnvelope(parsed), { maxRequests: 1 });
    } catch (error) {
      onProgress('AI 视觉 Agent 输出字段不符合协议，反馈具体字段问题…');
      const corrected = await complete({
        history,
        step,
        signal,
        instruction: protocolRecoveryInstruction(parsed, error),
        outputMaxTokens: AGENT_OUTPUT_MAX_TOKENS,
      });
      lastModelResult = corrected;
      const correctedParsed = await parseModelJsonWithRepair(corrected, {
        store,
        label: `${label}协议反馈结果`,
        allowMissingToolRequestReason: true,
        allowMissingToolRequestAssistantNote: true,
        maxRepairAttempts: 1,
        repair: async (jsonError, { attempt, maxAttempts }) => {
          const recoveryResult = await complete({
            history,
            step,
            signal,
            instruction: jsonRecoveryInstruction(jsonError, attempt, maxAttempts),
            outputMaxTokens: AGENT_OUTPUT_MAX_TOKENS,
          });
          lastModelResult = recoveryResult;
          return recoveryResult;
        },
      });
      return validateAgentEnvelope(normalizeAgentEnvelope(correctedParsed), { maxRequests: 1 });
    }
  };

  const recoverToolRequest = async ({ parsed, history, step, signal, instruction, label }) => {
    const recoveryHistory = [...history, { role: 'assistant', content: JSON.stringify(parsed), protected: true }];
    const corrected = await complete({
      history: recoveryHistory,
      step,
      signal,
      instruction,
      outputMaxTokens: AGENT_OUTPUT_MAX_TOKENS,
    });
    lastModelResult = corrected;
    return parseAndValidateVisualEnvelope({
      result: corrected,
      history: recoveryHistory,
      step,
      signal,
      label,
    });
  };

  onPhaseChange('generation');
  const agent = await runConversationAgent({
    entryPoint: 'social-card-ai-visual-generation',
    registry,
    catalog: generationCatalog,
    messages: [{ role: 'system', protected: true, content: `${agentSystem}${generationStageOverride(maxPages)}` }, ...baseMessages],
    store,
    budget: { maxModelSteps: Math.max(18, maxPages + 12), maxToolCalls: Math.max(18, maxPages + 12), maxParallelToolCalls: 1, maxToolResultChars: 80_000, maxTotalToolResultChars: 220_000, maxHistoryChars: 220_000, timeoutMs: 300_000 },
    toolContext: { ...toolContext, skillId: 'social-card-ai-visual-generator', generationPhase: 'generation', allowedCapabilities },
    resolveArguments,
    sanitizeToolResult,
    onEvent: (event) => {
      if (event?.type === 'tool.completed' && event?.capability === PROJECT_READ) {
        sourceRead = true;
        markSourceRead();
      }
      if (event?.type === 'tool.completed' && event?.capability === AI_VISUAL_DOCUMENT_WRITE) {
        if (pendingOperation === 'begin') documentStarted = true;
        if (pendingOperation === 'finish') documentFinished = true;
        onProgress('AI 视觉 Agent 已原样追加 HTML/CSS 分块…');
        pendingOperation = null;
      }
    },
    modelStep: async ({ messages: history, step, signal }) => {
      if (!sourceRead) return validateAgentEnvelope(readRequest(`tr_visual_read_${step + 1}`, pageFiles), { maxRequests: 1 });
      if (!documentStarted) {
        pendingOperation = 'begin';
        return validateAgentEnvelope({
          type: 'tool_requests',
          assistant_note: '建立 AI 视觉 HTML 写入会话',
          requests: [{
            requestId: `tr_visual_begin_${step + 1}`,
            capability: AI_VISUAL_DOCUMENT_WRITE,
            arguments: { resourceId: 'project:current', path: 'ai-beautified.html', operation: 'begin', sessionId: documentWriteSessionId },
            reason: '开始由同一个视觉 Agent 分块写入完整 HTML/CSS',
          }],
        }, { maxRequests: 1 });
      }

      const usePlanningThinking = shouldUseAiVisualPlanningThinking({ sourceRead, documentStarted, planningThinkingUsed });
      planningThinkingUsed = true;
      let result = await complete({ history, step, signal, thinking: usePlanningThinking, instruction: generationInstruction({ sourceRead, documentStarted, documentFinished, pageCount: Number(getPageCount()) || 0, maxPages }) });
      lastModelResult = result;
      let parsed = await parseAndValidateVisualEnvelope({ result, history, step, signal, label: 'AI 视觉 Agent' });
      let recoveryAttempts = 0;
      while (true) {
        if (parsed?.type === 'final') {
          if (documentFinished && (Number(getPageCount()) || 0) >= maxPages) return validateAgentEnvelope(parsed, { maxRequests: 1 });
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续过早返回 final，文档尚未完成，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({
            parsed,
            history,
            step,
            signal,
            label: 'AI 视觉 Agent 完成前恢复',
            instruction: generationInstruction({ sourceRead, documentStarted, documentFinished, pageCount: Number(getPageCount()) || 0, maxPages }) + ' 你刚才过早返回了 final。必须继续写入，不能结束。',
          });
          continue;
        }
        if (parsed?.type !== 'tool_requests') return validateAgentEnvelope({ type: 'final', assistantReply: 'AI 视觉生成阶段结束' }, { maxRequests: 1 });

        const request = normalizeToolRequest(parsed.requests?.[0], { fallbackReason: '执行 AI 视觉分块写入' });
        if (!request || ![PROJECT_READ, AI_VISUAL_DOCUMENT_WRITE].includes(request.capability)) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续返回不可用的工具能力，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({
            parsed,
            history,
            step,
            signal,
            label: 'AI 视觉 Agent 工具能力恢复',
            instruction: '上一条工具请求未执行，原因：只能使用 filesystem.project.read 或 filesystem.project.document_write。请保留尚未写入的 HTML/CSS 内容，只返回一个完整合法、能力正确的工具请求；不要输出空 append、解释或完整 HTML。服务端会自动补齐 resourceId、path、sessionId、assistant_note 和 reason。',
          });
          continue;
        }
        if (request.capability === PROJECT_READ) {
          sourceRead = true;
          markSourceRead();
          return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
        }
        const operation = String(request.arguments?.operation || '');
        if (!['begin', 'append', 'finish', 'abort'].includes(operation)) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续返回不可用的写入操作，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({
            parsed,
            history,
            step,
            signal,
            label: 'AI 视觉 Agent 写入操作恢复',
            instruction: '上一条文档写入请求未执行，原因：operation 必须是 begin、append、finish 或 abort。请保留尚未写入的 HTML/CSS 内容，只返回一个完整合法的 filesystem.project.document_write 请求；不要输出空 append、解释或完整 HTML。服务端会自动补齐 resourceId、path、sessionId、assistant_note 和 reason。',
          });
          continue;
        }
        const content = String(request.arguments?.content ?? '');
        if (operation === 'append' && !content) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续返回空 append，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({
            parsed,
            history,
            step,
            signal,
            label: 'AI 视觉 Agent 分块大小恢复',
            instruction: '上一条 append 请求未执行，因为 content 为空。请继续写入尚未写入的 HTML/CSS，只返回一个 content 非空的完整合法 append 工具请求；不要返回空 append、解释或完整 HTML。服务端会补齐 resourceId、path、sessionId、assistant_note 和 reason。',
          });
          continue;
        }
        request.arguments = { ...(request.arguments || {}), resourceId: 'project:current', path: 'ai-beautified.html', sessionId: documentWriteSessionId };
        pendingOperation = operation;
        return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
      }
    },
  });
  onPhaseChange('idle');
  return {
    ...agent,
    sourceRead,
    lastModelResult,
    cssChunkCount: 0,
    pageCount: Number(getPageCount()) || 0,
    documentStarted,
    documentFinished,
    allowedCapabilities,
    catalog: generationCatalog,
  };
}
