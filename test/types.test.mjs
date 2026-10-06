import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test("defineSite()'s types accept what Astro's defineConfig accepts, and refuse bad options", () => {
  const tsc = spawnSync('node_modules/.bin/tsc', ['-p', 'test/types/tsconfig.json'], { encoding: 'utf8' });
  assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);
});
