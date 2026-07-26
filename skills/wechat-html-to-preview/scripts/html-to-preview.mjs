import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node html-to-preview.mjs <article.html> [--dry-run] [--endpoint https://host/api/copy]');
  process.exit(0);
}

const file = args.find((arg) => !arg.startsWith('--'));
if (!file) {
  console.error('Missing HTML file.');
  process.exit(2);
}
const input = path.resolve(file);
const output = path.join(path.dirname(input), 'wechat-preview-url.txt');
let html;
try {
  html = fs.readFileSync(input, 'utf8');
} catch (error) {
  console.error(`Unable to read HTML: ${error.message}`);
  process.exit(2);
}
if (!html.trim()) {
  console.error('HTML file is empty.');
  process.exit(2);
}

const imageSources = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)].map((match) => match[2]);
const nonHttpsImages = imageSources.filter((source) => !/^https:\/\//i.test(source));
if (nonHttpsImages.length) {
  console.error(`Preview requires HTTPS images; found ${nonHttpsImages.length} non-HTTPS source(s).`);
  process.exit(2);
}

if (args.includes('--dry-run')) {
  console.log(JSON.stringify({ valid: true, input, bytes: Buffer.byteLength(html, 'utf8'), submitted: false }));
  process.exit(0);
}

const endpointIndex = args.indexOf('--endpoint');
const endpoint = endpointIndex >= 0 ? args[endpointIndex + 1] : (process.env.WECHAT_PREVIEW_ENDPOINT || 'https://edit.shiker.tech/api/copy');
if (!endpoint || !/^https:\/\//i.test(endpoint)) {
  console.error('Preview endpoint must be an HTTPS URL.');
  process.exit(2);
}

let response;
try {
  response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ html }),
  });
} catch (error) {
  console.error(`Preview request failed: ${error.message}`);
  process.exit(1);
}
if (!response.ok) {
  console.error(`Preview service returned HTTP ${response.status}.`);
  process.exit(1);
}

let payload;
try {
  payload = await response.json();
} catch {
  console.error('Preview service returned invalid JSON.');
  process.exit(1);
}
const url = payload?.data?.url;
if (payload?.success === false || typeof url !== 'string' || !/^https:\/\//i.test(url)) {
  console.error('Preview service response did not contain a valid HTTPS URL.');
  process.exit(1);
}
fs.writeFileSync(output, `${url}\n`, 'utf8');
console.log(url);
