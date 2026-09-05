import { CONVERSATION_AGENT_SCHEMA_VERSION, CONVERSATION_AGENT_STREAM_EVENTS } from './contracts.mjs';

// Version the protocol description without changing the existing NDJSON wire shape.
export const AGENT_EVENT_PROTOCOL = Object.freeze({
  version: CONVERSATION_AGENT_SCHEMA_VERSION,
  transport: 'ndjson',
  events: CONVERSATION_AGENT_STREAM_EVENTS,
});

/** @typedef {{type: string, agentRunId?: string}} AgentEvent */
export function agentEvent(type,payload={}){return Object.freeze({type,...payload});}
