import path from 'node:path';
import { readLocalProjectImplementation } from '../../../plugins/local-project-reader/implementation.mjs';
import { createStoreExecutionLogger } from '../tools/execution-log.mjs';
import { executeInformationCapabilitySlot } from '../tools/capability-slots.mjs';

// capability-call: filesystem.project.read

// 兼容旧的同步入口；新代码应使用 readLocalProjectViaRegistry。
export const readLocalProject = readLocalProjectImplementation;
export { extractLocalProjectPath } from '../../../plugins/local-project-reader/implementation.mjs';

export async function readLocalProjectViaRegistry(inputPath, options = {}) {
  const { toolContext = {}, ...readerOptions } = options;
  const root = path.resolve(String(inputPath || '').trim());
  const result = await executeInformationCapabilitySlot('local-project', { path:root, options:readerOptions }, {
    workspaceRoot:toolContext.workspaceRoot,
    allowedRoots:[root],
    allowedCapabilities:toolContext.allowedCapabilities,
    executionLog:createStoreExecutionLogger(toolContext.store,toolContext),
  });
  if (result.status === 'error') {
    const error = new Error(result.error.message);
    error.code = result.error.code;
    throw error;
  }
  return result.data;
}
