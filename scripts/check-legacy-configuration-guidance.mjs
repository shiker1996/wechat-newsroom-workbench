import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skillFiles=fs.readdirSync(path.join(root,'skills'),{withFileTypes:true}).filter((item)=>item.isDirectory()).map((item)=>`skills/${item.name}/SKILL.md`).filter((name)=>fs.existsSync(path.join(root,name)));
const files=['docs/configuration.md','docs/README.md','API.md',...skillFiles];
const forbidden=[/请(?:在|到).*?\.env.*?配置/gi,/手动编辑\s*\.env/gi,/密钥写入\s*`?\.env`?/gi,/固定表单/gi];
const violations=[];
for(const name of files){const text=fs.readFileSync(path.join(root,name),'utf8');for(const pattern of forbidden){for(const match of text.matchAll(pattern))violations.push(`${name}:${text.slice(0,match.index).split(/\r?\n/).length}: ${match[0]}`);}}
if(violations.length){console.error(`发现过期配置说明：\n${violations.join('\n')}`);process.exitCode=1;}else console.log(`配置说明扫描通过：${files.length} 个文件`);
