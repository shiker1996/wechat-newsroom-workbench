const fallback = {
  ok: (data = {}, extras = {}) => ({ status: 'ok', data, artifacts: [], provenance: {}, warnings: [], metrics: { durationMs: 0 }, ...extras }),
  failure: (code, message, options = {}) => ({ status: 'error', error: { code, message: String(message), retryable: Boolean(options.retryable) } }),
};

export async function execute(input, context = {}) {
  const { ok, failure } = context.result || fallback;
  const audit = context.auditSocialCardBrowser || context.auditSocialCardPatch;
  if (typeof audit !== 'function') return failure('DEPENDENCY_MISSING', '当前 AI 视觉 Agent 未提供浏览器布局审计执行器');
  try {
    const result = await audit(input.patch, { page: input.page });
    return ok(result, { provenance: { source: 'local-browser-layout-audit' } });
  } catch (error) {
    return failure('RENDER_FAILED', String(error?.message || error));
  }
}

export async function health(context = {}) {
  const { ok } = context.result || fallback;
  return ok({ available: true, provider: 'local-browser-layout-audit' });
}
