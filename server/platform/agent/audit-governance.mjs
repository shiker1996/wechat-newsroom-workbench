import crypto from 'node:crypto';

export const AUDIT_TEXT_LIMITS = Object.freeze({
  output: 20000,
  reasoning: 12000,
  toolResult: 4000,
});

const SECRET_PATTERNS = [
  /(authorization\s*[:=]\s*bearer\s+)[^\s,;"'}]+/gi,
  /((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;"'}]+/gi,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /([?&](?:api[_-]?key|token|secret|password)=)[^&\s]+/gi,
];

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function redactAuditText(value) {
  if (value == null) return '';
  let text = String(value);
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '$1[REDACTED]');
  return text;
}

export function summarizeAuditText(value, maxChars) {
  const redacted = redactAuditText(value);
  const limit = Math.max(256, Number(maxChars) || 12000);
  const truncated = redacted.length > limit;
  return {
    text: truncated ? `${redacted.slice(0, limit)}…` : redacted,
    hash: hash(redacted),
    originalChars: redacted.length,
    truncated,
  };
}

export function governModelAuditText({ output = '', reasoning = '' } = {}) {
  return {
    output: summarizeAuditText(output, AUDIT_TEXT_LIMITS.output),
    reasoning: summarizeAuditText(reasoning, AUDIT_TEXT_LIMITS.reasoning),
  };
}
