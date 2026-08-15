import fs from 'node:fs';
import path from 'node:path';

export function atomicWriteUtf8(filePath,content,{stat=false}={}){
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  const temporary=`${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary,content,'utf8');fs.renameSync(temporary,filePath);
  if(!stat)return undefined;const value=fs.statSync(filePath);return {size:value.size,modifiedAt:value.mtime.toISOString()};
}

export function atomicWriteJson(filePath,value){return atomicWriteUtf8(filePath,`${JSON.stringify(value,null,2)}\n`);}
