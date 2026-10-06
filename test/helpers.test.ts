import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentPage } from '../src/paths.ts';
import { parseBold } from '../src/text.ts';

test('isCurrentPage matches whole site paths, with or without the slash', () => {
  assert.equal(isCurrentPage('/about/', '/about'), true);
  assert.equal(isCurrentPage('/about', '/about/'), true);
  assert.equal(isCurrentPage('/', '/'), true);
  assert.equal(isCurrentPage('/about/', '/'), false);
  assert.equal(isCurrentPage('/#about', '/'), false);
  assert.equal(isCurrentPage('#', '/'), false);
  assert.equal(isCurrentPage('https://example.com/', '/'), false);
});

test('parseBold splits on **bold** and drops empty parts', () => {
  assert.deepEqual(parseBold('a **b** c'), [
    { text: 'a ', bold: false },
    { text: 'b', bold: true },
    { text: ' c', bold: false },
  ]);
  assert.deepEqual(parseBold('**all**'), [{ text: 'all', bold: true }]);
  assert.deepEqual(parseBold('none'), [{ text: 'none', bold: false }]);
});
