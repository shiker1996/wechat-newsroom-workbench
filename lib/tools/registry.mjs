import { performance } from 'node:perf_hooks';
import { enforcePolicy } from './policy.mjs';
import { failure, validateInput, validateResult } from './schemas.mjs';
import { createExecutionRecord } from './execution-log.mjs';

function thrown(error) {
  const message = String(error?.message || error);
  if (/not found|未找到|Cannot find package/i.test(message)) return failure('DEPENDENCY_MISSING', message, { action:'运行环境检查或安装可选依赖' });
  if (/timeout/i.test(message)) return failure('TIMEOUT', message, { retryable:true });
  return failure('OUTPUT_INVALID', message);
}

export class ToolRegistry {
  #plugins = [];
  #settings = {};
  constructor({ settings = {} } = {}) { this.#settings=settings; }
  register(plugin) { this.#plugins.push(plugin); return this; }
  #state(manifest) {
    const configured=this.#settings[manifest.id]||{};
    return {
      enabled:typeof configured.enabled==='boolean'?configured.enabled:manifest.enabledByDefault!==false,
      priority:Number.isFinite(Number(configured.priority))?Number(configured.priority):Number(manifest.priority)||0,
    };
  }
  listPlugins() {
    return this.#plugins.map(({manifest})=>({...manifest,...this.#state(manifest)}))
      .sort((left,right)=>right.priority-left.priority||left.id.localeCompare(right.id));
  }
  listCapabilities({ includeDisabled = false } = {}) {
    return this.#plugins.flatMap(({ manifest }) => {
      const state=this.#state(manifest);
      if(!includeDisabled&&!state.enabled)return [];
      return manifest.capabilities.map((capability) => ({
        capability, plugin:manifest.id, version:manifest.version, riskLevel:manifest.riskLevel,
        enabled:state.enabled,priority:state.priority,
      }));
    });
  }
  resolve(capability, preferences = {}) {
    const choices = this.#plugins.filter(({ manifest }) => manifest.capabilities.includes(capability)&&this.#state(manifest).enabled)
      .sort((left,right)=>this.#state(right.manifest).priority-this.#state(left.manifest).priority
        ||left.manifest.id.localeCompare(right.manifest.id));
    return choices.find(({ manifest }) => manifest.id === preferences.plugin) || choices[0] || null;
  }
  async health(capability, preferences = {}) {
    const plugin = this.resolve(capability,preferences);
    if (!plugin) return failure('DEPENDENCY_MISSING', `没有能力实现：${capability}`);
    if (!plugin.adapter.health) return { status:'ok', data:{ available:true } };
    try {
      const result=await plugin.adapter.health();
      const invalid=validateResult(result);
      return invalid?failure('OUTPUT_INVALID',`健康检查结果无效：${invalid}`):result;
    } catch(error) {
      return thrown(error);
    }
  }
  async execute(capability, input = {}, context = {}, preferences = {}) {
    const started = performance.now();
    const startedAt = new Date().toISOString();
    const plugin = this.resolve(capability, preferences);
    const finish = (result, selected = plugin) => {
      if (result.status === 'ok') {
        result.metrics = { ...(result.metrics || {}), durationMs:Math.round(performance.now() - started) };
        result.provenance = { plugin:selected.manifest.id, version:selected.manifest.version, ...(result.provenance || {}) };
      }
      context.executionLog?.(createExecutionRecord({
        capability, plugin:selected?.manifest.id || null, version:selected?.manifest.version || null, input, result,
        startedAt, finishedAt:new Date().toISOString(), authorizedExternalWrite:context.authorizedExternalWrite,
      }));
      return result;
    };
    if (!plugin) return finish(failure('DEPENDENCY_MISSING', `没有能力实现：${capability}`), null);
    const invalid = validateInput(plugin.manifest.inputSchema, input);
    if (invalid) return finish(failure('INVALID_INPUT', invalid));
    const denied = enforcePolicy(plugin.manifest, input, context);
    if (denied) return finish(failure(denied.code, denied.message));
    try {
      const result = await plugin.adapter.execute(input, Object.freeze({ ...context, capability, pluginId:plugin.manifest.id }));
      const outputInvalid = validateResult(result, plugin.manifest.outputSchema);
      return finish(outputInvalid ? failure('OUTPUT_INVALID', outputInvalid) : result);
    } catch (error) {
      return finish(thrown(error));
    }
  }
}
