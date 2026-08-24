export function testConfigurationResolver(_name, provider) {
  const apiKey = provider.apiKey || (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : '');
  return { configured: Boolean(apiKey), values: { apiKey } };
}
