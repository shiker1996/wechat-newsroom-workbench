import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';
import {
  COVER_AI_DESIGN_SPEC_HEADINGS,
  buildDeterministicCoverAiDesignSpec,
  loadCoverAiDesignSpec,
  validateCoverAiDesignSpec,
  writeCoverAiDesignSpecSnapshot,
} from '../server/shared/themes/cover-ai-spec.mjs';

test('all builtin cover themes have a valid AI design spec file', () => {
  const themes = getBuiltinThemeRegistry().list({ target: 'cover' });
  assert.equal(themes.length, 10);
  for (const theme of themes) {
    const result = loadCoverAiDesignSpec({ workspaceRoot: process.cwd(), theme, allowFallback: false });
    assert.equal(result.ok, true, `${theme.id}: ${JSON.stringify(result.issues)}`);
    assert.equal(result.source, 'file', theme.id);
    assert.equal(result.fallback, false, theme.id);
    for (const heading of COVER_AI_DESIGN_SPEC_HEADINGS) assert.match(result.text, new RegExp(`^##\\s+${heading}\\s*$`, 'm'), `${theme.id}: ${heading}`);
    assert.match(result.text, new RegExp(theme.id));
    for (const color of Object.values(theme.tokens.colors)) assert.match(result.text, new RegExp(color.replace('#', '\\#'), 'i'), `${theme.id}: ${color}`);
  }
});

test('cover AI spec validator rejects missing required sections', () => {
  const result = validateCoverAiDesignSpec('# incomplete\n\n## 主题定位\n');
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'MISSING_HEADING' && issue.heading === '配色关系'));
});

test('deterministic fallback builds a valid spec from cover JSON', () => {
  const theme = getBuiltinThemeRegistry().require('cover-navy-gold');
  const spec = buildDeterministicCoverAiDesignSpec(theme);
  const result = validateCoverAiDesignSpec(spec);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.match(spec, /cover-navy-gold/);
  assert.match(spec, /#1F3A5F/i);
  assert.match(spec, /side-panel/);
});

test('missing cover AI spec falls back deterministically and can be snapshotted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-ai-spec-'));
  const theme = {
    id: 'temporary-cover',
    label: '临时封面',
    version: '0.1.0',
    description: '用于测试缺失规范时的确定性回退。',
    targets: ['cover'],
    tags: ['测试'],
    tokens: {
      colors: { page: '#FFFFFF', text: '#111111', muted: '#666666', accent: '#0055AA', accentSecondary: '#CC8800', inverseText: '#FFFFFF', codeBackground: '#111111' },
      typography: { family: 'sans', headingFamily: 'sans' },
      spacing: { paddingXPx: 48, paddingYPx: 44, gapPx: 18 },
      shape: { badgeRadiusPx: 4 },
    },
    cover: { spec: { layout: 'minimal', components: [{ type: 'canvas' }, { type: 'title' }] } },
  };
  const loaded = loadCoverAiDesignSpec({ workspaceRoot: root, theme });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.fallback, true);
  assert.equal(loaded.source, 'deterministic-fallback');
  const snapshot = writeCoverAiDesignSpecSnapshot({ workspaceRoot: root, workdir: root, theme });
  assert.equal(fs.existsSync(snapshot.snapshotPath), true);
  assert.equal(fs.readFileSync(snapshot.snapshotPath, 'utf8'), loaded.text);
});

test('inline user theme AI spec takes precedence over file lookup', () => {
  const theme = {
    id: 'inline-cover',
    aiVisualSpec: buildDeterministicCoverAiDesignSpec({ id: 'inline-cover', label: '内联封面' }),
  };
  const loaded = loadCoverAiDesignSpec({ workspaceRoot: os.tmpdir(), theme, allowFallback: false });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.source, 'theme.aiVisualSpec');
  assert.equal(loaded.fallback, false);
});
