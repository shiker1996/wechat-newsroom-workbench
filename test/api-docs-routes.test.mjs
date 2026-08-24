import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// 无法从可选分组正则机械展开的路由，手工登记其真实方法+路径
const MANUAL_OVERRIDES = new Map([
  ['revisionMatch', [
    'GET /api/documents/:param/revisions',
    'GET /api/documents/:param/revisions/:param',
    'POST /api/documents/:param/revisions/:param/restore',
  ]],
  ['__inline_skills_versions', [
    'POST /api/system/skills/:param/versions',
    'POST /api/system/skills/:param/versions/:param/restore',
    'POST /api/system/skills/:param/dry-run',
  ]],
]);

function expandAlternation(value) {
  const match = value.match(/\((?:\?:)?([^()]*\|[^()]*)\)/);
  if (!match) return [value];
  return match[1].split('|').flatMap((option) => expandAlternation(value.replace(match[0], option)));
}

function regexToCollapsed(raw) {
  let value = raw.replaceAll('\\/', '/');
  value = value.replace(/\((?:\?:)?[^()]*\|[^()]*\)/g, ':param');
  if (/\([^()]*\)\?/.test(value)) throw new Error(`包含可选分组，需登记 MANUAL_OVERRIDES：${raw}`);
  value = value
    .replaceAll('([^/]+)', ':param')
    .replaceAll('(\\d+)', ':param')
    .replaceAll('(.+)', ':param');
  if (/[\\()[\]^$*+?|]/.test(value)) throw new Error(`无法归一化的路由正则：${raw} → ${value}`);
  return value;
}

function regexToPaths(raw) {
  let value = raw.replaceAll('\\/', '/');
  if (/\((?:\?:)?[^()]*\|/.test(value)) {
    // 枚举型分支同时接受折叠写法（文档可写 /runtime/:service/:action）
    return [...new Set([
      ...expandAlternation(value).flatMap((item) => regexToPaths(item)),
      regexToCollapsed(raw),
    ])];
  }
  if (/\([^()]*\)\?/.test(value)) throw new Error(`包含可选分组，需登记 MANUAL_OVERRIDES：${raw}`);
  value = value
    .replaceAll('([^/]+)', ':param')
    .replaceAll('(\\d+)', ':param')
    .replaceAll('(.+)', ':param');
  if (/[\\()[\]^$*+?|]/.test(value)) throw new Error(`无法归一化的路由正则：${raw} → ${value}`);
  return [value];
}

function extractCodeRoutes() {
  const files = [path.join(root, 'server.mjs'),
    ...fs.readdirSync(path.join(root, 'server/platform/http/routes')).filter((name) => name.endsWith('.mjs'))
      .map((name) => path.join(root, 'server/platform/http/routes', name))];
  // 每个条目：method + 一组可接受的文档写法（展开形式或折叠形式，任一被文档覆盖即视为已记录）
  const entries = [];
  const add = (method, routePaths) => {
    entries.push({ method, forms: routePaths });
  };
  const varRegex = new Map();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(\w+)\s*=\s*pathname\.match\(\/\^(.+?)\$\/\)/g)) {
      varRegex.set(match[1], match[2]);
    }
  }
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    // 字面量路由（两种书写顺序）
    for (const match of text.matchAll(/request\.method\s*===\s*['"](\w+)['"]\s*&&\s*pathname\s*===\s*'(\/api[^']+)'/g)) add(match[1], [match[2]]);
    for (const match of text.matchAll(/pathname\s*===\s*'(\/api[^']+)'\s*&&\s*request\.method\s*===\s*['"](\w+)['"]/g)) add(match[2], [match[1]]);
    // 字面量数组路由
    for (const match of text.matchAll(/request\.method\s*===\s*['"](\w+)['"]\s*&&\s*\[([^\]]+)\]\.includes\(pathname\)/g)) {
      const paths = [...match[2].matchAll(/'(\/api[^']+)'/g)].map((item) => item[1]);
      for (const item of paths) add(match[1], [item]);
    }
    // 内联正则路由
    for (const match of text.matchAll(/request\.method\s*===\s*['"](\w+)['"]\s*&&\s*\/\^(.+?)\$\/\.test\(pathname\)/g)) {
      if (/\([^()]*\)\?/.test(match[2])) {
        for (const entry of MANUAL_OVERRIDES.get('__inline_skills_versions') ?? []) {
          const [method, ...rest] = entry.split(' ');
          entries.push({ method, forms: [rest.join(' ')] });
        }
        continue;
      }
      add(match[1], regexToPaths(match[2]));
    }
  }
  // 变量路由：逐行关联方法
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes('request.method')) continue;
      const vars = [...new Set([...line.matchAll(/\b(\w+)\b/g)].map((m) => m[1]).filter((name) => varRegex.has(name)))];
      if (!vars.length) continue;
      const methods = [...line.matchAll(/request\.method\s*===\s*['"](\w+)['"]/g)].map((m) => m[1]);
      const includesMatch = line.match(/\[([^\]]+)\]\.includes\(request\.method\)/);
      if (includesMatch) methods.push(...[...includesMatch[1].matchAll(/'(\w+)'/g)].map((m) => m[1]));
      for (const name of vars) {
        if (MANUAL_OVERRIDES.has(name)) {
          for (const entry of MANUAL_OVERRIDES.get(name)) {
            const [method, ...rest] = entry.split(' ');
            entries.push({ method, forms: [rest.join(' ')] });
          }
          continue;
        }
        const paths = regexToPaths(varRegex.get(name));
        for (const method of methods) add(method, paths);
      }
    }
  }
  return entries;
}

function extractDocRoutes() {
  const markdown = fs.readFileSync(path.join(root, 'API.md'), 'utf8');
  const routes = new Set();
  const add = (methods, routePath) => {
    const normalized = routePath.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':param').replace(/[?#].*$/, '');
    for (const method of methods.split('|')) routes.add(`${method} ${normalized}`);
  };
  // 标题形式：### GET /api/...
  for (const match of markdown.matchAll(/^### ((?:GET|POST|PUT|PATCH|DELETE)(?:\|(?:GET|POST|PUT|PATCH|DELETE))*) (\/api\/\S+)\s*$/gm)) {
    add(match[1], match[2]);
  }
  // 行内代码形式：`POST /api/...`、`GET|PUT /api/...`
  for (const match of markdown.matchAll(/`((?:GET|POST|PUT|PATCH|DELETE)(?:\|(?:GET|POST|PUT|PATCH|DELETE))*) (\/api\/[^`\s]+)`/g)) {
    add(match[1], match[2]);
  }
  return routes;
}

test('API.md 与代码路由清单一一对应', () => {
  const code = extractCodeRoutes();
  const docs = extractDocRoutes();
  // 同一代码路由的展开/折叠写法任一被文档覆盖即视为已记录
  const undocumentedSet = new Set();
  for (const entry of code) {
    if (entry.forms.every((form) => !docs.has(`${entry.method} ${form}`))) {
      undocumentedSet.add(`${entry.method} ${entry.forms[0]}`);
    }
  }
  const codeForms = new Set(code.flatMap((entry) => entry.forms.map((form) => `${entry.method} ${form}`)));
  const stale = [...docs].filter((route) => !codeForms.has(route)).sort();
  const undocumented = [...undocumentedSet].sort();
  assert.deepEqual({ undocumented, stale }, { undocumented: [], stale: [] },
    '代码与 API.md 漂移：undocumented=代码有而文档无，stale=文档有而代码无');
});
