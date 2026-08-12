import fs from 'node:fs';
import path from 'node:path';

const fileFor=(root)=>path.join(root,'data','collector-tool-settings.json');
export function readCollectorToolSettings(root){try{return JSON.parse(fs.readFileSync(fileFor(root),'utf8'))||{};}catch{return {};}}
export function writeCollectorToolSetting(root,id,input={}){const file=fileFor(root),all=readCollectorToolSettings(root),current=all[id]||{};all[id]={enabled:input.enabled===undefined?current.enabled:input.enabled!==false,priority:input.priority===undefined?(Number(current.priority)||0):Math.max(-100,Math.min(100,Number(input.priority)||0))};fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.tmp`;fs.writeFileSync(temp,`${JSON.stringify(all,null,2)}\n`);fs.renameSync(temp,file);return all[id];}
