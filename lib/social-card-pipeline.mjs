import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadSkillBundle } from './llm/skill-runtime.mjs';
import { evaluateCardGate, evaluateEventCardGate, evaluateCustomCardGate } from './social-card-gate.mjs';
import { customFactMarkdown } from './custom-fact-builder.mjs';
import { candidateSocialCardDir } from './workspace-paths.mjs';

const execFileAsync = promisify(execFile);

export const SOCIAL_CARD_STAGE_CONTRACT = Object.freeze([
  { id:'facts', skill:'xiaohongshu-article-generator' },
  { id:'planning', skill:'xiaohongshu-article-generator' },
  { id:'generation', skill:'xiaohongshu-article-generator' },
  { id:'layout-audit', skill:'xiaohongshu-article-generator' },
  { id:'screenshots', skill:'html-pages-to-images' },
  { id:'delivery-gate', skill:'xiaohongshu-article-generator' },
]);

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive:true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, String(content).trimEnd() + '\n', 'utf8');
  fs.renameSync(temp, filePath);
  return fs.statSync(filePath);
}

function cleanCardPlanJson(value) {
  const raw = String(value || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let json = fenced ? fenced[1].trim() : raw;
  const start = Math.min(
    json.includes('{') ? json.indexOf('{') : Infinity,
    json.includes('[') ? json.indexOf('[') : Infinity,
  );
  const end = Math.max(json.lastIndexOf('}'), json.lastIndexOf(']'));
  if (!Number.isFinite(start) || end < 0) throw new Error('布局修复未返回可解析的 card_plan JSON');
  return JSON.parse(json.slice(start, end + 1));
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function sanitizeCardPlan(cardPlan) {
  const instructionPatterns = [
    /^让读者(?:一眼)?知道/,
    /^让读者/,
    /^读者(?:能|会|可以|理解|了解|知道)/,
    /^本页(?:旨在|希望|要|应该|目的(?:是|为))?/,
    /^这一页(?:旨在|希望|要|应该|目的(?:是|为))?/,
    /^本卡(?:旨在|希望|要|应该|目的(?:是|为))?/,
    /^本章节(?:旨在|希望|要|应该|目的(?:是|为))?/,
    /^请/,
  ];
  function clean(text) {
    if (typeof text !== 'string') return text;
    let s = text.trim();
    for (const re of instructionPatterns) s = s.replace(re, '').trim();
    return s.replace(/^[，。；、:：\s]+/, '').trim();
  }
  return (Array.isArray(cardPlan) ? cardPlan : []).map((page) => ({
    ...page,
    title: clean(page.title),
    goal: clean(page.goal),
    evidence: (Array.isArray(page.evidence) ? page.evidence : []).map(clean),
    content_blocks: (Array.isArray(page.content_blocks) ? page.content_blocks : []).map((block) => ({ ...block, title: clean(block.title), content: clean(block.content) })),
  }));
}

export function renderStoryboardHtml({ topic, repository, pages, visualStyle='ice-blue', contentType='repository', sourceLabel='', disclosure='', channelMode='wechat' }) {
  const themes=['neon','tokyo-night','brutalist','solarized','retro-terminal','paper-craft','charcoal','peach','orange','ice-blue','mocha','lavender','crimson','bone-white'];
  const theme=themes.includes(visualStyle)?visualStyle:'ice-blue';
  const themeClass=['ice-blue','neon','brutalist'].includes(theme)?`theme-${theme}`:`theme-${theme} theme-palette`;
  const safePages = Array.isArray(pages) ? pages : [];
  const sections = safePages.map((page, index) => {
    const pageKind = page.kind === 'cover' ? 'cover' : page.kind === 'ending' ? 'ending' : 'content';
    const evidence = (Array.isArray(page.evidence) ? page.evidence : []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    const blocks = (Array.isArray(page.content_blocks) ? page.content_blocks : []).slice(0,4).map((block) => {
      const title=block.title?`<h2>${escapeHtml(block.title)}</h2>`:''; const content=String(block.content||'').trim();
      if(block.type==='code')return `<div class="content-block code-block">${title}<pre><code>${escapeHtml(content)}</code></pre></div>`;
      if(block.type==='list')return `<div class="content-block list-block">${title}<ul>${content.split(/\n+/).map((item)=>item.replace(/^[-*+]\s*/, '').trim()).filter(Boolean).map((item)=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
      if(block.type==='note')return `<aside class="content-block note-block">${title}<p>${escapeHtml(content)}</p></aside>`;
      return `<div class="content-block text-block">${title}<p>${escapeHtml(content)}</p></div>`;
    }).join('');
    const toolLabels={cover:'TOOL RADAR',problem:'WHY IT MATTERS',capability:'CORE FEATURES',quickstart:'QUICK START',scenario:'USE CASES',limitation:'BEFORE YOU USE',ending:'SAVE FOR LATER'};
    const eventLabels={cover:'BREAKING FOCUS','what-happened':'WHAT HAPPENED',timeline:'TIMELINE',evidence:'EVIDENCE CHECK',positions:'WHO SAID WHAT',impact:'WHY IT MATTERS',risk:'FACT BOUNDARY',ending:'KEEP WATCHING'};
    const customLabels={cover:'NEW NOTE',highlight:'KEY POINTS',step:'HOW TO',item:'THE LIST',boundary:'FACT BOUNDARY',ending:'SAVE FOR LATER'};
    const pageLabels=contentType==='event'?eventLabels:contentType==='custom'?customLabels:toolLabels;
    const label = pageLabels[page.kind] || (contentType==='event'?'EVENT CARD':contentType==='custom'?'CUSTOM CARD':'TOOL CARD');
    const brand=contentType==='event'?`EVENT DESK / ${sourceLabel||topic}`:contentType==='custom'?(channelMode==='xiaohongshu'?`小红书 · ${sourceLabel||topic}`:`CUSTOM / ${sourceLabel||topic}`):`OPEN SOURCE / ${repository||topic}`;
    const footer=disclosure||(contentType==='event'?'据公开素材整理 · 未核实内容已标注':contentType==='custom'?'内容整理自作者素材 · 建议性内容未实测':'基于项目文档整理 · 未实际运行');
    const fallbackContent = (!blocks && !evidence && page.goal) ? `<div class="content-block text-block"><p>${escapeHtml(page.goal)}</p></div>` : '';
    return `<section class="page page-${pageKind}" data-page-kind="${pageKind}" data-page-number="${index + 1}"><div class="page-inner"><header class="page-header"><span class="brand">${escapeHtml(brand)}</span><span class="page-number">${String(index + 1).padStart(2, '0')}</span></header><main class="page-body" data-valign="center"><div class="page-content-stack"><span class="eyebrow">${label}</span><h1>${escapeHtml(page.title || topic)}</h1>${page.goal ? `<p class="lead">${escapeHtml(page.goal)}</p>` : ''}${blocks || (evidence ? `<ul>${evidence}</ul>` : fallbackContent)}</div></main><footer class="page-footer"><span>${escapeHtml(footer)}</span><i></i></footer></div></section>`;
  }).join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(topic)} · ${contentType==='event'?'事件图文':contentType==='custom'?'自定义图文':'工具卡'}</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#dce9f3;color:#102033;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}.page{width:375px;height:667px;overflow:hidden;background:linear-gradient(145deg,#f9fcff 0%,#e7f2fa 58%,#d8eaf5 100%);position:relative}.page:after{content:"";position:absolute;width:190px;height:190px;border:1px solid rgba(31,113,156,.14);border-radius:50%;right:-88px;top:-70px}.page-inner{height:100%;padding:27px 25px 23px;display:grid;grid-template-rows:auto 1fr auto}.page-header,.page-footer{display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}.brand{max-width:270px;font-size:11px;font-weight:750;letter-spacing:.12em;color:#41718c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.brand[data-text-role="auxiliary"]{font-size:9px}.page-number{font:700 11px ui-monospace,Consolas,monospace;color:#1b6d98}.page-body{min-height:0;display:flex;align-items:center}.page-content-stack{width:100%;min-height:76%;padding:24px 21px;border:1px solid rgba(27,109,152,.18);border-radius:22px;background:rgba(255,255,255,.66);box-shadow:0 20px 45px rgba(36,91,122,.10);display:flex;flex-direction:column;justify-content:center;gap:12px;position:relative;z-index:1}.eyebrow{font-size:10px;font-weight:800;letter-spacing:.16em;color:#ec6b43}.page h1{font-size:27px;line-height:1.18;letter-spacing:-.035em;margin:0;overflow-wrap:anywhere}.page-cover h1{font-size:34px}.lead{font-size:13px;line-height:1.55;color:#476176;margin:0}.content-block{display:grid;gap:5px}.content-block h2{font-size:12px;line-height:1.35;margin:0;color:#1b6d98}.content-block p{font-size:11px;line-height:1.55;margin:0}.page ul{list-style:none;padding:0;margin:0;display:grid;gap:7px}.page li{font-size:11px;line-height:1.45;padding:7px 9px 7px 24px;border-radius:9px;background:rgba(215,235,246,.72);position:relative;overflow-wrap:anywhere}.page li:before{content:"";position:absolute;left:9px;top:12px;width:6px;height:6px;border-radius:50%;background:#ec6b43}.code-block pre{margin:0;padding:10px;border-radius:9px;background:#102c3d;color:#dff5ff;white-space:pre-wrap;overflow-wrap:anywhere}.code-block code{font:10px/1.45 ui-monospace,Consolas,monospace}.note-block{padding:9px 11px;border-left:3px solid #ec6b43;background:#fff4ec;border-radius:0 9px 9px 0}.page-footer{font-size:9px;color:#608094;letter-spacing:.04em}.page-footer i{width:38px;height:2px;background:#ec6b43;border-radius:2px}.page-ending .page-content-stack{background:#15354a;color:#f7fbff}.page-ending .lead,.page-ending li,.page-ending .content-block h2{color:#dceaf2}.page-ending li{background:rgba(255,255,255,.1)}
.theme-tokyo-night{--bg:#16161e;--page:#1a1b26;--surface:#24283b;--ink:#c0caf5;--muted:#9aa5ce;--accent:#7aa2f7;--accent2:#bb9af7;--line:#414868;--code:#101014;--radius:18px;--shadow:0 22px 52px rgba(0,0,0,.35)}.theme-solarized{--bg:#eee8d5;--page:#fdf6e3;--surface:#fffaf0;--ink:#073642;--muted:#657b83;--accent:#2aa198;--accent2:#b58900;--line:#93a1a1;--code:#002b36;--radius:14px;--shadow:0 18px 38px rgba(88,110,117,.18)}.theme-retro-terminal{--bg:#020502;--page:#061006;--surface:#071507;--ink:#7dff8f;--muted:#38b84b;--accent:#00ff41;--accent2:#b6ff00;--line:#167629;--code:#000;--radius:0;--shadow:0 0 28px rgba(0,255,65,.18)}.theme-paper-craft{--bg:#d8cbb3;--page:#f5ead6;--surface:#fffaf0;--ink:#3a2820;--muted:#80685a;--accent:#c0392b;--accent2:#d9a441;--line:#b79b7e;--code:#362721;--radius:2px;--shadow:9px 11px 0 rgba(80,55,40,.22)}.theme-charcoal{--bg:#0f0f0f;--page:#1a1a1a;--surface:#242424;--ink:#ededed;--muted:#999;--accent:#f5f5f5;--accent2:#777;--line:#454545;--code:#090909;--radius:0;--shadow:none}.theme-peach{--bg:#ffe8ee;--page:#fff5f7;--surface:#fffafb;--ink:#5c3a4a;--muted:#a06b7d;--accent:#ff9ab8;--accent2:#ffb86c;--line:#f2bfd0;--code:#5c3a4a;--radius:26px;--shadow:0 22px 50px rgba(190,96,128,.18)}.theme-orange{--bg:#1a1200;--page:#251700;--surface:#302009;--ink:#fff5e6;--muted:#d4a85e;--accent:#ff7a00;--accent2:#ffd166;--line:#704212;--code:#0f0a00;--radius:10px;--shadow:8px 8px 0 #ff7a00}.theme-mocha{--bg:#e8dccf;--page:#faf6f1;--surface:#fffaf4;--ink:#3d2b22;--muted:#7a5240;--accent:#8b5c3f;--accent2:#c99a6b;--line:#cbb29d;--code:#30211b;--radius:16px;--shadow:0 18px 40px rgba(86,55,39,.18)}.theme-lavender{--bg:#e9e0f6;--page:#f5f0ff;--surface:#fcfaff;--ink:#44385d;--muted:#81739a;--accent:#967bb6;--accent2:#d49bb5;--line:#cfc1e3;--code:#302a43;--radius:24px;--shadow:0 22px 50px rgba(100,76,140,.16)}.theme-crimson{--bg:#130408;--page:#22070e;--surface:#2d0b14;--ink:#fff1f4;--muted:#e29aaa;--accent:#ff2d55;--accent2:#ffd60a;--line:#7e1d32;--code:#090103;--radius:4px;--shadow:9px 9px 0 #ff2d55}.theme-bone-white{--bg:#e7e7e5;--page:#f5f5f3;--surface:#fff;--ink:#222;--muted:#777;--accent:#333;--accent2:#aaa;--line:#c7c7c4;--code:#222;--radius:0;--shadow:0 16px 36px rgba(0,0,0,.08)}
body.theme-palette{background:var(--bg);color:var(--ink);font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}.theme-palette .page{background:var(--page);color:var(--ink)}.theme-palette .page:after{border-color:var(--accent);border-radius:var(--radius);opacity:.35}.theme-palette .brand,.theme-palette .page-number,.theme-palette .content-block h2{color:var(--accent)}.theme-palette .eyebrow{color:var(--accent2)}.theme-palette .page-content-stack{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}.theme-palette .lead,.theme-palette .page-footer{color:var(--muted)}.theme-palette .page li{border:1px solid var(--line);border-radius:calc(var(--radius) / 2);background:color-mix(in srgb,var(--accent) 12%,var(--surface))}.theme-palette .page li:before,.theme-palette .page-footer i{background:var(--accent2)}.theme-palette .code-block pre{border-radius:calc(var(--radius) / 2);background:var(--code);color:#f7f7f2}.theme-palette .note-block{border-left-color:var(--accent);border-radius:0 calc(var(--radius) / 2) calc(var(--radius) / 2) 0;background:color-mix(in srgb,var(--accent2) 14%,var(--surface))}.theme-palette .page-ending .page-content-stack{background:var(--accent);color:var(--page)}.theme-palette .page-ending .lead,.theme-palette .page-ending li,.theme-palette .page-ending .content-block h2{color:var(--page)}.theme-palette .page-ending li{background:rgba(0,0,0,.14)}.theme-retro-terminal .page{background-image:repeating-linear-gradient(0deg,rgba(0,255,65,.035) 0,rgba(0,255,65,.035) 1px,transparent 1px,transparent 4px)}.theme-paper-craft .page-content-stack{transform:rotate(-.35deg)}.theme-charcoal .page:after,.theme-bone-white .page:after{border-radius:50%}.theme-peach .page:after,.theme-lavender .page:after{filter:blur(1px)}.theme-crimson .page h1,.theme-orange .page h1{letter-spacing:-.05em}.theme-bone-white .eyebrow{border-bottom:1px solid #333;padding-bottom:5px}
body.theme-neon{background:#050809;color:#eafff7;font-family:ui-monospace,Consolas,"Microsoft YaHei",monospace}.theme-neon .page{background-color:#07100e;background-image:linear-gradient(rgba(68,255,184,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(68,255,184,.07) 1px,transparent 1px);background-size:22px 22px}.theme-neon .page:after{border:2px solid #55ffb6;border-radius:0;transform:rotate(18deg);box-shadow:0 0 32px rgba(85,255,182,.28)}.theme-neon .brand,.theme-neon .page-number,.theme-neon .content-block h2{color:#55ffb6}.theme-neon .eyebrow{color:#ff4fd8}.theme-neon .page-content-stack{border:1px solid #55ffb6;border-radius:3px;background:rgba(4,12,10,.91);box-shadow:8px 8px 0 #ff4fd8}.theme-neon .lead,.theme-neon .page-footer{color:#9bd8c2}.theme-neon .page li{border:1px solid rgba(85,255,182,.35);border-radius:2px;background:#0c1c17}.theme-neon .page li:before,.theme-neon .page-footer i{background:#ff4fd8}.theme-neon .code-block pre{border:1px solid #55ffb6;border-radius:0;background:#020403;color:#c8ffe8}.theme-neon .note-block{border-left-color:#ff4fd8;border-radius:0;background:#211020}.theme-neon .page-ending .page-content-stack{background:#55ffb6;color:#04100c;box-shadow:8px 8px 0 #ff4fd8}.theme-neon .page-ending .lead,.theme-neon .page-ending li,.theme-neon .page-ending .content-block h2{color:#09261c}.theme-neon .page-ending li{background:rgba(0,0,0,.12)}
body.theme-brutalist{background:#d8d2bf;color:#111;font-family:Georgia,"Noto Serif SC","Microsoft YaHei",serif}.theme-brutalist .page{background:#f4edce}.theme-brutalist .page:after{width:150px;height:150px;border:18px solid #f04b32;border-radius:0;right:-72px;top:-62px;transform:rotate(9deg)}.theme-brutalist .brand{padding:4px 7px;background:#111;color:#fff}.theme-brutalist .page-number{font-size:15px;color:#111}.theme-brutalist .page-content-stack{border:4px solid #111;border-radius:0;background:#fff9df;box-shadow:10px 10px 0 #111}.theme-brutalist .eyebrow{width:max-content;padding:4px 7px;background:#f2c94c;color:#111}.theme-brutalist .page h1{font-weight:900}.theme-brutalist .lead,.theme-brutalist .page-footer{color:#3e392e}.theme-brutalist .content-block h2{color:#111;text-decoration:underline;text-decoration-thickness:3px;text-decoration-color:#f04b32}.theme-brutalist .page li{border:2px solid #111;border-radius:0;background:#f2c94c}.theme-brutalist .page li:before,.theme-brutalist .page-footer i{border-radius:0;background:#f04b32}.theme-brutalist .code-block pre{border:3px solid #111;border-radius:0;background:#111;color:#f2c94c}.theme-brutalist .note-block{border:3px solid #111;border-left:10px solid #f04b32;border-radius:0;background:#fff}.theme-brutalist .page-ending .page-content-stack{background:#f04b32;color:#fff9df}.theme-brutalist .page-ending .lead,.theme-brutalist .page-ending li,.theme-brutalist .page-ending .content-block h2{color:#111}.theme-brutalist .page-ending li{background:#f2c94c}
body[data-channel="xiaohongshu"] .page{height:500px}
</style></head><body class="${themeClass}" data-visual-style="${theme}" data-channel="${channelMode}">${sections}</body></html>`;
}

function addArtifact(store, batchId, candidateId, kind, filePath) {
  const stat = fs.statSync(filePath);
  store.upsertArtifact({ batchId, candidateId, track:'social_cards', kind, name:path.basename(filePath), path:filePath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
}

async function runAudit(script, htmlPath, reportPath, cwd) {
  try {
    await execFileAsync(process.execPath, [script, htmlPath, '--json', reportPath], { cwd, windowsHide:true, timeout:120000, maxBuffer:2_000_000 });
  } catch (error) {
    if (!fs.existsSync(reportPath)) throw new Error(String(error.stderr || error.stdout || error.message).trim());
  }
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function validateDelivery({ html, plan, copy, report, images }) {
  const pageCount = [...String(html).matchAll(/class=["']([^"']*)["']/gi)]
    .filter((match) => match[1].split(/\s+/).includes('page')).length;
  const planned = Array.isArray(plan) ? plan.length : 0;
  const issues = [];
  if (!report.valid) issues.push('布局审计未通过');
  if (!planned || pageCount !== planned) issues.push(`HTML 页数 ${pageCount} 与规划页数 ${planned} 不一致`);
  if (images.length !== pageCount) issues.push(`PNG 数量 ${images.length} 与页面数 ${pageCount} 不一致`);
  if (!String(copy || '').trim()) issues.push('配套文案为空');
  if (images.some((file) => !fs.existsSync(file) || fs.statSync(file).size === 0)) issues.push('存在空 PNG');
  return { valid:issues.length === 0, issues, pageCount, pngCount:images.length };
}

function eventFactMarkdown(analysis) {
  const facts=analysis.factBase||{},lines=['# 事件图文事实清单','',analysis.eventSummary||'','',
    '## 已确认事实','',...(facts.confirmedFacts||[]).map((item)=>`- ${item.claim}（来源 ${(item.sourceIds||[]).join('、')||'待补'}）`),
    '','## 尚未核实的主张','',...(facts.claims||[]).map((item)=>`- ${item.speaker?`${item.speaker}：`:''}${item.claim}（${item.status||'unverified'}；来源 ${(item.sourceIds||[]).join('、')||'待补'}）`),
    '','## 时间线','',...(facts.timeline||[]).map((item)=>`- ${item.time||'时间待核'}：${item.event}（来源 ${(item.sourceIds||[]).join('、')||'待补'}）`),
    '','## 来源风险与缺口','',...(analysis.sourceAudit?.issues||[]).map((item)=>`- ${item}`),...(analysis.sourceAudit?.neededMaterials||[]).map((item)=>`- 待补：${item}`)];
  return lines.join('\n').trim()+'\n';
}

export async function runSocialCardPipeline({ gateway, store, batchId, candidateId, provider, workspaceRoot, onProgress=()=>{} }) {
  const candidate = store.getCandidate(candidateId);
  if (!candidate || candidate.batch_id !== batchId) throw new Error('候选不存在或不属于当前批次');
  const outputMode=candidate.tracks?.find((item)=>item.track==='social_cards')?.output_mode||'';
  const contentType=outputMode==='wechat-event-cards'?'event':(outputMode==='wechat-custom-cards'||outputMode==='xiaohongshu-custom-cards')?'custom':'repository';
  const channelMode=outputMode.startsWith('xiaohongshu')?'xiaohongshu':'wechat';
  const facts = store.getRepositoryFactSheet(candidateId);
  const eventAnalysisRecord=contentType==='event'?store.getBreakingAnalysis(batchId):null;
  const editorial = store.getCardEditorial(candidateId);
  const gate = contentType==='event'?evaluateEventCardGate(candidate,eventAnalysisRecord,editorial):contentType==='custom'?evaluateCustomCardGate(candidate,facts,editorial):evaluateCardGate(candidate, facts, editorial);
  if (!gate.ready) throw new Error(`卡片故事板尚未就绪：${gate.issues.join('；')}`);
  const batch = store.getBatch(batchId);
  const workdir = candidateSocialCardDir(workspaceRoot, batch, candidate);
  fs.mkdirSync(workdir, { recursive:true });

  const generator = loadSkillBundle({ workspaceRoot, skillName:'xiaohongshu-article-generator' });
  const screenshotSkill = loadSkillBundle({ workspaceRoot, skillName:'html-pages-to-images' });
  if (generator.fallback) throw new Error('项目图文生成技能缺失');
  if (screenshotSkill.fallback) throw new Error('项目 HTML 截图技能缺失');
  const stages = [];
  store.updateCandidateTrack(candidateId, 'social_cards', { status:'drafting' });
  const record = (stage, skill, output, detail='') => {
    const expected = SOCIAL_CARD_STAGE_CONTRACT[stages.length];
    if (!expected || expected.id !== stage || expected.skill !== skill) throw new Error(`图文契约阶段不一致：${stage}/${skill}`);
    stages.push({ stage, skill, skillHash:skill === generator.skillName ? generator.hash : screenshotSkill.hash, output, detail, completedAt:new Date().toISOString() });
    writeFile(path.join(workdir, 'social-card-stage-executions.json'), JSON.stringify(stages, null, 2));
  };
  writeFile(path.join(workdir, 'social-card-skill-manifest.json'), JSON.stringify({
    generator:{ hash:generator.hash, files:generator.files, fallback:generator.fallback },
    screenshots:{ hash:screenshotSkill.hash, files:screenshotSkill.files, fallback:screenshotSkill.fallback },
    loadedAt:new Date().toISOString(),
  }, null, 2));

  onProgress(contentType==='event'?'图文 1/6：读取突发事件事实基座':contentType==='custom'?'图文 1/6：读取自定义事实基座':'图文 1/6：读取已核验仓库事实');
  const factPath = path.join(workdir, 'fact-sheet.md');
  if(contentType==='event')writeFile(factPath,eventFactMarkdown(eventAnalysisRecord.analysis));
  if(contentType==='custom'){
    if(facts?.data?.kind!=='custom')throw new Error('自定义事实基座不存在，请重新创建自定义图文');
    writeFile(factPath,customFactMarkdown(facts.data));
  }
  if (!fs.existsSync(factPath)) throw new Error(contentType==='event'?'事件事实清单不存在，请重新执行突发分析':'fact-sheet.md 不存在，请重新核验仓库');
  record('facts', generator.skillName, factPath);

  let cardPlan = sanitizeCardPlan(JSON.parse(editorial.card_plan_json || '[]'));
  const planPath = path.join(workdir, 'card-plan.json');
  writeFile(planPath, JSON.stringify({ channel_mode:outputMode||editorial.output_mode || 'xiaohongshu', topic:candidate.hotspot_title, pages:cardPlan }, null, 2));
  record('planning', generator.skillName, planPath);

  const { provider:providerConfig } = gateway.resolve(provider);
  const input = {
    channel_mode:outputMode||editorial.output_mode || 'xiaohongshu', topic:candidate.hotspot_title,
    content_type:contentType,custom_content_type:contentType==='custom'?facts.data.content_type:undefined,source_url:contentType==='event'?(eventAnalysisRecord.analysis.sources||[]).map((item)=>item.url):contentType==='custom'?(facts.data.materials||[]).map((item)=>item.url):facts.source_url,
    repository_facts:contentType==='repository'?facts.data:undefined,event_analysis:contentType==='event'?eventAnalysisRecord.analysis:undefined,custom_facts:contentType==='custom'?facts.data:undefined,
    editorial_decisions:editorial,card_plan:cardPlan,
    disclosure:contentType==='event'?'据公开素材整理；未核实主张必须保留边界表达':contentType==='custom'?'体验性表述来自作者确认；建议性内容未实测':'基于项目文档整理，未实际运行', workdir,
  };
  onProgress('图文 2/6：按项目技能生成配套文案');
  const copyResult = await gateway.complete({ provider, purpose:'social-card-copy', batchId, candidateId,
    maxOutputTokens:Math.min(2400, providerConfig.maxOutputTokens), messages:[
      { role:'system', protected:true, content:`${generator.prompt}\n\n## 当前运行阶段\n只生成可直接发布的配套文案。输出纯文本，不要 JSON、Markdown 围栏、页码或布局指令；严格遵守事实与禁用表达。${contentType==='event'?' 未核实主张必须注明说话者和“尚未获独立证实”等边界；不得号召网暴或把争议定性为事实。':''}${contentType==='custom'?' 体验性表述只能来自 source_level=author_experience 的要点；user_material 必须保留来源归属；model_suggestion 只能写成建议或参考，禁止写成亲测、效果或收益。':''}` },
      { role:'user', protected:true, content:JSON.stringify(input) },
    ] });
  let copy = String(copyResult.content || '').trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '');

  onProgress('图文 2.5/6：按技能布局契约组装逐页 HTML');
  let html = renderStoryboardHtml({ topic:candidate.hotspot_title, repository:facts?.data?.repository, pages:cardPlan, visualStyle:editorial.visual_style,
    contentType,channelMode,sourceLabel:contentType==='event'?'突发专题':contentType==='custom'?facts?.data?.content_type_label||'自定义':'',disclosure:contentType==='event'?'据公开素材整理 · 未核实内容已标注':'' });
  if (!copy || !/<html\b/i.test(html) || !/class=["'][^"']*\bpage\b/i.test(html)) throw new Error('图文生成产物缺少文案、完整 HTML 或 .page');
  const copyPath = path.join(workdir, 'copy.txt');
  const htmlPath = path.join(workdir, 'my-design.html');
  writeFile(copyPath, copy); writeFile(htmlPath, html);
  record('generation', generator.skillName, [copyPath, htmlPath]);

  const auditScript = path.join(workspaceRoot, 'skills', 'xiaohongshu-article-generator', 'scripts', 'layout-audit.mjs');
  const reportPath = path.join(workdir, 'layout-report.json');
  let report;
  let repairCount = 0;
  const initialPageCount = cardPlan.length;
  for (let attempt=0; attempt<4; attempt += 1) {
    onProgress(`图文 3/6：浏览器布局审计${attempt ? `与第 ${attempt} 轮修复` : ''}`);
    report = await runAudit(auditScript, htmlPath, reportPath, workdir);
    if (report.valid) break;
    if (attempt === 3) throw new Error(`布局审计三轮修复后仍未通过：${report.pages.filter((page)=>!page.valid).map((page)=>`P${page.page} ${page.issues.join('/')}`).join('；')}`);
    repairCount += 1;
    const repair = await gateway.complete({ provider, purpose:'social-card-layout-repair', batchId, candidateId,
      maxOutputTokens:Math.min(8000, providerConfig.maxOutputTokens), messages:[
        { role:'system', protected:true, content:`${generator.prompt}\n\n当前是布局修复阶段。只根据布局审计报告调整 card_plan 的内容规划，保持事实、标题、页数和页面顺序不变。禁止输出 HTML、CSS、解释或任何非 JSON 内容。\n\n按问题类型调整：\n- underfilled：补充该页的事实细节、增加要点或例子，让内容更充实；不要缩小字号。\n- overfilled：精简过长要点、减少单页内容块数量、缩短标题或正文；不要拆页。\n- overflow/clipped：减少内容或拆段，确保内容适合单页。\n- invalid_page_grid_structure/missing_content_stack/empty_page_body：确保每页都有 title，内容页尽量同时提供 goal 与 content_blocks 或 evidence。\n\n禁止：隐藏溢出、缩放、伪元素、空白卡、space-between、小于 11px 正文、把指令性描述（如"让读者一眼知道"）写入内容字段。\n\n只输出 JSON：可以直接是 card_plan 数组，也可以是包含 card_plan 字段的对象。` },
        { role:'user', protected:true, content:JSON.stringify({ report, card_plan:cardPlan, copy, topic:candidate.hotspot_title, content_type:contentType }) },
      ] });
    let repairJson;
    try {
      repairJson = cleanCardPlanJson(repair.content);
    } catch (error) {
      throw new Error(`第 ${attempt + 1} 轮布局修复返回的 JSON 无法解析：${error.message}`);
    }
    const newPlan = sanitizeCardPlan(Array.isArray(repairJson) ? repairJson : repairJson.card_plan);
    if (!Array.isArray(newPlan) || newPlan.length !== initialPageCount) {
      throw new Error(`第 ${attempt + 1} 轮布局修复返回的页数（${Array.isArray(newPlan) ? newPlan.length : '非数组'}）与原规划（${initialPageCount}）不一致`);
    }
    cardPlan = newPlan;
    writeFile(planPath, JSON.stringify({ channel_mode:editorial.output_mode || 'xiaohongshu', topic:candidate.hotspot_title, pages:cardPlan }, null, 2));
    html = renderStoryboardHtml({ topic:candidate.hotspot_title, repository:facts?.data?.repository, pages:cardPlan, visualStyle:editorial.visual_style,
      contentType, channelMode, sourceLabel:contentType==='event'?'突发专题':contentType==='custom'?facts?.data?.content_type_label||'自定义':'', disclosure:contentType==='event'?'据公开素材整理 · 未核实内容已标注':'' });
    writeFile(htmlPath, html);
  }
  record('layout-audit', generator.skillName, reportPath, `修复轮次：${repairCount}`);

  onProgress('图文 4/6：逐页生成高清 PNG');
  const outputDir = path.join(workdir, 'output');
  fs.mkdirSync(outputDir, { recursive:true });
  for (const file of fs.readdirSync(outputDir).filter((name)=>/\.png$/i.test(name))) {
    fs.unlinkSync(path.join(outputDir, file));
  }
  const screenshotModule = path.join(workspaceRoot, 'skills', 'html-pages-to-images', 'index.js');
  const { execute } = await import(`${pathToFileURL(screenshotModule).href}?v=${Date.now()}`);
  // 小红书页型为 3:4（375×500），公众号保持 9:16（375×667），与渲染分支的 CSS 覆盖一致
  const screenshotSize=channelMode==='xiaohongshu'?{ pageWidth:375, pageHeight:500 }:{ pageWidth:375, pageHeight:667 };
  const screenshotResult = await execute({ htmlFile:htmlPath, outputDir, selector:'.page', ...screenshotSize, deviceScaleFactor:3 });
  if (!screenshotResult.success) throw new Error(screenshotResult.message);
  const images = screenshotResult.data.images.map((item) => typeof item === 'string' ? item : item.path || item.filePath).filter(Boolean);
  record('screenshots', screenshotSkill.skillName, images);

  onProgress('图文 5/6：执行产物一致性门禁');
  const delivery = validateDelivery({ html:fs.readFileSync(htmlPath, 'utf8'), plan:cardPlan, copy, report, images });
  const deliveryPath = path.join(workdir, 'delivery-report.json');
  writeFile(deliveryPath, JSON.stringify(delivery, null, 2));
  if (!delivery.valid) throw new Error(`图文交付门禁未通过：${delivery.issues.join('；')}`);
  record('delivery-gate', generator.skillName, deliveryPath);

  for (const [kind, file] of [['图文事实清单',factPath],['图文卡片规划',planPath],['图文配套文案',copyPath],['图文设计 HTML',htmlPath],['图文布局审计',reportPath],['图文交付报告',deliveryPath]]) addArtifact(store,batchId,candidateId,kind,file);
  for (const image of images) addArtifact(store,batchId,candidateId,'图文卡片 PNG',image);
  store.updateCandidateTrack(candidateId, 'social_cards', { status:'completed' });
  onProgress(`图文 6/6：完成，共生成 ${images.length} 张卡片`);
  return { workdir, copy:copyPath, html:htmlPath, layoutReport:reportPath, deliveryReport:deliveryPath, images, pageCount:images.length };
}
