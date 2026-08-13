import { collectFeed, testFeedSubscription } from './collector.mjs';
import { ok } from './result.mjs';

export function createAdapter({ onProgress = () => {}, configuration = {} } = {}) {
  return {
    test: (source) => testFeedSubscription(source.url),
    collect: async (source) => ok(await collectFeed(source, configuration, onProgress), { fetchMethod: 'feed' }),
  };
}
