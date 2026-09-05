import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checks = [
  {
    file: 'server/platform/http/routes/theme-routes.mjs',
    forbidden: [/generateAiThemeCandidate\(\{gateway\s*:\s*models\b/, /generateSocialTemplateProposal\(\{gateway\s*:\s*models\b/],
  },
  {
    file: 'server/platform/http/routes/system-routes.mjs',
    forbidden: [/assistStaticPage\([^\n]*gateway\s*:\s*models\b/],
  },
  {
    file: 'server/features/batches/application/ai-job-handlers.mjs',
    forbidden: [/runSocialCardBeautify\(\{[^\n]*gateway\s*:\s*gateway\b/, /runCoverImageJob\(\{[^\n]*gateway\s*:\s*gateway\b/],
  },
  {
    file: 'server/platform/http/routes/candidate-routes.mjs',
    forbidden: [/models\.complete\(\{\s*purpose\s*:\s*['"]composite-score['"]/],
  },
  {
    file: 'server/platform/http/routes/media-routes.mjs',
    forbidden: [/planImagePlaceholders\(\{\s*gateway\s*:\s*models\b/, /planArticleVisuals\(\{\s*gateway\s*:\s*models\b/],
  },
  {
    file: 'server/platform/http/routes/content-routes.mjs',
    forbidden: [/models\.complete\(\{\s*provider\s*:\s*input\.provider[^\n]*social-feedback-adjustment/, /models\.complete\(\{\s*provider\s*:\s*input\.provider[^\n]*content-feedback-adjustment/],
  },
];

const failures = [];
for (const check of checks) {
  const source = fs.readFileSync(path.join(root, check.file), 'utf8');
  for (const pattern of check.forbidden) {
    if (pattern.test(source)) failures.push(`${check.file}: 检测到业务入口直接传入基础 gateway（${pattern}）`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Harness boundary check passed (${checks.length} files)`);
}
