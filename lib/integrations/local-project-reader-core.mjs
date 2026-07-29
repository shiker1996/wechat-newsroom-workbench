import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  '.git', '.svn', '.hg', 'node_modules', '.next', '.nuxt', 'dist', 'build',
  'coverage', '.cache', '.venv', 'venv', 'vendor', 'target', 'out',
]);
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.vue', '.py', '.go', '.rs', '.java', '.kt', '.cs', '.php', '.rb',
  '.sh', '.ps1', '.yaml', '.yml', '.toml', '.ini', '.conf', '.html',
  '.css', '.scss', '.sql', '.xml', '.graphql', '.proto',
]);
const SPECIAL_TEXT_FILES = /^(readme(?:\..+)?|dockerfile|makefile|package\.json|pyproject\.toml|cargo\.toml|go\.mod)$/i;
const SECRET_FILE = /(^|[._-])(env|secret|secrets|credential|credentials|token|tokens)([._-]|$)|\.pem$|\.key$|^id_rsa/i;

function isTextFile(name) {
  return SPECIAL_TEXT_FILES.test(name) || TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function priority(relativePath) {
  const name = path.basename(relativePath);
  if (/^readme/i.test(name)) return 0;
  if (/^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|dockerfile)$/i.test(name)) return 1;
  if (/(config|src|app|lib|docs?)[\\/]/i.test(relativePath)) return 2;
  return 3;
}

export function readLocalProjectImplementation(inputPath, options = {}) {
  const root = path.resolve(String(inputPath || '').trim());
  if (!String(inputPath || '').trim()) throw new Error('请提供本地项目目录');
  const stat = fs.statSync(root, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) throw new Error('本地项目目录不存在或不是文件夹');

  const maxFiles = Math.min(Number(options.maxFiles) || 80, 200);
  const maxFileBytes = Math.min(Number(options.maxFileBytes) || 256 * 1024, 1024 * 1024);
  const maxCharsPerFile = Math.min(Number(options.maxCharsPerFile) || 5000, 20000);
  const maxTotalChars = Math.min(Number(options.maxTotalChars) || 60000, 200000);
  const candidates = [];
  const skipped = { directories: 0, secrets: 0, binaryOrUnsupported: 0, oversized: 0, symlinks: 0 };

  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isSymbolicLink()) { skipped.symlinks += 1; continue; }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) { skipped.directories += 1; continue; }
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SECRET_FILE.test(entry.name)) { skipped.secrets += 1; continue; }
      if (!isTextFile(entry.name)) { skipped.binaryOrUnsupported += 1; continue; }
      const size = fs.statSync(absolute).size;
      if (size > maxFileBytes) { skipped.oversized += 1; continue; }
      candidates.push({ absolute, path: relative, size });
    }
  };
  walk(root);
  candidates.sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path));

  const files = [];
  let totalChars = 0;
  for (const candidate of candidates) {
    if (files.length >= maxFiles || totalChars >= maxTotalChars) break;
    const content = fs.readFileSync(candidate.absolute, 'utf8').replace(/\u0000/g, '');
    const remaining = maxTotalChars - totalChars;
    const excerpt = content.slice(0, Math.min(maxCharsPerFile, remaining));
    if (!excerpt) continue;
    files.push({ path: candidate.path, size: candidate.size, excerpt, truncated: excerpt.length < content.length });
    totalChars += excerpt.length;
  }
  return {
    root,
    files,
    totalFiles: candidates.length,
    totalChars,
    truncated: files.length < candidates.length || files.some((item) => item.truncated),
    skipped,
    summary: `读取 ${files.length}/${candidates.length} 个文本文件，共 ${totalChars} 字符`,
  };
}

export function extractLocalProjectPath(value) {
  const text = String(value || '');
  const quotedWindows = text.match(/["']([A-Za-z]:\\[^"']+)["']/);
  if (quotedWindows) return quotedWindows[1].trim();
  const windows = text.match(/[A-Za-z]:\\[^\s"'<>|?*，。；、]+/);
  if (windows) return windows[0].trim().replace(/[，。；、]+$/, '');
  const quotedPosix = text.match(/["'](\/[^"']+)["']/);
  if (quotedPosix) return quotedPosix[1].trim();
  const posix = text.match(/(?:^|\s)(\/(?:[^/\s]+\/)*[^/\s，。；、]+)/);
  return posix?.[1]?.trim().replace(/[，。；、]+$/, '') || '';
}
