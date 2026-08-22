import { summarizeSocialTemplateExtensionGate } from '../../rendering/social-template-extension-gate.mjs';

function json(value, fallback) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}

export class SocialTemplateProposalMetricsRepository {
  constructor(db) { this.db = db; }

  record(input = {}) {
    const operation = ['generated', 'compiled', 'confirmed', 'rejected'].includes(input.operation) ? input.operation : 'rejected';
    const failedRoles = Array.isArray(input.failedRoles) ? input.failedRoles : [];
    const issues = Array.isArray(input.issues) ? input.issues : [];
    const result = this.db.prepare(`INSERT INTO social_template_proposal_metrics
      (operation,proposal_id,candidate_id,template_pack_id,theme_id,production_eligible,audit_valid,
       failed_roles_json,issues_json,issue_count,page_count,underfilled_pages,overflow_pages,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      operation, String(input.proposalId || ''), String(input.candidateId || ''), String(input.templatePackId || ''), String(input.themeId || ''),
      input.productionEligible == null ? null : (input.productionEligible ? 1 : 0), input.auditValid == null ? null : (input.auditValid ? 1 : 0),
      JSON.stringify(failedRoles), JSON.stringify(issues), Number(input.issueCount ?? issues.length) || 0, Number(input.pageCount || 0),
      Number(input.underfilledPages || 0), Number(input.overflowPages || 0), input.recordedAt || new Date().toISOString(),
    );
    return result.lastInsertRowid;
  }

  list({ templatePackId = null, limit = 5000 } = {}) {
    const where = [], params = [];
    if (templatePackId) { where.push('template_pack_id=?'); params.push(String(templatePackId)); }
    params.push(Math.max(1, Math.min(5000, Number(limit) || 5000)));
    return this.db.prepare(`SELECT * FROM social_template_proposal_metrics ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...params).map((row) => ({
      ...row,
      productionEligible: row.production_eligible == null ? null : Number(row.production_eligible) !== 0,
      auditValid: row.audit_valid == null ? null : Number(row.audit_valid) !== 0,
      failedRoles: json(row.failed_roles_json, []),
      issues: json(row.issues_json, []),
    }));
  }

  stats({ templatePackId = null } = {}) {
    const rows = this.list({ templatePackId });
    const count = (operation) => rows.filter((row) => row.operation === operation).length;
    const generatedCount = count('generated');
    const compiledRows = rows.filter((row) => row.operation === 'compiled');
    const confirmedCount = count('confirmed');
    const rejectedCount = count('rejected');
    const auditPassedCount = compiledRows.filter((row) => row.auditValid === true && row.productionEligible === true).length;
    const eligibleCount = rows.filter((row) => row.productionEligible === true).length;
    const proposalUnderfilledPages = rows.reduce((sum, row) => sum + Number(row.underfilled_pages || 0), 0);
    const proposalOverflowPages = rows.reduce((sum, row) => sum + Number(row.overflow_pages || 0), 0);
    const proposalPageSamples = rows.reduce((sum, row) => sum + Number(row.page_count || 0), 0);
    const renderedRows = templatePackId
      ? this.db.prepare('SELECT page_count,underfilled_pages,overflow_pages FROM social_template_metrics WHERE requested_template_id=?').all(String(templatePackId))
      : [];
    const underfilledPages = proposalUnderfilledPages + renderedRows.reduce((sum, row) => sum + Number(row.underfilled_pages || 0), 0);
    const overflowPages = proposalOverflowPages + renderedRows.reduce((sum, row) => sum + Number(row.overflow_pages || 0), 0);
    const pageSamples = proposalPageSamples + renderedRows.reduce((sum, row) => sum + Number(row.page_count || 0), 0);
    const failedRoles = {};
    for (const row of rows) for (const role of row.failedRoles || []) failedRoles[role] = (failedRoles[role] || 0) + 1;
    return {
      templatePackId: templatePackId || null,
      generatedCount,
      compiledCount: compiledRows.length,
      confirmedCount,
      rejectedCount,
      acceptanceRate: generatedCount ? confirmedCount / generatedCount : null,
      compilePassRate: compiledRows.length ? auditPassedCount / compiledRows.length : null,
      productionEligibleRate: compiledRows.length ? eligibleCount / compiledRows.length : null,
      failedRoles,
      underfilledPages,
      overflowPages,
      underfilledRate: pageSamples ? underfilledPages / pageSamples : null,
      overflowRate: pageSamples ? overflowPages / pageSamples : null,
      extensionGate: summarizeSocialTemplateExtensionGate(rows),
    };
  }
}
