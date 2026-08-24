function messageText(message) {
  if (typeof message.content === 'string') return message.content;
  return JSON.stringify(message.content ?? '');
}

export function estimateTokens(messages) {
  let tokens = 0;
  for (const message of messages) {
    const text = messageText(message);
    const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
    const other = text.length - cjk;
    tokens += Math.ceil(cjk * 0.62 + other * 0.28) + 8;
  }
  return tokens;
}

export function contextBudget(provider, llmConfig, requestedOutputTokens) {
  const output = Math.min(Number(requestedOutputTokens || provider.maxOutputTokens), provider.maxOutputTokens);
  return Math.max(1024, provider.contextWindow - output - llmConfig.safetyReserveTokens);
}

export async function compactMessages(messages, options) {
  const budget = options.budget;
  const beforeTokens = estimateTokens(messages);
  if (beforeTokens <= budget) return { messages, beforeTokens, afterTokens: beforeTokens, compressed: false };

  const systems = messages.filter((item) => item.role === 'system');
  const protectedMessages = messages.filter((item) => item.role !== 'system' && item.protected === true);
  const compressible = messages.filter((item) => item.role !== 'system' && item.protected !== true);
  const recentCount = Math.max(2, options.recentMessageCount ?? 8);
  const recent = compressible.slice(-recentCount);
  const old = compressible.slice(0, -recent.length);
  if (!old.length) throw new Error(`上下文约 ${beforeTokens} tokens，超过安全预算 ${budget}；受保护内容不可截断`);

  const summary = await options.summarize(old);
  const summaryMessage = {
    role: 'system',
    content: `【历史上下文压缩摘要】\n${summary}`,
    protected: false,
  };
  let compacted = [...systems, summaryMessage, ...protectedMessages, ...recent]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  let afterTokens = estimateTokens(compacted);
  while (afterTokens > budget && recent.length > 2) {
    recent.shift();
    compacted = [...systems, summaryMessage, ...protectedMessages, ...recent];
    afterTokens = estimateTokens(compacted);
  }
  if (afterTokens > budget) throw new Error(`压缩后仍约 ${afterTokens} tokens，超过安全预算 ${budget}；请缩小资料范围`);
  return { messages: compacted, beforeTokens, afterTokens, compressed: true };
}

export const SUMMARY_SYSTEM_PROMPT = `你是编辑工作台的上下文压缩器。只压缩，不新增事实。输出结构化中文摘要，必须保留：
1. 已确认事实及其来源 URL/资料编号；
2. 作者明确观点、编辑决策和禁止写入项；
3. 尚未解决的问题、反证和适用边界；
4. 已完成动作和下一步。
不要把推测改写成事实，不要省略数字、专名、引用归属和风险提示。`;
