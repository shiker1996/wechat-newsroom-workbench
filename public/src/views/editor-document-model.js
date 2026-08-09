export function visibleChars(markdown) {
  return String(markdown || '')
    .replace(/```(?:mermaid|echarts)\b[\s\S]*?```/gi, '')
    .replace(/^```[^\r\n]*$/gm, '')
    .replace(/^#.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[-#>]\s?/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s/g, '')
    .length;
}

export function markdownHeadings(markdown) {
  const headings = [];
  let offset = 0;
  let inFence = false;
  for (const line of String(markdown || '').split('\n')) {
    if (/^```/.test(line.trim())) inFence = !inFence;
    const match = !inFence && /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (match) headings.push({ level: match[1].length, text: match[2].replace(/[*_`[\]]/g, ''), offset });
    offset += line.length + 1;
  }
  return headings;
}

export function qualityIssues(markdown) {
  const text = String(markdown || '');
  const issues = [];
  const headings = markdownHeadings(text);
  if (text.trim() && !headings.some((item) => item.level === 1)) issues.push({ type: '结构', message: '缺少一级标题', offset: 0 });
  const seen = new Map();
  let previousLevel = 0;
  headings.forEach((heading, index) => {
    const key = heading.text.trim().toLocaleLowerCase();
    if (seen.has(key)) issues.push({ type: '结构', message: `标题重复：${heading.text}`, offset: heading.offset });
    else seen.set(key, heading.offset);
    if (previousLevel && heading.level > previousLevel + 1) issues.push({ type: '结构', message: `标题层级从 H${previousLevel} 跳到 H${heading.level}`, offset: heading.offset });
    previousLevel = heading.level;
    if (heading.level >= 2) {
      const start = text.indexOf('\n', heading.offset);
      const end = headings[index + 1]?.offset ?? text.length;
      if (visibleChars(text.slice(start < 0 ? end : start + 1, end)) < 10) issues.push({ type: '空章节', message: `章节“${heading.text}”缺少正文`, offset: heading.offset });
    }
  });
  let searchOffset = 0;
  text.split(/\n\s*\n/).forEach((paragraph) => {
    const offset = text.indexOf(paragraph, searchOffset);
    searchOffset = Math.max(searchOffset, offset + paragraph.length);
    if (!/^#{1,6}\s/m.test(paragraph) && visibleChars(paragraph) > 300) issues.push({ type: '可读性', message: `段落过长（${visibleChars(paragraph)} 字），建议拆分`, offset: Math.max(0, offset) });
  });
  if (visibleChars(text) >= 300 && !/https?:\/\/\S+/.test(text)) issues.push({ type: '来源', message: '正文尚未包含任何来源链接', offset: 0 });
  return issues;
}

export function writingStatistics(markdown) {
  const text = String(markdown || '');
  const chars = visibleChars(text);
  const paragraphs = text.split(/\n\s*\n/).filter((block) => {
    const content = block.replace(/^#{1,6}\s+.*$/gm, '').replace(/```[\s\S]*?```/g, '').trim();
    return visibleChars(content) >= 10;
  }).length;
  const headings = markdownHeadings(text).filter((item) => item.level >= 2);
  let complete = 0;
  for (let index = 0; index < headings.length; index += 1) {
    const start = text.indexOf('\n', headings[index].offset);
    const end = headings[index + 1]?.offset ?? text.length;
    if (visibleChars(text.slice(start < 0 ? end : start + 1, end)) >= 50) complete += 1;
  }
  return { chars, paragraphs, minutes: chars ? Math.max(1, Math.ceil(chars / 400)) : 0, sections: headings.length, complete };
}

export function lineDiff(oldText, newText) {
  const oldLines = String(oldText || '').split('\n');
  const newLines = String(newText || '').split('\n');
  const output = [];
  for (let index = 0; index < Math.max(oldLines.length, newLines.length); index += 1) {
    if (oldLines[index] === newLines[index]) output.push(`  ${oldLines[index] ?? ''}`);
    else {
      if (oldLines[index] !== undefined) output.push(`- ${oldLines[index]}`);
      if (newLines[index] !== undefined) output.push(`+ ${newLines[index]}`);
    }
  }
  return output.join('\n');
}
