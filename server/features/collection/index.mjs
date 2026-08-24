// 内容采集业务垂直入口。
// 采集器本身属于基础设施/插件层，批次业务只从这里取得统一质量规则。
export { filterCollectedItems, hasMeaningfulCollectedContent } from './domain/collection-quality.mjs';
export { CollectionSourceService, sourceInputForPlugin } from './application/source-service.mjs';
export { CollectionRunner } from './application/collection-runner.mjs';
export { createStoreCollectionRunner } from './application/store-collection-runner.mjs';
export { analyzeStaticPage, assistStaticPage } from './application/static-page-assistant.mjs';
export { addSubscription, listSubscriptions, removeSubscription, subscriptionTestInput, updateSubscription } from './application/subscriptions.mjs';
export { CollectionJobManager } from './application/collection-job-manager.mjs';
