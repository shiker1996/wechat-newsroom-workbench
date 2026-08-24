import crypto from 'node:crypto';
import { APP_VERSION } from '../version.mjs';

function compatibleBackupVersion(value){
  const backup=String(value||'').match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
  const current=String(APP_VERSION).match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  if(!backup||!current||backup[0]!==current[0])return false;
  return backup[1]<current[1]||(backup[1]===current[1]&&backup[2]<=current[2]);
}

export function readStoredZip(buffer) {
  const entries=new Map();
  let offset=0;
  while(offset+4<=buffer.length&&buffer.readUInt32LE(offset)===0x04034b50){
    if(offset+30>buffer.length)throw new Error('备份包头部不完整');
    const method=buffer.readUInt16LE(offset+8);
    const size=buffer.readUInt32LE(offset+18);
    const nameLength=buffer.readUInt16LE(offset+26);
    const extraLength=buffer.readUInt16LE(offset+28);
    if(method!==0)throw new Error('备份包使用了不支持的压缩格式');
    const nameStart=offset+30,nameEnd=nameStart+nameLength,dataStart=nameEnd+extraLength,dataEnd=dataStart+size;
    if(dataEnd>buffer.length)throw new Error('备份包内容不完整');
    const name=buffer.subarray(nameStart,nameEnd).toString('utf8').replace(/\\/g,'/');
    if(!name||name.startsWith('/')||name.includes('../')||entries.has(name))throw new Error('备份包包含非法文件路径');
    entries.set(name,Buffer.from(buffer.subarray(dataStart,dataEnd)));
    offset=dataEnd;
  }
  if(!entries.size)throw new Error('不是有效的工作台备份包');
  return entries;
}

export function validateWorkbenchBackup(buffer) {
  const entries=readStoredZip(buffer);
  const manifestBuffer=entries.get('manifest.json');
  if(!manifestBuffer)throw new Error('备份包缺少 manifest.json');
  let manifest;
  try{manifest=JSON.parse(manifestBuffer.toString('utf8'));}catch{throw new Error('备份清单无法解析');}
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.files))throw new Error('备份版本不受支持');
  if(!compatibleBackupVersion(manifest.appVersion))throw new Error(`备份应用版本不兼容：${manifest.appVersion||'未知版本'}`);
  if(!entries.has('data/workbench.db'))throw new Error('备份包缺少数据库快照');
  for(const file of manifest.files){
    const data=entries.get(file.name);
    if(!data)throw new Error(`备份文件缺失：${file.name}`);
    if(data.length!==file.size)throw new Error(`备份文件大小不一致：${file.name}`);
    const hash=crypto.createHash('sha256').update(data).digest('hex');
    if(hash!==file.sha256)throw new Error(`备份文件校验失败：${file.name}`);
  }
  return {manifest,entries};
}
