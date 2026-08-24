import test from 'node:test';
import assert from 'node:assert/strict';
import { outputBudgetFor } from '../server/platform/llm/output-budget.mjs';

test('output budget uses stage profile and provider capability ceiling', () => {
  assert.deepEqual(
    outputBudgetFor({ purpose: 'article-planning', providerMax: 102400 }),
    { initial: 6000, retry: 10000, adaptive: true, providerMax: 102400 },
  );
  assert.deepEqual(
    outputBudgetFor({ purpose: 'article-planning', providerMax: 8192 }),
    { initial: 6000, retry: 8192, adaptive: true, providerMax: 8192 },
  );
});

test('chunked tasks and explicitly fixed requests do not retry', () => {
  assert.deepEqual(
    outputBudgetFor({ purpose: 'event-card-generation', providerMax: 8192, requested: 2500 }),
    { initial: 2500, retry: 2500, adaptive: false, providerMax: 8192 },
  );
  assert.deepEqual(
    outputBudgetFor({ purpose: 'connection-test', providerMax: 8192, requested: 16, adaptive: false }),
    { initial: 16, retry: 16, adaptive: false, providerMax: 8192 },
  );
});

test('caller output cap overrides a larger purpose profile',()=>{
  assert.deepEqual(
    outputBudgetFor({purpose:'article-planning',providerMax:12000,requested:2400}),
    {initial:2400,retry:2400,adaptive:false,providerMax:12000},
  );
});
