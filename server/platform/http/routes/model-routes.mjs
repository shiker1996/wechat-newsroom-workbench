import { deleteModelProvider, saveModelProvider } from '../../integrations/model-provider-settings.mjs';

export async function handleModelRoutes(context) {
  const { request, response, pathname, root, config, store, models, body, json } = context;

  if (request.method === 'GET' && pathname === '/api/models') {
    json(response, 200, { ...models.listProviders(), calls: store.listModelCalls(150) });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/models/config') {
    const id = saveModelProvider(root, config, await body(request), { repository: store?.repositories?.extensionSettings });
    json(response, 200, { saved: true, id, ...models.listProviders() });
    return true;
  }
  const deleteMatch = pathname.match(/^\/api\/models\/config\/([^/]+)$/);
  if (request.method === 'DELETE' && deleteMatch) {
    const id = deleteModelProvider(root, config, decodeURIComponent(deleteMatch[1]), { repository: store?.repositories?.extensionSettings });
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
