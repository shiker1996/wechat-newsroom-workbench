import { aggregateSocialTemplateMetrics, buildSocialTemplateCalibrationReport, classifySocialTemplateFallbackKind } from '../../rendering/social-card-template-metrics.mjs';
import { buildSocialCardPlanRolloutReport } from '../../rendering/social-card-plan-rollout.mjs';

function json(value, fallback) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}

export class SocialTemplateMetricsRepository {
  constructor(db) { this.db = db; }

  record(input = {}) {
    const requested = input.requestedTemplate || {};
    const rendered = input.renderedTemplate || {};
    const result = this.db.prepare(`INSERT INTO social_template_metrics
      (operation,success,requested_template_id,requested_template_version,requested_template_source,
       rendered_template_id,rendered_template_version,rendered_template_source,channel_mode,content_type,theme_id,
       batch_id,candidate_row_id,page_count,layout_pass,fallback,underfilled_pages,overflow_pages,edit_mode,target_page,
       page_roles_json,structural_reflow_attempted,structural_reflow_success,structure_repair_count,text_repair_count,content_plan_adjustment_count,
       pages_added,pages_split,pages_merged,blocks_moved,fact_blocks_added,plan_operation_counts_json,source_atom_loss_count,avg_utilization,rollout_profile_json,
       no_op_repair,hard_gate_failure,joint_packing_audit_attempts,joint_packing_mismatch_count,joint_packing_browser_only_overflow,joint_packing_static_only_overflow,joint_packing_mean_delta,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.operation === 'page-regeneration' ? 'page-regeneration' : 'generation', input.success === false ? 0 : 1,
      String(requested.id || ''), requested.version == null ? null : String(requested.version), String(requested.source || ''),
      String(rendered.id || ''), rendered.version == null ? null : String(rendered.version), String(rendered.source || ''),
      String(input.channelMode || 'wechat'), String(input.contentType || 'repository'), String(input.themeId || ''), input.batchId || null, input.candidateId || null,
      Number.isFinite(Number(input.pageCount)) ? Number(input.pageCount) : 0, input.layoutPass == null ? null : (input.layoutPass ? 1 : 0),
      input.fallback ? 1 : 0, Number(input.underfilledPages || 0), Number(input.overflowPages || 0), String(input.editMode || ''),
      input.targetPage == null ? null : Number(input.targetPage), JSON.stringify(input.pageRoleStats && typeof input.pageRoleStats === 'object' ? input.pageRoleStats : {}),
      input.structuralReflowAttempted ? 1 : 0, input.structuralReflowSuccess ? 1 : 0, Number(input.structureRepairCount || 0), Number(input.textRepairCount || 0), Number(input.contentPlanAdjustmentCount || 0),
      Number(input.pagesAdded || 0), Number(input.pagesSplit || 0), Number(input.pagesMerged || 0), Number(input.blocksMoved || 0), Number(input.factBlocksAdded || 0), JSON.stringify(input.planOperationCounts && typeof input.planOperationCounts === 'object' ? input.planOperationCounts : {}), Number(input.sourceAtomLossCount || 0), Number.isFinite(Number(input.avgUtilization)) ? Number(input.avgUtilization) : null, JSON.stringify(input.rolloutProfile && typeof input.rolloutProfile === 'object' ? input.rolloutProfile : {}),
      input.noOpRepair ? 1 : 0, input.hardGateFailure ? 1 : 0,
      Number(input.jointPackingAuditAttempts || 0), Number(input.jointPackingMismatchCount || 0), Number(input.jointPackingBrowserOnlyOverflowPages || 0), Number(input.jointPackingStaticOnlyOverflowPages || 0), Number.isFinite(Number(input.jointPackingMeanAbsoluteUtilizationDelta)) ? Number(input.jointPackingMeanAbsoluteUtilizationDelta) : null,
      input.recordedAt || new Date().toISOString(),
    );
    return result.lastInsertRowid;
  }

  list({ templatePackId = null, operation = null, limit = 500 } = {}) {
    const where = [], params = [];
    if (templatePackId) { where.push('requested_template_id=?'); params.push(templatePackId); }
    if (operation) { where.push('operation=?'); params.push(operation); }
    params.push(Math.max(1, Math.min(5000, Number(limit) || 500)));
    return this.db.prepare(`SELECT * FROM social_template_metrics ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...params).map((row) => ({
      ...row,
      pageCount: Number(row.page_count || 0),
      layoutPass: row.layout_pass == null ? null : Number(row.layout_pass) !== 0,
      underfilledPages: Number(row.underfilled_pages || 0),
      overflowPages: Number(row.overflow_pages || 0),
      fallback: Number(row.fallback) !== 0,
      operation: row.operation,
      pageRoleStats: json(row.page_roles_json, {}),
      themeId: row.theme_id || '',
      structuralReflowAttempted: Number(row.structural_reflow_attempted) !== 0,
      structuralReflowSuccess: Number(row.structural_reflow_success) !== 0,
      structureRepairCount: Number(row.structure_repair_count || 0),
      textRepairCount: Number(row.text_repair_count || 0),
      contentPlanAdjustmentCount: Number(row.content_plan_adjustment_count || 0),
      pagesAdded: Number(row.pages_added || 0),
      pagesSplit: Number(row.pages_split || 0),
      pagesMerged: Number(row.pages_merged || 0),
      blocksMoved: Number(row.blocks_moved || 0),
      factBlocksAdded: Number(row.fact_blocks_added || 0),
      planOperationCounts: json(row.plan_operation_counts_json, {}),
      sourceAtomLossCount: Number(row.source_atom_loss_count || 0),
      avgUtilization: row.avg_utilization == null ? null : Number(row.avg_utilization),
      rolloutProfile: json(row.rollout_profile_json, {}),
      noOpRepair: Number(row.no_op_repair) !== 0,
      hardGateFailure: Number(row.hard_gate_failure) !== 0,
      jointPackingAuditAttempts: Number(row.joint_packing_audit_attempts || 0),
      jointPackingMismatchCount: Number(row.joint_packing_mismatch_count || 0),
      jointPackingBrowserOnlyOverflowPages: Number(row.joint_packing_browser_only_overflow || 0),
      jointPackingStaticOnlyOverflowPages: Number(row.joint_packing_static_only_overflow || 0),
      jointPackingMeanAbsoluteUtilizationDelta: row.joint_packing_mean_delta == null ? null : Number(row.joint_packing_mean_delta),
      fallbackKind: classifySocialTemplateFallbackKind({
        requestedTemplate: { id: row.requested_template_id, version: row.requested_template_version, source: row.requested_template_source },
        renderedTemplate: { id: row.rendered_template_id, version: row.rendered_template_version, source: row.rendered_template_source },
        source: row.rendered_template_source || row.requested_template_source || '',
        fallback: Number(row.fallback) !== 0,
      }),
    }));
  }

  stats({ templatePackId = null, themeId = null, pageRole = null } = {}) {
    const rows = this.list({ templatePackId, limit: 5000 }).filter((row) => !themeId || row.themeId === String(themeId));
    const aggregate = aggregateSocialTemplateMetrics(rows);
    const totalRows = this.list({ limit: 5000 });
    const totalGenerations = totalRows.filter((row) => row.operation === 'generation').length;
    return {
      ...aggregate,
      templatePackId: templatePackId || null,
      themeId: themeId || null,
      usageRate: aggregate.usageCount && totalGenerations ? aggregate.usageCount / totalGenerations : null,
      calibration: buildSocialTemplateCalibrationReport(rows, { minSamples: 3 }),
      rollout: buildSocialCardPlanRolloutReport(rows, { minSamples: 3 }),
      role: pageRole || null,
      roleDimensions: pageRole ? buildSocialTemplateCalibrationReport(rows, { minSamples: 3 }).dimensions.filter((item) => item.role === pageRole) : buildSocialTemplateCalibrationReport(rows, { minSamples: 3 }).dimensions,
    };
  }
}
