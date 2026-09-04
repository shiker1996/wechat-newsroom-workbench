// src/core/state.js — 共享状态（前端双轨收敛后由本模块统一创建）
export const state = {
  overview: null, batches: [], currentBatch: null, activeBatchId: null, candidates: [], documents: [], models: null, jobTimer: null,
  atlas: null, atlasMode: 'hotlist', atlasInsightTab: 'relations', atlasFilters: { scope: '全部', multi: false, query: '', contentClass: 'news_event' }, atlasSelectedWord: null, productionPreview: null, imageWorkspace: null,
  subscriptions: null, subscriptionFilter: 'all',
  // 素材入箱 → 自主写作的临时选择；成文时服务端仍按 ID 重新读取。
  pendingIndependentWritingMaterials: [],
  pendingIndependentWritingBriefId: null,
  // 素材入箱 → 自定义图文的临时选择（可携带已确认简报）。
  pendingCustomSocialMaterials: [],
  pendingCustomSocialBriefId: null,
};
