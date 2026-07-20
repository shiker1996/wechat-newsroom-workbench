import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../lib/env.mjs';

test('解析 dotenv 常见写法且不误读注释', () => {
  assert.deepEqual(parseEnv(`
# comment
DEEPSEEK_API_KEY=sk-test
MINIMAX_API_KEY="quoted=value"
export MOONSHOT_API_KEY='moon key'
EMPTY= # inline comment
INVALID LINE
`), {
    DEEPSEEK_API_KEY: 'sk-test',
    MINIMAX_API_KEY: 'quoted=value',
    MOONSHOT_API_KEY: 'moon key',
    EMPTY: '',
  });
});
