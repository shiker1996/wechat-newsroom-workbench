import { runConversationAgent } from '../../../platform/agent/conversation-agent.mjs';
import { normalizeToolRequest, validateAgentEnvelope } from '../../../platform/agent/tool-protocol.mjs';
import { parseModelJsonWithRepair } from '../../../platform/llm/model-json.mjs';

const PROJECT_READ = 'filesystem.project.read';
const PROJECT_WRITE = 'filesystem.project.write';

function readRequest(requestId, workspaceFiles, reason = '读取 AI 视觉生成资料') {
  return {
    type: 'tool_requests',
    assistant_note: '先读取候选视觉生成资料',
    requests: [{
      requestId,
      capability: PROJECT_READ,
      arguments: {
        resourceId: 'project:current',
        options: { includePaths: workspaceFiles, maxFiles: workspaceFiles.length, maxCharsPerFile: 100000, maxTotalChars: 140000 },
      },
      reason,
    }],
  };
}

function continueRequest(requestId, page, reason = '继续写入下一页完整 HTML') {
  return {
    type: 'tool_requests',
    assistant_note: `继续写入 P${page}`,
    requests: [{
      requestId,
      capability: PROJECT_WRITE,
      arguments: { resourceId: 'project:current', path: 'ai-beautified.html', mode: 'append_body', content: '' },
      reason,
    }],
  };
}

// CSS 至少写入一个基础分片后才能追加页面；大 CSS 必须拆成多个小分片，
// 避免把样式和页面内容塞进同一个超大的 JSON 响应。
const REQUIRED_CSS_CHUNKS = 1;
const MAX_CSS_CHUNKS = 3;
const GENERATION_CSS_CHUNK_MAX_CHARS = 3_500;
const GENERATION_OUTPUT_MAX_TOKENS = 5_000;
const CSS_OUTPUT_MAX_TOKENS = 5_000;
const CSS_RECOVERY_OUTPUT_MAX_TOKENS = 3_000;

function cssGenerationInstruction(cssChunkCount) {
  if (cssChunkCount <= 0) {
    return `当前尚未建立视觉样式。只使用 filesystem.project.write 的 set_head 写入精简的全局基础 CSS：主题变量、画布、页面壳、公共排版、页眉和页脚。不要在本片生成封面、尾页或内容组件 CSS；这些样式必须留给后续 append_head_css。当前分片严格控制在 ${GENERATION_CSS_CHUNK_MAX_CHARS} 字符以内。不要生成页面，也不要返回 final。`;
  }
  if (cssChunkCount < MAX_CSS_CHUNKS) {
    return `精简全局基础 CSS 已写入。现在使用 append_head_css 追加封面、尾页和实际页面所需的内容组件 CSS，每个分片严格控制在 ${GENERATION_CSS_CHUNK_MAX_CHARS} 字符以内；不要重复全局基础规则。如果全部实际组件均已覆盖，直接返回 CSS 阶段 final，不要生成页面。`;
  }
  return 'CSS 分片已达到上限，禁止继续追加 CSS；直接返回 CSS 阶段 final，不要生成页面。';
}

function pageGenerationInstruction(currentPageCount, maxPages) {
  if (currentPageCount < maxPages) return `当前已生成 ${currentPageCount}/${maxPages} 页。只使用 append_body 追加 P${currentPageCount + 1} 的完整 .page section，不要修改 CSS，不要返回 final。`;
  return `当前已生成 ${currentPageCount}/${maxPages} 页。页面阶段已完成，只返回简短 final，不要再调用工具。`;
}

function cssStageOverride() {
  return `
## 当前 Agent 阶段：CSS 生成

这是独立的 CSS Agent 循环。上文中的全量生成说明不能改变本阶段约束。

- 当前只允许调用 filesystem.project.read 和 filesystem.project.write；
- 先用 set_head 只写精简的全局基础 CSS：主题变量、画布、页面壳、公共排版、页眉和页脚；禁止在 set_head 中展开封面、尾页或内容组件样式；
- 封面、尾页和内容组件 CSS 只能用 append_head_css 继续追加，每个分片不超过 ${GENERATION_CSS_CHUNK_MAX_CHARS} 字符；最多 ${MAX_CSS_CHUNKS} 个 CSS 分片；
- append_head_css 不得重复主题变量、画布、页面壳、公共排版、页眉或页脚规则；
- 本阶段禁止 append_body、replace_pages、浏览器审计和完整 HTML 输出；
- 基础 CSS 和需要的组件 CSS 写完后，返回简短 final，表示 CSS 阶段完成；
- 如果基础 CSS 尚未写入，不能返回 final，必须继续提交 set_head；
- 所有 content 都必须是合法 JSON 字符串，外层 JSON 必须完整闭合。
`;
}

