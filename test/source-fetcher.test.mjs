import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const script=path.join(root,'plugins','url-fetch','scripts','fetch-hotspot-url.py');
const fixture=path.join(root,'test','fixtures','article.html');
const bundled=path.join(process.env.USERPROFILE||'','.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe');
const python=process.env.WRITE_ASSISTANT_PYTHON||(fs.existsSync(bundled)?bundled:null);

test('Python 抓取器从 HTML 提取结构化来源和正文', (t) => {
  if(!python)return t.skip('未发现可用 Python 3 运行时');
  const code=`import importlib.util,json,pathlib,sys\ns=importlib.util.spec_from_file_location('fetcher',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\np=m.ArticleParser();p.feed(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'));print(json.dumps(p.result(),ensure_ascii=False))`;
  const output=execFileSync(python,['-X','utf8','-c',code,script,fixture],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  const result=JSON.parse(output);
  assert.equal(result.title,'结构化标题'); assert.equal(result.author,'测试作者');
  assert.match(result.content,/第一段包含明确事实/); assert.doesNotMatch(result.content,/导航内容/);
});

test('Python 抓取器拒绝本机与内网 URL', (t) => {
  if(!python)return t.skip('未发现可用 Python 3 运行时');
  const output=execFileSync(python,['-X','utf8',script,'--url','http://127.0.0.1:4317/'],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  const result=JSON.parse(output); assert.equal(result.status,'error'); assert.match(result.error,/拒绝访问/);
});
