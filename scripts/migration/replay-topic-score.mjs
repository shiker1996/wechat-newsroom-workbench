import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 离线回放工具：只读取历史候选快照，不参与生产研究管线。
export function buildScoreDualRun(scored = [], { draftFloor = 55 } = {}) {
  const byLegacy = [...scored].sort((a, b) => Number(b.a || 0) - Number(b.s || 0) - Number(b.d || 0) - (Number(a.a || 0) - Number(a.s || 0) - Number(a.d || 0)) || String(a.candidateId).localeCompare(String(b.candidateId)));
  const legacyRank = new Map(byLegacy.map((item, index) => [item.candidateId, index + 1]));
  const items = scored.map((item) => {
    const legacyF = Number(Math.max(0, Math.min(100, Number(item.a || 0) - Number(item.s || 0) - Number(item.d || 0))).toFixed(1));
    const currentF = Number(Number(item.f || 0).toFixed(1));
    const t = Number(item.eventValue ?? item.t ?? 0);
    const a = Number(item.a || 0);
    const flags = [];
    if (t >= 70 && a < 55) flags.push('high_t_low_a');
    if (t < 50 && a >= 70) flags.push('low_t_high_a');
    if (Number(item.d || 0) >= 10) flags.push('repeat_penalty');
    if (!String(item.readerStake || '').trim()) flags.push('reader_stake_missing');
    return { candidateId: item.candidateId, title: item.source?.title || '', t, a, legacyF, currentF,
      delta: Number((currentF - legacyF).toFixed(1)), legacyRank: legacyRank.get(item.candidateId) || null,
      currentRank: item.finalRank || null, legacyDraftable: legacyF >= draftFloor, currentDraftable: currentF >= draftFloor, flags };
  });
  const mean = (values) => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : 0;
  const deltas = items.map((item) => item.delta);
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), formula: { legacy: 'F_legacy = A - S - D', current: 'F = A×(1-eventValueWeight) + T×eventValueWeight - S - D' }, draftFloor,
    summary: { candidateCount: items.length, legacyDraftableCount: items.filter((item) => item.legacyDraftable).length,
      currentDraftableCount: items.filter((item) => item.currentDraftable).length, poolChangedCount: items.filter((item) => item.legacyDraftable !== item.currentDraftable).length,
      rankChangedCount: items.filter((item) => item.legacyRank !== item.currentRank).length, meanDelta: mean(deltas),
      highTLowACount: items.filter((item) => item.flags.includes('high_t_low_a')).length, lowTHighACount: items.filter((item) => item.flags.includes('low_t_high_a')).length,
      repeatPenaltyCount: items.filter((item) => item.flags.includes('repeat_penalty')).length, readerStakeMissingCount: items.filter((item) => item.flags.includes('reader_stake_missing')).length }, items };
}

export function markdownScoreDualRun(dualRun) {
  const s = dualRun.summary;
  return `# 选题评分新旧公式双跑审计\n\n> 本文件只用于历史快照回放和运营校准，不改变生产批次的排序或入池结果。\n\n- 旧公式：${dualRun.formula.legacy}\n- 新公式：${dualRun.formula.current}\n- 成稿线：F ≥ ${dualRun.draftFloor}\n\n| 候选数 | 旧公式达线 | 新公式达线 | 入池变化 | 排名变化 | 平均分差（新−旧） |\n|---:|---:|---:|---:|---:|---:|\n| ${s.candidateCount} | ${s.legacyDraftableCount} | ${s.currentDraftableCount} | ${s.poolChangedCount} | ${s.rankChangedCount} | ${s.meanDelta} |\n\n| 候选 | 选题 | T | A | 旧 F | 新 F | Δ | 旧排名 | 新排名 | 旧达线 | 新达线 | 样本标签 |\n|---|---|---:|---:|---:|---:|---:|---:|---:|:---:|:---:|---|\n${dualRun.items.map((item) => `| ${item.candidateId} | ${String(item.title).replace(/\|/g, '/')} | ${item.t} | ${item.a} | ${item.legacyF} | ${item.currentF} | ${item.delta} | ${item.legacyRank ?? '—'} | ${item.currentRank ?? '—'} | ${item.legacyDraftable ? '是' : '否'} | ${item.currentDraftable ? '是' : '否'} | ${item.flags.join('、') || '—'} |`).join('\n')}`;
}

function runCli() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('用法：node scripts/migration/replay-topic-score.mjs <scored-snapshot.json> [output.json]');
  const payload = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const report = buildScoreDualRun(Array.isArray(payload) ? payload : payload.items || []);
  const outputPath = path.resolve(process.argv[3] || `${inputPath}.dual-run.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`${outputPath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) runCli();
