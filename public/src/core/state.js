// src/core/state.js — 共享状态
export const state = {
  overview: null, batches: [], currentBatch: null, activeBatchId: null,
  candidates: [], documents: [], models: null, jobTimer: null,
  atlas: null, atlasFilters: { scope: "全部", category: "全部", multi: false, query: "" },
  atlasSelectedWord: null, productionPreview: null, imageWorkspace: null,
  subscriptions: null, subscriptionFilter: "all",
  calYear: null, calMonth: null, editorialCandidate: null,
  rankingItems: null,
};