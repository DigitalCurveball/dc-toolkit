import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test("the source and tests type-check, and defineSite()'s types accept what defineConfig does and refuse bad options", () => {
  const tsc = spawnSync('node_modules/.bin/tsc', ['-p', 'test/types/tsconfig.json'], { encoding: 'utf8' });
  assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);
});
