import fs from 'node:fs';
import path from 'node:path';
import { backup as backupSqlite } from 'node:sqlite';
import { loadEnv } from '../../server/platform/core/env.mjs';
import { loadConfig } from '../../server/platform/core/config.mjs';
import { Store } from '../../server/platform/core/store.mjs';
import { buildConfigurationCatalog } from '../../server/platform/extensions/configuration-catalog.mjs';
import { legacyToolConfiguration } from '../../server/platform/extensions/legacy-tool-configuration.mjs';
import { legacyCollectorConfiguration } from '../../server/platform/extensions/legacy-collector-configuration.mjs';
import { legacyModelProviderConfiguration } from '../../server/platform/extensions/model-provider-configuration.mjs';
import { planLegacyConfigurationMigration, applyLegacyConfigurationMigration } from '../../server/platform/extensions/legacy-configuration-migrator.mjs';

const root=process.cwd(),dryRun=process.argv.includes('--dry-run'),force=process.argv.includes('--force');
loadEnv(root);const config=loadConfig(root),dbPath=path.join(root,'data','workbench.db');
if(!fs.existsSync(dbPath))throw new Error(`数据库不存在：${dbPath}`);
const store=new Store(dbPath),resources=await buildConfigurationCatalog({root,config});
const fallbackFor=(resource)=>resource.type==='tool'?legacyToolConfiguration(resource.manifest,config):resource.type==='collector'?legacyCollectorConfiguration(resource.manifest,config):resource.type==='model-provider'?legacyModelProviderConfiguration(config.llm?.providers?.[resource.id]||{}):{};
const plan=planLegacyConfigurationMigration({resources,repository:store.repositories.extensionSettings,fallbackFor});
const publicPlan=plan.map(({resource,action,configured,fields,secretFields,differences,issues})=>({type:resource.type,id:resource.id,name:resource.name,action:force&&action==='skip'?'skip_existing_protected':action,configured,fields,secretFields,differences,issues:issues.map(({field,message})=>({field,message}))}));
if(dryRun){console.log(JSON.stringify({dryRun:true,total:plan.length,migrate:plan.filter((item)=>item.action==='migrate').length,skip:plan.filter((item)=>item.action==='skip').length,resources:publicPlan},null,2));store.close();process.exit(0);}
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backupPath=path.join(root,'data',`configuration-migration-${stamp}.db`);
await backupSqlite(store.db,backupPath);
const results=applyLegacyConfigurationMigration({root,repository:store.repositories.extensionSettings,plan});
const report={schemaVersion:1,createdAt:new Date().toISOString(),backup:path.relative(root,backupPath).replaceAll('\\','/'),results};
const reportPath=path.join(root,'data','configuration-migration-report.json');fs.writeFileSync(reportPath,`${JSON.stringify(report,null,2)}\n`,'utf8');
console.log(JSON.stringify({ok:true,backup:report.backup,report:path.relative(root,reportPath).replaceAll('\\','/'),migrated:results.filter((item)=>item.status==='migrated').length,skipped:results.filter((item)=>item.status!=='migrated').length,needsConfiguration:results.filter((item)=>item.status==='migrated'&&!item.configured).map((item)=>`${item.type}:${item.id}`)},null,2));store.close();
