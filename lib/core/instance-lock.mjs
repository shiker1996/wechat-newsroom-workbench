import fs from 'node:fs';
import path from 'node:path';

function processAlive(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}

export function acquireInstanceLock(root,{name='workbench'}={}){
  const file=path.join(root,'data',`${name}.lock`);fs.mkdirSync(path.dirname(file),{recursive:true});
  for(let attempt=0;attempt<2;attempt+=1){
    try{const fd=fs.openSync(file,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));fs.closeSync(fd);let released=false;return {file,release(){if(released)return;released=true;try{const owner=JSON.parse(fs.readFileSync(file,'utf8'));if(owner.pid===process.pid)fs.unlinkSync(file);}catch{}}};}
    catch(error){if(error.code!=='EEXIST')throw error;let owner={};try{owner=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}if(processAlive(Number(owner.pid)))throw Object.assign(new Error(`工作台已有实例运行（PID ${owner.pid}）`),{code:'INSTANCE_ALREADY_RUNNING'});try{fs.unlinkSync(file);}catch{} }
  }
  throw new Error('无法取得工作台实例锁');
}