function pageStageOverride(requiredPageCount) {
  return `
## 当前 Agent 阶段：页面 HTML 生成

这是独立的页面 Agent 循环。CSS 阶段已经完成，当前只负责生成 ${requiredPageCount} 页 HTML。

- 当前只允许调用 filesystem.project.read 和 filesystem.project.write；
- 首次读取一次工作文件和当前 ai-beautified.html，确认已经存在的 CSS 类名；
- 只能使用 append_body，每次追加一个完整 .page section；
- 禁止 set_head、append_head_css、replace_pages、浏览器审计和完整 HTML 输出；
- 页面达到 ${requiredPageCount} 页后，返回简短 final，表示页面阶段完成；
- 如果页面还不完整，不能返回 final，必须继续追加缺失页面；
- 所有 content 都必须是合法 JSON 字符串，外层 JSON 必须完整闭合。
`;
}

function invalidCssContinuationRequest(requestId) {
  return {
    type: 'tool_requests',
    assistant_note: 'CSS 尚未完成，继续提交 CSS 分片',
    requests: [{
      requestId,
      capability: PROJECT_WRITE,
      arguments: { resourceId: 'project:current', path: 'ai-beautified.html', mode: 'set_head', content: '' },
      reason: 'CSS 尚未写入完成，不能结束 CSS 阶段',
    }],
  };
}

