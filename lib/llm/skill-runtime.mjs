import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function skillRoots(workspaceRoot) {
  return [
    process.env.CODEX_SKILLS_ROOT,
    path.join(workspaceRoot, 'skills'),
  ].filter(Boolean);
}

function readSkill(root, name) {
  const filePath = path.join(root, name, 'SKILL.md');
  if (!fs.existsSync(filePath)) return null;
  return { name, filePath, content: fs.readFileSync(filePath, 'utf8') };
}

function collectMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdown(filePath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(filePath);
  }
  return files.sort();
}

export function loadSkillBundle({ workspaceRoot, skillName }) {
  for (const root of skillRoots(workspaceRoot)) {
    const skill = readSkill(root, skillName);
    if (!skill) continue;
    const skillDir = path.join(root, skillName);
    const rootFiles = fs.readdirSync(skillDir, { withFileTypes:true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name.toLowerCase() !== 'skill.md')
      .map((entry) => path.join(skillDir, entry.name))
      .sort();
    const referenceFiles = collectMarkdown(path.join(skillDir, 'references'));
    const parts = [`## SKILL: ${skillName}\n\n${skill.content}`];
    for (const filePath of [...rootFiles, ...referenceFiles]) parts.push(`## REFERENCE: ${path.relative(skillDir, filePath)}\n\n${fs.readFileSync(filePath, 'utf8')}`);
    const prompt = parts.join('\n\n---\n\n');
    return { root, skillName, prompt, files:[skill.filePath, ...rootFiles, ...referenceFiles], hash:crypto.createHash('sha256').update(prompt).digest('hex'), fallback:false };
  }
  return { skillName, prompt:'', files:[], hash:'', fallback:true };
}

export function loadArticleSkillBundle({ workspaceRoot, writerSkill }) {
  for (const root of skillRoots(workspaceRoot)) {
    const orchestrator = readSkill(root, 'wechat-mp-topic-to-article');
    const writer = readSkill(root, writerSkill);
    if (!writer) continue;
    const referenceFiles = orchestrator ? collectMarkdown(path.join(root, 'wechat-mp-topic-to-article', 'references')) : [];
    const parts = [orchestrator, writer].filter(Boolean).map((item) => `## SKILL: ${item.name}\n\n${item.content}`);
    for (const filePath of referenceFiles) parts.push(`## REFERENCE: ${path.relative(path.join(root, 'wechat-mp-topic-to-article'), filePath)}\n\n${fs.readFileSync(filePath, 'utf8')}`);
    const prompt = parts.join('\n\n---\n\n');
    return {
      root,
      writerSkill,
      prompt,
      files: [orchestrator?.filePath, writer.filePath, ...referenceFiles].filter(Boolean),
      hash: crypto.createHash('sha256').update(prompt).digest('hex'),
      fallback: false,
    };
  }
  return { writerSkill, prompt: '', files: [], hash: '', fallback: true };
}
