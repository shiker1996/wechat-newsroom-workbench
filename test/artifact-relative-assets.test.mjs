import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveArtifactRelativeAsset } from '../server/platform/artifacts/artifact-indexer.mjs';

test('artifact relative assets resolve inside the artifact directory only', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-assets-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const articleDir = path.join(root, 'articles', 'daily');
  const imageDir = path.join(articleDir, 'images');
  fs.mkdirSync(imageDir, { recursive:true });
  const html = path.join(articleDir, 'article.ai.html');
  const image = path.join(imageDir, 'mermaid-1.png');
  fs.writeFileSync(html, '<img src="images/mermaid-1.png">');
  fs.writeFileSync(image, 'png');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'secret');

  assert.equal(resolveArtifactRelativeAsset(html, 'images/mermaid-1.png', [root]), image);
  assert.equal(resolveArtifactRelativeAsset(html, '../secret.txt', [root]), null);
  assert.equal(resolveArtifactRelativeAsset(html, '../../../outside.txt', [root]), null);
  assert.equal(resolveArtifactRelativeAsset(html, 'images/missing.png', [root]), null);
});