export function filterAiVisualGenerationCatalog(catalog = []) {
  return (Array.isArray(catalog) ? catalog : []).filter((item) => [PROJECT_READ, PROJECT_WRITE].includes(item.capability));
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
  getCssChunkCount = () => 0,
  isSourceRead = () => false,
  markSourceRead = () => {},
  onPhaseChange = () => {},
  toolHandlers,
  resolveArguments,
  sanitizeToolResult,
  toolContext = {},
  maxOutputTokens = 7000,
  onProgress = () => {},
} = {}) {
  if (typeof getPageCount !== 'function') throw new TypeError('生成 Agent 缺少 getPageCount');
  if (typeof getCssChunkCount !== 'function') throw new TypeError('生成 Agent 缺少 getCssChunkCount');
  const files = Array.isArray(workspaceFiles) ? [...workspaceFiles] : [];
  const pageFiles = [...new Set([...files, 'ai-beautified.html'])];
  const maxPages = Math.max(1, Number(requiredPageCount) || 1);
  const generationCatalog = filterAiVisualGenerationCatalog(catalog);
  const allowedCapabilities = [PROJECT_READ, PROJECT_WRITE];
  const baseMessages = [{ role: 'user', protected: true, content: JSON.stringify({ render_request: renderRequest }) }];
  const toolContextFor = (phase) => ({ ...toolContext, skillId: 'social-card-ai-visual-generator', generationPhase: phase, allowedCapabilities, toolHandlers: { [PROJECT_WRITE]: toolHandlers?.[PROJECT_WRITE] } });
  const complete = async ({ phase, history, step, signal, instruction, outputMaxTokens }) => gateway.complete({
    provider,
    purpose: `social-card-ai-visual-${phase}-generation-agent`,
    batchId,
    candidateId,
    thinking: false,
    temperature: step ? 0.35 : 0.25,
    maxOutputTokens: Math.min(outputMaxTokens || GENERATION_OUTPUT_MAX_TOKENS, maxOutputTokens),
    // Agent 自己掌握分片恢复。关闭 Gateway 的截断扩容重试，避免模型在更大
    // token 预算里重复整段 CSS，最终仍把工具 JSON 写断。
    adaptiveOutput: false,
    jsonMode: true,
    signal,
    messages: [...history, { role: 'user', protected: true, content: instruction }],
  });

  const runCssAgent = async () => {
    onPhaseChange('css');
    let sourceRead = false;
    let lastModelResult = null;
    const agent = await runConversationAgent({
      entryPoint: 'social-card-ai-visual-css-generation',
      registry,
      catalog: generationCatalog,
      messages: [{ role: 'system', protected: true, content: `${agentSystem}${cssStageOverride()}` }, ...baseMessages],
      store,
      budget: { maxModelSteps: 10, maxToolCalls: 10, maxParallelToolCalls: 1, maxToolResultChars: 80000, maxTotalToolResultChars: 180000, maxHistoryChars: 180000, timeoutMs: 300000 },
      toolContext: toolContextFor('css'),
      resolveArguments,
      sanitizeToolResult,
      onEvent: (event) => {
        if (event?.type === 'tool.completed' && event?.capability === PROJECT_READ) { sourceRead = true; markSourceRead(); }
        if (event?.type === 'tool.completed' && event?.capability === PROJECT_WRITE) onProgress('AI CSS Agent 已写入视觉样式…');
      },
      modelStep: async ({ messages: history, step, signal }) => {
        const cssChunkCount = Number(getCssChunkCount()) || 0;
        if (!sourceRead) return validateAgentEnvelope(readRequest(`tr_css_read_${step + 1}`, files), { maxRequests: 1 });
        let result = await complete({ phase: 'css', history, step, signal, instruction: cssGenerationInstruction(cssChunkCount), outputMaxTokens: CSS_OUTPUT_MAX_TOKENS });
        lastModelResult = result;
        const parsed = await parseModelJsonWithRepair(result, {
          store,
          label: 'AI CSS Agent',
          repair: async (error) => {
            const mode = cssChunkCount <= 0 ? 'set_head' : 'append_head_css';
            const scopeInstruction = mode === 'set_head'
              ? '本片只包含主题变量、画布、页面壳、公共排版、页眉和页脚，不得包含封面、尾页或内容组件 CSS。'
              : '本片只追加尚未覆盖的封面、尾页或内容组件 CSS，不得重复全局基础规则。';
            const recoveryInstruction = `上一条响应 JSON 不完整（${error.code || 'JSON_FORMAT_ERROR'}）。重新生成一个更短的新分片，不要复制或修补上一条响应。只返回一个 ${mode} 工具请求；content 必须包含完整 style，CSS 分片控制在 2400 字符以内；${scopeInstruction}不要重复 CSS，不要返回页面或解释。`;
            onProgress('AI CSS Agent 输出结构异常，反馈模型缩短并重交 CSS 分片…');
            result = await complete({ phase: 'css', history, step, signal, instruction: recoveryInstruction, outputMaxTokens: CSS_RECOVERY_OUTPUT_MAX_TOKENS });
            lastModelResult = result;
            return result;
          },
        });
        if (parsed?.type === 'final') {
          if ((Number(getCssChunkCount()) || 0) >= REQUIRED_CSS_CHUNKS) return validateAgentEnvelope(parsed, { maxRequests: 1 });
          return validateAgentEnvelope(invalidCssContinuationRequest(`tr_css_continue_${step + 1}`), { maxRequests: 1 });
        }
        if (parsed?.type === 'tool_requests') {
          const request = normalizeToolRequest(parsed.requests?.[0], { fallbackReason: '执行 CSS 生成工具调用' });
          if (!request || ![PROJECT_READ, PROJECT_WRITE].includes(request.capability)) return validateAgentEnvelope(invalidCssContinuationRequest(`tr_css_continue_${step + 1}`), { maxRequests: 1 });
          if (request.capability === PROJECT_READ) { sourceRead = true; markSourceRead(); }
          if (request.capability === PROJECT_WRITE) {
            const mode = String(request.arguments?.mode || '');
            if (!['set_head', 'append_head_css'].includes(mode)) return validateAgentEnvelope(invalidCssContinuationRequest(`tr_css_mode_${step + 1}`), { maxRequests: 1 });
            request.arguments = { ...(request.arguments || {}), resourceId: 'project:current', path: 'ai-beautified.html' };
          }
          return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
        }
        if ((Number(getCssChunkCount()) || 0) < REQUIRED_CSS_CHUNKS) return validateAgentEnvelope(invalidCssContinuationRequest(`tr_css_continue_${step + 1}`), { maxRequests: 1 });
        return validateAgentEnvelope({ type: 'final', assistantReply: 'CSS 阶段已完成' }, { maxRequests: 1 });
      },
    });
    return { ...agent, sourceRead, lastModelResult };
  };

  const runPageAgent = async () => {
    onPhaseChange('pages');
    let sourceRead = false;
    let lastModelResult = null;
    const agent = await runConversationAgent({
      entryPoint: 'social-card-ai-visual-page-generation',
      registry,
      catalog: generationCatalog,
      messages: [{ role: 'system', protected: true, content: `${agentSystem}${pageStageOverride(maxPages)}` }, ...baseMessages],
      store,
      budget: { maxModelSteps: Math.max(12, maxPages + 6), maxToolCalls: Math.max(12, maxPages + 6), maxParallelToolCalls: 1, maxToolResultChars: 80000, maxTotalToolResultChars: 180000, maxHistoryChars: 180000, timeoutMs: 300000 },
      toolContext: toolContextFor('pages'),
      resolveArguments,
      sanitizeToolResult,
      onEvent: (event) => {
        if (event?.type === 'tool.completed' && event?.capability === PROJECT_READ) { sourceRead = true; markSourceRead(); }
        if (event?.type === 'tool.completed' && event?.capability === PROJECT_WRITE) onProgress('AI 页面 Agent 已写入视觉 HTML…');
      },
      modelStep: async ({ messages: history, step, signal }) => {
        const currentPageCount = Number(getPageCount()) || 0;
        if (!sourceRead) return validateAgentEnvelope(readRequest(`tr_pages_read_${step + 1}`, pageFiles), { maxRequests: 1 });
        let result = await complete({ phase: 'page', history, step, signal, instruction: pageGenerationInstruction(currentPageCount, maxPages) });
        lastModelResult = result;
        const parsed = await parseModelJsonWithRepair(result, {
          store,
          label: 'AI 页面 Agent',
          repair: async (error) => {
            const recoveryInstruction = `上一条响应 JSON 不完整（${error.code || 'JSON_FORMAT_ERROR'}）。只返回一个 append_body 工具请求；content 必须是 P${currentPageCount + 1} 的完整 .page section，控制在 6000 字符以内；不要返回 CSS 或解释。`;
            onProgress('AI 页面 Agent 输出结构异常，反馈模型缩短并重交当前页面…');
            result = await complete({ phase: 'page', history, step, signal, instruction: recoveryInstruction });
            lastModelResult = result;
            return result;
          },
        });
        if (parsed?.type === 'final') {
          if ((Number(getPageCount()) || 0) >= maxPages) return validateAgentEnvelope(parsed, { maxRequests: 1 });
          return validateAgentEnvelope(continueRequest(`tr_page_continue_${step + 1}`, (Number(getPageCount()) || 0) + 1, '页面尚未完成，不能结束页面阶段'), { maxRequests: 1 });
        }
        if (parsed?.type === 'tool_requests') {
          const request = normalizeToolRequest(parsed.requests?.[0], { fallbackReason: '执行页面生成工具调用' });
          if (!request || ![PROJECT_READ, PROJECT_WRITE].includes(request.capability)) return validateAgentEnvelope(continueRequest(`tr_page_continue_${step + 1}`, (Number(getPageCount()) || 0) + 1), { maxRequests: 1 });
          if (request.capability === PROJECT_READ) { sourceRead = true; markSourceRead(); }
          if (request.capability === PROJECT_WRITE) {
            if (String(request.arguments?.mode || '') !== 'append_body') return validateAgentEnvelope(continueRequest(`tr_page_mode_${step + 1}`, (Number(getPageCount()) || 0) + 1, '页面阶段只能使用 append_body'), { maxRequests: 1 });
            request.arguments = { ...(request.arguments || {}), resourceId: 'project:current', path: 'ai-beautified.html' };
            if ((Number(getPageCount()) || 0) >= maxPages) return validateAgentEnvelope({ type: 'final', assistantReply: '页面阶段已完成' }, { maxRequests: 1 });
          }
          return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
        }
        if ((Number(getPageCount()) || 0) < maxPages) return validateAgentEnvelope(continueRequest(`tr_page_continue_${step + 1}`, (Number(getPageCount()) || 0) + 1), { maxRequests: 1 });
        return validateAgentEnvelope({ type: 'final', assistantReply: '页面阶段已完成' }, { maxRequests: 1 });
      },
    });
    return { ...agent, sourceRead, lastModelResult };
  };

  const cssAgent = await runCssAgent();
  if (cssAgent.type !== 'final' || (Number(getCssChunkCount()) || 0) < REQUIRED_CSS_CHUNKS) {
    onPhaseChange('idle');
    return { ...cssAgent, sourceRead: cssAgent.sourceRead, lastModelResult: cssAgent.lastModelResult, cssChunkCount: Number(getCssChunkCount()) || 0, pageCount: Number(getPageCount()) || 0, allowedCapabilities, catalog: generationCatalog, agentRunIds: [cssAgent.agentRunId].filter(Boolean) };
  }
  const pageAgent = await runPageAgent();
  onPhaseChange('idle');
  return {
    ...pageAgent,
    agentRunId: pageAgent.agentRunId || cssAgent.agentRunId,
    agentRunIds: [cssAgent.agentRunId, pageAgent.agentRunId].filter(Boolean),
    modelSteps: (cssAgent.modelSteps || 0) + (pageAgent.modelSteps || 0),
    toolCalls: (cssAgent.toolCalls || 0) + (pageAgent.toolCalls || 0),
    sourceRead: Boolean(cssAgent.sourceRead && pageAgent.sourceRead),
    lastModelResult: pageAgent.lastModelResult || cssAgent.lastModelResult,
    cssChunkCount: Number(getCssChunkCount()) || 0,
    pageCount: Number(getPageCount()) || 0,
    allowedCapabilities,
    catalog: generationCatalog,
  };
}
