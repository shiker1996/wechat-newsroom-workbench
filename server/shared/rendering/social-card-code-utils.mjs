/**
 * Parse a complete Markdown fenced-code value used inside a Social card fact.
 *
 * The repository fact extractor may receive either a normal multi-line fence
 * or a compact one-line fence after upstream normalization.  Only a complete
 * fenced value is converted; inline backticks inside prose remain untouched.
 */
export function parseSocialCardFencedCode(value = '') {
  const raw = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!raw.startsWith('```') || !raw.endsWith('```')) return null;
  const multiline = raw.match(/^```([^\n`]*)\n([\s\S]*?)\n?```$/u);
  const compact = multiline ? null : raw.match(/^```([^\s`]*)\s+([\s\S]*?)\s*```$/u);
  const match = multiline || compact;
  if (!match) return null;
  const content = String(match[2] || '').replace(/^\n+|\n+$/gu, '').trim();
  return content ? { language: String(match[1] || '').trim(), content } : null;
}

export function normalizeSocialCardCode(value = '') {
  return parseSocialCardFencedCode(value)?.content || String(value ?? '').trim();
}
