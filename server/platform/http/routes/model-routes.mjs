import { deleteModelProvider, saveModelProvider } from '../../integrations/model-provider-settings.mjs';
import { clearRemoteCredential } from '../../tools/remote-credentials.mjs';

export async function handleModelRoutes(context) {
  const { request, response, pathname, root, config, store, models, body, json } = context;

  if (request.method === 'GET' && pathname === '/api/models') {
    json(response, 200, { ...models.listProviders(), calls: store.listModelCalls(50) });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/models/config') {
    const id = saveModelProvider(root, config, await body(request));
    json(response, 200, { saved: true, id, ...models.listProviders() });
    return true;
  }
  const deleteMatch = pathname.match(/^\/api\/models\/config\/([^/]+)$/);
  if (request.method === 'DELETE' && deleteMatch) {
    const id = deleteModelProvider(root, config, decodeURIComponent(deleteMatch[1]));
    // 统一删除：同时清掉扩展配置与远程凭据，避免残留
    store?.repositories?.extensionSettings?.remove?.('model-provider', id);
    try { clearRemoteCredential(root, id, `model-provider-${id}`); } catch { /* 无凭据时忽略 */ }
    json(response, 200, { deleted: true, id, ...models.listProviders() });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/models/test') {
    const input = await body(request);
    const result = await models.complete({
      provider: input.provider,
      purpose: 'connection-test',
      maxOutputTokens: 16,
      messages: [{ role: 'user', content: '只回复 OK', protected: true }],
    });
    json(response, 200, {
      provider: result.provider,
      model: result.model,
      reply: result.content,
      latencyTokens: result.usage,
      compressed: result.context.compressed,
    });
    return true;
  }
  return false;
}
