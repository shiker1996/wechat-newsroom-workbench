import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadSkillBundle } from '../llm/skill-runtime.mjs';
import { ownsRuntimePolicy } from './roles.mjs';
import { readSkillManifest } from './manifest.mjs';
import { normalizeSkillDefinition } from './runtime-definition.mjs';
import { auditSkillCapabilityReferences } from '../tools/dependency-baseline.mjs';
import { readSkillPackageCatalog, installedSkillsRoot } from './package-manager.mjs';

function metadata(content, fallbackName) {
  const block = String(content).match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const values = {};
  for (const line of block?.[1]?.split(/\r?\n/) || []) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.+)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return {
    name:values.name || fallbackName,
    description:values.description || '',
    version:values.version || 'builtin',
  };
}

export class SkillRegistry {
  constructor({ workspaceRoot }) { this.workspaceRoot = workspaceRoot; }
  list() {
    const root = path.join(this.workspaceRoot, 'skills');
    const builtIns=fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes:true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
      .map((entry)=>({entry,root,status:'enabled'})) : [];
    const installedRoot=installedSkillsRoot(this.workspaceRoot);
    const catalog=readSkillPackageCatalog(this.workspaceRoot);
    const installed=Object.values(catalog.packages)
      .filter((item)=>item.status!=='uninstalled'&&fs.existsSync(path.join(installedRoot,item.id,'SKILL.md')))
      .map((item)=>({entry:{name:item.id},root:installedRoot,status:item.status,item}));
    return [...builtIns,...installed]
      .map(({entry,root:skillRoot,status,item}) => {
        const bundle = status==='enabled' ? loadSkillBundle({ workspaceRoot:this.workspaceRoot, skillName:entry.name }) : {config:null,fallback:false,hash:'',files:[path.join(skillRoot,entry.name,'SKILL.md')]};
        const skillText = fs.readFileSync(path.join(skillRoot, entry.name, 'SKILL.md'), 'utf8');
        const meta = metadata(skillText, entry.name);
        const structured=readSkillManifest(path.join(skillRoot,entry.name),entry.name);
        const manifest=structured.manifest;
        // 权威源裁定（设计文档 §4.4）：Manifest 的 capability 声明与能力目录、agent 消费者登记做一致性校验，
        // 阶段 1 以 warning 呈现，不改变 manifestStatus 与启用状态
        const referenceIssues=manifest?auditSkillCapabilityReferences(this.workspaceRoot,{skillId:entry.name,entryPoints:manifest.entryPoints||[],capabilities:[...(manifest.requiredCapabilities||[]),...(manifest.optionalCapabilities||[])]}):[];
        const manifestIssues=[...structured.issues,...referenceIssues];
        return {
          id:entry.name, name:manifest?.name || meta.name, description:meta.description,
          version:bundle.config?.version ? String(bundle.config.version) : meta.version,
          packageVersion:manifest?.version || 'legacy',
          kind:manifest?.kind || 'stage',
          runtimeKind:manifest?.runtimeKind || 'stage-skill',
          entryPoints:manifest?.entryPoints || [],
          contentTypes:manifest?.contentTypes || [],
          inputContract:manifest?.inputContract || '',
          outputContract:manifest?.outputContract || '',
          requiredCapabilities:manifest?.requiredCapabilities || [],
          optionalCapabilities:manifest?.optionalCapabilities || [],
          compatibleApp:manifest?.compatibleApp || '',
          source:manifest?.source || {type:'builtin',url:''},
          configuration:manifest?.configuration || null,
          manifestStatus:structured.status,
          manifestIssues,
          manifestPath:path.relative(this.workspaceRoot,structured.filePath).replaceAll('\\','/'),
          configured:Boolean(bundle.config),configHash:bundle.config?.configHash || '',
          enabled:status==='enabled'&&structured.status!=='invalid',
          status,
          thirdParty:Boolean(item),
          runtimePolicyOwner:['writer','typesetter'].includes(manifest?.kind)||ownsRuntimePolicy(entry.name),
          fallback:bundle.fallback, promptHash:`sha256:${bundle.hash}`,
          fileCount:bundle.files.length,
          files:bundle.files.map((file) => path.relative(this.workspaceRoot, file).replaceAll('\\', '/')),
        };
      }).sort((a, b) => a.id.localeCompare(b.id));
  }
  get(id) { return this.list().find((item) => item.id === id) || null; }
}

export function createGenerationSnapshot({ skillBundles, tools = [], provider, model, purpose, selection = null, stageModels = {}, stageModelsResolved = {} }) {
  const skills = skillBundles.map((bundle) => ({
    id:bundle.skillName || bundle.writerSkill,
    version:bundle.config?.version || 'builtin',
    configHash:bundle.config?.configHash || '',
    promptHash:`sha256:${bundle.hash || crypto.createHash('sha256').update(bundle.prompt || '').digest('hex')}`,
    prompt:bundle.prompt || '',
    config:bundle.config || null,
    extensionConfiguration:bundle.extensionConfiguration?.snapshot || null,
    packageVersion:bundle.manifest?.version || 'legacy',
    kind:bundle.manifest?.kind || 'stage',
    definition:bundle.definition ? structuredClone(bundle.definition) : normalizeSkillDefinition(bundle.manifest || {}, { id:bundle.skillName || bundle.writerSkill }),
    source:bundle.manifest?.source || {type:'builtin',url:''},
    files:(bundle.files || []).map((file) => String(file).replaceAll('\\', '/')),
    fallback:Boolean(bundle.fallback),
  }));
  const capabilityAuthorization={mode:'allow-list',capabilities:[...new Set(tools.map((item)=>item.capability))].sort()};
  const capabilityRoutes=Object.values(tools.reduce((all,item)=>{const route=all[item.capability]||={capability:item.capability,candidates:[]};route.candidates.push({plugin:item.plugin,version:item.version,priority:Number(item.priority)||0});return all;},{})).map((route)=>({...route,candidates:route.candidates.sort((a,b)=>b.priority-a.priority||a.plugin.localeCompare(b.plugin))})).sort((a,b)=>a.capability.localeCompare(b.capability));
  return {
    schemaVersion:2, purpose, skills, tools,
    capabilityAuthorization,capabilityRoutes,resolutionPolicy:{mode:'compatible-fallback',strictHistoricalBinding:false},resolvedImplementations:[],
    modelProvider:provider, model,
    stageModels: { ...stageModels },
    stageModelsResolved: { ...stageModelsResolved },
    selection:selection ? {
      requestedSkill:selection.requestedSkill || '',
      selectedSkill:selection.selectedSkill || skills[0]?.id || '',
      selectionSource:selection.selectionSource || 'builtin-fallback',
      entryPoint:selection.entryPoint || '',
      contentType:selection.contentType || '',
      stages:Object.fromEntries(Object.entries(selection.stages||{}).map(([slot,item])=>[slot,{
        requestedSkill:item.requestedSkill||'',
        selectedSkill:item.selectedSkill||'',
        selectionSource:item.selectionSource||'builtin-default',
      }])),
    } : null,
    createdAt:new Date().toISOString(),
  };
}
