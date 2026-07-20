import fs from 'node:fs';
import path from 'node:path';

export function parseEnv(text) {
  const values = {};
  for (const sourceLine of String(text).split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = normalized.indexOf('=');
    if (separator < 1) continue;
    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = normalized.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      value = value.replace(/(^|\s+)#.*$/, '').trim();
    }
    values[key] = value;
  }
  return values;
}

export function loadEnv(root = process.cwd(), fileName = '.env') {
  const filePath = path.join(root, fileName);
  if (!fs.existsSync(filePath)) return { loaded: false, filePath, keys: [] };
  const values = parseEnv(fs.readFileSync(filePath, 'utf8'));
  const keys = [];
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
    keys.push(key);
  }
  return { loaded: true, filePath, keys };
}
