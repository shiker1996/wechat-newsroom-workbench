const VISUAL_FENCE = /```(?:mermaid|echarts)\b[\s\S]*?```/gi;

export function markdownVisibleChars(markdown) {
  return String(markdown || '')
    .replace(VISUAL_FENCE, '')
    .replace(/^```[^\r\n]*$/gm, '')
    .replace(/^#.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#-]/g, '')
    .replace(/\s/g, '')
    .length;
}
