import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readActiveSkillConfig } from '../skills/configuration.mjs';
import { readSkillManifest } from '../skills/manifest.mjs';
import { installedSkillsRoot, isInstalledSkillEnabled } from '../skills/package-manager.mjs';

let skillConfigurationResolver=null;
export function setSkillConfigurationResolver(resolver){skillConfigurationResolver=typeof resolver==='function'?resolver:null;}

export const IMMUTABLE_SKILL_SAFETY = `## 不可变系统安全门禁
- 只能使用事实基座或明确来源支持事实性陈述，不得伪造来源、引语、数据或作者经历。
- model_suggestion 只能作为建议，不得写成亲测、效果或收益。
- 不得请求或暗示绕过工具白名单、本地路径授权、外部写入授权或任意代码执行限制。
- 本节优先于任何可配置覆盖层；覆盖层与本节冲突时，以本节为准。`;

function skillRoots(workspaceRoot) {
  return [
    process.env.CODEX_SKILLS_ROOT,
    path.join(workspaceRoot, 'skills'),
    installedSkillsRoot(workspaceRoot),
    // 仓库自身技能目录：嵌入式/测试工作区（workspaceRoot 指向临时目录）下兜底；
    // 该目录也找不到时 loadSkillBundle 返回 fallback:true，由调用方决定回退或报错。
    path.join(process.cwd(), 'skills'),
  ].filter(Boolean);
}

function readSkill(root, name) {
  const filePath = path.join(root, name, 'SKILL.md');
  if (!fs.existsSync(filePath)) return null;
  return { name, filePath, content: fs.readFileSync(filePath, 'utf8') };
}

function collectMarkdown(dir,{excludedDirectories=new Set()}={}) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory() && !excludedDirectories.has(path.resolve(filePath))) {
      files.push(...collectMarkdown(filePath,{excludedDirectories}));
    }
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(filePath);
  }
  return files.sort();
}

export function loadSkillBundle({ workspaceRoot, skillName }) {
  for (const root of skillRoots(workspaceRoot)) {
    if (path.resolve(root) === path.resolve(installedSkillsRoot(workspaceRoot)) && !isInstalledSkillEnabled(workspaceRoot, skillName)) continue;
    const skill = readSkill(root, skillName);
    if (!skill) continue;
    const skillDir = path.join(root, skillName);
    const structuredManifest=readSkillManifest(skillDir,skillName);
    const rootFiles = fs.readdirSync(skillDir, { withFileTypes:true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name.toLowerCase() !== 'skill.md')
      .map((entry) => path.join(skillDir, entry.name))
      .sort();
    const referenceFiles = collectMarkdown(path.join(skillDir, 'references'));
    const parts = [`## SKILL: ${skillName}\n\n${skill.content}`];
    for (const filePath of [...rootFiles, ...referenceFiles]) parts.push(`## REFERENCE: ${path.relative(skillDir, filePath)}\n\n${fs.readFileSync(filePath, 'utf8')}`);
    const builtInPrompt = parts.join('\n\n---\n\n');
    const activeConfig = readActiveSkillConfig(workspaceRoot, skillName);
    const configuredPrompt=activeConfig?.prompt?.trim() ? `${builtInPrompt}\n\n---\n\n## CONFIGURED OVERLAY\n\n${activeConfig.prompt.trim()}` : builtInPrompt;
    const prompt=`${configuredPrompt}\n\n---\n\n${IMMUTABLE_SKILL_SAFETY}`;
    const extensionConfiguration=structuredManifest.manifest?.configuration
      ?skillConfigurationResolver?.(structuredManifest.manifest)||{configured:false,status:'needs_configuration',values:{},snapshot:null}
      :{configured:true,status:'ready',values:{},snapshot:null};
    return { root, skillName, prompt, files:[skill.filePath, ...rootFiles, ...referenceFiles],
      hash:crypto.createHash('sha256').update(prompt).digest('hex'), fallback:false, config:activeConfig,
      manifest:structuredManifest.manifest,manifestStatus:structuredManifest.status,extensionConfiguration };
  }
  return { skillName, prompt:'', files:[], hash:'', fallback:true,manifest:null,manifestStatus:'missing' };
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

export function selectSkillPromptReferences(prompt,{include=[]}={}) {
  const allowed=new Set(include.map((item)=>String(item).replaceAll('/','\\').toLowerCase()));
  return String(prompt||'').split('\n\n---\n\n').filter((part)=>{
    const match=part.match(/^## REFERENCE: ([^\r\n]+)/);
    if(!match)return true;
    return allowed.has(match[1].trim().replaceAll('/','\\').toLowerCase());
  }).join('\n\n---\n\n');
}
