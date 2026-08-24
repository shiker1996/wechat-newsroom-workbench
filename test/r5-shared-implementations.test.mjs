import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { atomicWriteJson, atomicWriteUtf8 } from '../server/platform/core/atomic-file.mjs';
import { escapeHtml } from '../server/shared/rendering/html-utils.mjs';
import { colorContrast, mixHex } from '../server/shared/themes/color-utils.mjs';
import { fontStack } from '../server/shared/themes/font-utils.mjs';
import { parseJsonText } from '../server/platform/llm/model-json.mjs';

test('R5.3 共享原子写入同时覆盖 UTF-8 与 JSON',t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'shared-write-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const text=path.join(root,'nested','a.txt'),json=path.join(root,'b.json');assert.equal(atomicWriteUtf8(text,'中文',{stat:true}).size,6);atomicWriteJson(json,{ok:true});assert.equal(JSON.parse(fs.readFileSync(json,'utf8')).ok,true);assert.deepEqual(fs.readdirSync(root).sort(),['b.json','nested']);});
test('R5.3 HTML、颜色、字体和模型 JSON 使用共享边界实现',()=>{assert.equal(escapeHtml(`<a x='1'>&"`),'&lt;a x=&#39;1&#39;&gt;&amp;&quot;');assert.equal(mixHex('#000000','#FFFFFF',.5),'#808080');assert.ok(colorContrast('#000000','#FFFFFF')>20);assert.match(fontStack('mono'),/ui-monospace/);assert.deepEqual(parseJsonText('```json\n{"ok":true}\n```'),{ok:true});});
test('R5.3 关键调用方不再保留同类私有实现',()=>{const files=['server/platform/application/themes/ai-theme-generator.mjs','server/shared/themes/cover-theme-compiler.mjs','server/shared/themes/theme-issue-suggestions.mjs','server/platform/application/themes/theme-publish-gate.mjs','server/shared/rendering/markdown-renderer.mjs','server/features/articles/application/article-image-generator.mjs','server/platform/tools/settings.mjs','server/platform/collectors/settings.mjs','server/platform/skills/configuration.mjs'];for(const file of files){const source=fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');assert.doesNotMatch(source,/function mixHex|function escapeHtml|fs\.renameSync\([^,]*(?:temp|temporary)/,file);}});
