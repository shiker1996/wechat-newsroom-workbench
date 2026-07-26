import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createZip } from '../lib/artifacts/zip-bundle.mjs';
import { validateWorkbenchBackup } from '../lib/artifacts/backup-archive.mjs';

test('工作台备份包校验清单、大小与 SHA-256', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backup-archive-'));
  try{
    const db=path.join(dir,'workbench.db');fs.writeFileSync(db,'sqlite snapshot');
    const data=fs.readFileSync(db);
    const manifest={schemaVersion:1,createdAt:new Date().toISOString(),appVersion:'test',files:[{
      name:'data/workbench.db',size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')
    }]};
    const manifestPath=path.join(dir,'manifest.json');fs.writeFileSync(manifestPath,JSON.stringify(manifest));
    const zip=createZip([{name:'manifest.json',path:manifestPath},{name:'data/workbench.db',path:db}]);
    const result=validateWorkbenchBackup(zip);
    assert.equal(result.manifest.appVersion,'test');
    assert.equal(result.entries.get('data/workbench.db').toString(),'sqlite snapshot');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('工作台备份包拒绝校验值不一致的内容', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backup-invalid-'));
  try{
    const db=path.join(dir,'workbench.db');fs.writeFileSync(db,'changed');
    const manifestPath=path.join(dir,'manifest.json');
    fs.writeFileSync(manifestPath,JSON.stringify({schemaVersion:1,files:[{name:'data/workbench.db',size:7,sha256:'0'.repeat(64)}]}));
    const zip=createZip([{name:'manifest.json',path:manifestPath},{name:'data/workbench.db',path:db}]);
    assert.throws(()=>validateWorkbenchBackup(zip),/校验失败/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
