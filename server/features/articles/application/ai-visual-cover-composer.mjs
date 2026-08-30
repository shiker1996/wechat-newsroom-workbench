export const AI_VISUAL_COVER_WIDTH = 900;
export const AI_VISUAL_COVER_HEIGHT = 383;
export const AI_VISUAL_COVER_HTML = 'ai-cover.html';
export const AI_VISUAL_COVER_FINAL_HTML = 'cover.html';

export function buildCoverVisualInput({ title, summary = '', brand = '', theme, coverSemantics = null, outputPath = AI_VISUAL_COVER_HTML } = {}) {
  return {
    schemaVersion: 1,
    canvas: { width: AI_VISUAL_COVER_WIDTH, height: AI_VISUAL_COVER_HEIGHT, selector: '.page' },
    content: { title: String(title || ''), subtitle: String(summary || ''), brand: String(brand || ''), contentType: 'article-cover' },
    semantic: coverSemantics ? {
      highlightTerms: Array.isArray(coverSemantics.highlightTerms) ? [...coverSemantics.highlightTerms] : [],
      motifKind: String(coverSemantics.motifKind || ''),
      coreSubject: String(coverSemantics.coreSubject || ''),
      coreAction: String(coverSemantics.coreAction || ''),
      narrativeChange: String(coverSemantics.narrativeChange || ''),
      emotionalTension: String(coverSemantics.emotionalTension || ''),
      visualMetaphorCandidates: Array.isArray(coverSemantics.visualMetaphorCandidates) ? [...coverSemantics.visualMetaphorCandidates] : [],
      primaryFocus: String(coverSemantics.primaryFocus || ''),
    } : {
      highlightTerms: [],
      motifKind: '',
      coreSubject: '',
      coreAction: '',
      narrativeChange: '',
      emotionalTension: '',
      visualMetaphorCandidates: [],
      primaryFocus: '',
    },
    theme: { id: String(theme?.id || ''), layoutHint: String(theme?.cover?.spec?.layout || ''), tags: Array.isArray(theme?.tags) ? [...theme.tags] : [] },
    output: { html: String(outputPath), image: 'cover.png' },
  };
}

export function buildCoverThemeSnapshot(theme = {}) {
  const snapshot = structuredClone(theme && typeof theme === 'object' ? theme : {});
  delete snapshot.file;
  delete snapshot._file;
  return {
    schemaVersion: 1,
    id: snapshot.id || '',
    label: snapshot.label || '',
    version: snapshot.version || '',
    source: snapshot.source || 'builtin',
    hash: snapshot.hash || '',
    tags: Array.isArray(snapshot.tags) ? snapshot.tags : [],
    tokens: snapshot.tokens || {},
    cover: snapshot.cover || {},
  };
}

export function buildAiVisualCoverScaffold() {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=900, initial-scale=1"></head><body data-render-mode="ai-visual-cover"></body></html>';
}
