import { runConversationAgent } from '../../../platform/agent/conversation-agent.mjs';
import { normalizeToolRequest, validateAgentEnvelope } from '../../../platform/agent/tool-protocol.mjs';
import { parseModelJsonWithRepair } from '../../../platform/llm/model-json.mjs';

const PROJECT_WRITE = 'filesystem.project.write';
const BROWSER_INSPECT = 'content.social_card.browser_inspect';

function writeRequest(requestId, page, reason = '修复当前问题页') {
  return {
    type: 'tool_requests',
    assistant_note: `提交 P${page} 的单页修复`,
    requests: [{
      requestId,
      capability: PROJECT_WRITE,
      arguments: { resourceId: 'project:current', path: 'ai-beautified.html', mode: 'replace_page_with_styles', page, page_html: '', scoped_css: '' },
      reason,
    }],
  };
}

export function filterAiVisualRepairCatalog(catalog = []) {
  return (Array.isArray(catalog) ? catalog : []).filter((item) => [PROJECT_WRITE, BROWSER_INSPECT].includes(item.capability));
}

export async function runSocialCardAiVisualRepairAgent({
  gateway,
  store,
  batchId,
  candidateId,
  provider,
  registry,
  catalog,
  agentSystem,
  repairRequest,
  page,
  toolHandlers,
  resolveArguments,
  sanitizeToolResult,
  toolContext = {},
  maxOutputTokens = 5000,
  onProgress = () => {},
} = {}) {
  const targetPage = Number(page);
  if (!Number.isInteger(targetPage) || targetPage < 1) throw new TypeError('单页修复 Agent 缺少有效目标页');
  const repairCatalog = filterAiVisualRepairCatalog(catalog);
  const allowedCapabilities = [PROJECT_WRITE, BROWSER_INSPECT];
  const messages = [
    { role: 'system', protected: true, content: `${agentSystem}\n\n## 当前 Agent 阶段：单页修复\n你只能修复 P${targetPage}。输入包含当前页 HTML、当前全局 CSS、该页内容计划、浏览器诊断和具体修改要求。只能调用 filesystem.project.write 和 content.social_card.browser_inspect；不得调用 browser_audit、读取其他文件、改变页数、修改其他页面或输出完整 HTML。需要更多实际尺寸时可先 browser_inspect。提交修复时必须使用 replace_page_with_styles，并同时返回完整 page_html 与 scoped_css；scoped_css 只写当前页覆盖规则，不含 style 标签、html/body/:root、外链或 @import，程序会自动加页面作用域。HTML 不需要变化时仍要原样完整返回，但 scoped_css 必须产生有效变化；不得只修改 reason。所有字符串必须是合法 JSON：双引号写成 \\\"，反斜杠写成 \\\\，换行写成 \\n；CSS 的 {}、:、; 不需要转义；响应最后必须闭合外层对象 }。修复完成后只返回简短 final。` },
    { role: 'system', protected: true, content: `页面 CSS 兼容性要求：scoped_css 不得使用 CSS 作用域 at-rule；只提交当前页规则，程序会把它转换为 [data-ai-page="${targetPage}"] ... 页面属性 CSS。` },
    { role: 'user', protected: true, content: JSON.stringify({ repair_request: { ...repairRequest, page: targetPage } }) },
  ];
  let writeCompleted = false;
  let lastModelResult = null;
  const agent = await runConversationAgent({
    entryPoint: 'social-card-ai-visual-repair',
    registry,
    catalog: repairCatalog,
    messages,
    store,
    budget: { maxModelSteps: 6, maxToolCalls: 5, maxParallelToolCalls: 1, maxToolResultChars: 16000, maxTotalToolResultChars: 40000, maxHistoryChars: 60000, timeoutMs: 120000 },
    toolContext: { ...toolContext, skillId: 'social-card-ai-visual-generator', allowedCapabilities, toolHandlers: { [PROJECT_WRITE]: toolHandlers?.[PROJECT_WRITE], [BROWSER_INSPECT]: toolHandlers?.[BROWSER_INSPECT] } },
    resolveArguments,
    sanitizeToolResult,
    onEvent: (event) => {
      if (event?.type === 'tool.completed' && event?.capability === PROJECT_WRITE) {
        writeCompleted = true;
        onProgress(`AI 单页修复 Agent 已提交 P${targetPage} 修复…`);
      }
      if (event?.type === 'tool.completed' && event?.capability === BROWSER_INSPECT) onProgress(`AI 单页修复 Agent 已查看 P${targetPage} 真实布局…`);
    },
    modelStep: async ({ messages: history, step, signal }) => {
      let result = await gateway.complete({
        provider,
        purpose: 'social-card-ai-visual-repair-agent',
        batchId,
        candidateId,
        thinking: false,
        temperature: step ? 0.25 : 0.2,
        maxOutputTokens: Math.min(5000, maxOutputTokens),
        adaptiveOutput: true,
        jsonMode: true,
        signal,
        messages: history,
      });
      lastModelResult = result;
      const parsed = await parseModelJsonWithRepair(result, {
        store,
        label: `AI P${targetPage} 修复 Agent`,
        repair: async (error) => {
          onProgress(`AI P${targetPage} 修复 Agent 输出结构异常，反馈模型重交当前页 HTML 与局部 CSS…`);
          result = await gateway.complete({
            provider,
            purpose: 'social-card-ai-visual-repair-agent',
            batchId,
            candidateId,
            thinking: false,
            temperature: 0.1,
            maxOutputTokens: Math.min(4000, maxOutputTokens),
            adaptiveOutput: true,
            jsonMode: true,
            signal,
            messages: [...history, { role: 'user', protected: true, content: `上一条 JSON 不完整（${error.code || 'JSON_FORMAT_ERROR'}）。只重新提交一个 replace_page_with_styles 工具请求，包含 P${targetPage} 的完整 page_html 和不超过 5000 字符的 scoped_css；不要解释，确保 JSON 完整闭合。` }],
          });
          lastModelResult = result;
          return result;
        },
      });
      if (parsed?.type === 'final') return validateAgentEnvelope(parsed, { maxRequests: 1 });
      if (parsed?.type === 'tool_requests' && Array.isArray(parsed.requests) && parsed.requests.length) {
        const request = normalizeToolRequest(parsed.requests[0], { fallbackReason: `修复 P${targetPage}` });
        if (request.capability === BROWSER_INSPECT) {
          request.arguments = { ...(request.arguments || {}), resourceId: 'project:current', path: 'ai-beautified.html', page: targetPage };
          return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
        }
        if (request.capability === PROJECT_WRITE) {
          const source = request.arguments || {};
          const legacyPage = Array.isArray(source.pages) ? source.pages[0] || {} : {};
          request.arguments = {
            resourceId: 'project:current',
            path: 'ai-beautified.html',
            mode: 'replace_page_with_styles',
            page: targetPage,
            page_html: String(source.page_html || legacyPage.page_html || legacyPage.html || ''),
            scoped_css: String(source.scoped_css || ''),
          };
          return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
        }
      }
      if (writeCompleted) return validateAgentEnvelope({ type: 'final', assistantReply: `P${targetPage} 修复已提交` }, { maxRequests: 1 });
      return validateAgentEnvelope(writeRequest(`tr_repair_write_${targetPage}_${step + 1}`, targetPage, `提交 P${targetPage} 的页面修复`), { maxRequests: 1 });
    },
  });
  return { ...agent, writeCompleted, lastModelResult, page: targetPage, catalog: repairCatalog, allowedCapabilities };
}
