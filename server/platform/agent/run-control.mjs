const activeRuns = new Map();

export function registerAgentRun(agentRunId, controller) {
  if (!agentRunId || !controller?.abort) return;
  activeRuns.set(String(agentRunId), controller);
}

export function unregisterAgentRun(agentRunId) {
  activeRuns.delete(String(agentRunId));
}

export function cancelAgentRun(agentRunId, reason = 'Agent 已取消') {
  const controller = activeRuns.get(String(agentRunId));
  if (!controller) return false;
  if (!controller.signal.aborted) controller.abort(Object.assign(new Error(reason), { code: 'AGENT_ABORTED' }));
  return true;
}

export function isAgentRunActive(agentRunId) {
  return activeRuns.has(String(agentRunId));
}
