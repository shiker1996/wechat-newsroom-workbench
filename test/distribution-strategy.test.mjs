import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceNotificationQuota, isConcreteReaderStake, normalizeDistributionLane, resolveDistributionDecision, resolveNotificationPolicy } from '../lib/domain/distribution-strategy.mjs';

test('分发池只接受三个固定值', () => {
  assert.equal(normalizeDistributionLane('通知池'), '通知池');
  assert.equal(normalizeDistributionLane('未知池'), '推荐池');
});

test('通知池要求具体读者动作、适配分、事实支持与低风险同时达标', () => {
  const vague = resolveDistributionDecision({ distributionLane:'通知池', readerStake:'影响开发者岗位选择', notificationFit:5, factSupport:5, riskLevel:'低' });
  assert.equal(vague.distributionLane, '实验池');
  assert.ok(vague.notificationBlockers.includes('reader-stake-not-specific'));
  const concreteStake = '使用旧接口的开发者必须在8月前迁移，否则发布流程会中断并增加维护成本';
  assert.equal(isConcreteReaderStake(concreteStake), true);
  assert.equal(resolveDistributionDecision({ distributionLane:'通知池', readerStake:concreteStake, notificationFit:3, factSupport:5, riskLevel:'低' }).distributionLane, '实验池');
  assert.equal(resolveDistributionDecision({ distributionLane:'通知池', readerStake:concreteStake, notificationFit:5, factSupport:3, riskLevel:'低' }).distributionLane, '实验池');
  assert.equal(resolveDistributionDecision({ distributionLane:'通知池', readerStake:concreteStake, notificationFit:5, factSupport:5, riskLevel:'高' }).distributionLane, '实验池');
  const qualified = resolveDistributionDecision({ distributionLane:'通知池', readerStake:concreteStake, notificationFit:4, factSupport:4, riskLevel:'低' });
  assert.equal(qualified.distributionLane, '通知池');
  assert.equal(qualified.notificationEligible, true);
  assert.deepEqual(qualified.notificationBlockers, []);
});

test('传闻和待核事实不能进入通知池', () => {
  const result = resolveDistributionDecision({ distributionLane:'通知池', readerStake:'平台开发者必须迁移接口，否则发布会中断并增加成本',
    notificationFit:5, factSupport:5, riskLevel:'低', materialGaps:'需要官方确认离职传闻' });
  assert.equal(result.distributionLane, '实验池');
  assert.ok(result.notificationBlockers.includes('material-uncertainty'));
});

test('高风险或明确传闻即使请求推荐池也强制进入实验池', () => {
  assert.equal(resolveDistributionDecision({ distributionLane:'推荐池', riskLevel:'高' }).distributionLane, '实验池');
  assert.equal(resolveDistributionDecision({ distributionLane:'推荐池', riskLevel:'低', title:'某高管离职传闻' }).distributionLane, '实验池');
  assert.equal(resolveDistributionDecision({ distributionLane:'推荐池', riskLevel:'低', materialGaps:'一般数据待核验' }).distributionLane, '推荐池');
});

test('通知池每批最多两条且允许配置为空', () => {
  const items = [1,2,3].map((id) => ({ candidateId:`C${id}`, distributionLane:'通知池', notificationEligible:true, notificationBlockers:[] }));
  const limited = enforceNotificationQuota(items, { maxPerBatch:2 });
  assert.deepEqual(limited.map((item) => item.distributionLane), ['通知池','通知池','实验池']);
  assert.ok(limited[2].notificationBlockers.includes('batch-notification-quota'));
  assert.equal(enforceNotificationQuota(items, { maxPerBatch:0 }).every((item) => item.distributionLane === '实验池'), true);
  assert.equal(resolveNotificationPolicy({ notificationPolicy:{ maxPerBatch:1 } }).maxPerBatch, 1);
});
