import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentPage } from '../src/paths.ts';
import { parseBold, parseCopy, plainCopy, telHref } from '../src/text.ts';

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

test('telHref writes an Australian number as written in international form', () => {
  assert.equal(telHref('0491 570 156'), 'tel:+61491570156');
  assert.equal(telHref('(03) 5550 1234'), 'tel:+61355501234');
  assert.equal(telHref('+61 3 5550 1234'), 'tel:+61355501234');
});

test('parseCopy makes links, bold, the phone number and the email address into parts', () => {
  const phone = '0491 570 156';
  const email = 'hello@example.com';
  assert.deepEqual(parseCopy('Have a look at our [projects](/projects/), or **ring me**.'), [
    { text: 'Have a look at our ', bold: false },
    { text: 'projects', bold: false, href: '/projects/' },
    { text: ', or ', bold: false },
    { text: 'ring me', bold: true },
    { text: '.', bold: false },
  ]);
  assert.deepEqual(parseCopy(`Ring me on ${phone} or email ${email}.`, { phone, email }), [
    { text: 'Ring me on ', bold: false },
    { text: phone, bold: false, href: 'tel:+61491570156' },
    { text: ' or email ', bold: false },
    { text: email, bold: false, email: true },
    { text: '.', bold: false },
  ]);
  // A number with the characters a pattern treats specially is matched as written.
  assert.deepEqual(parseCopy('**Call (03) 5550 1234**', { phone: '(03) 5550 1234' }), [
    { text: 'Call ', bold: true },
    { text: '(03) 5550 1234', bold: true, href: 'tel:+61355501234' },
  ]);
  // Nothing to find: the line as it is.
  assert.deepEqual(parseCopy('Plain words.', { phone }), [{ text: 'Plain words.', bold: false }]);
});

test('plainCopy drops the marks', () => {
  assert.equal(plainCopy('**Kept:** the [arch](/projects/a/) and the cornice'), 'Kept: the arch and the cornice');
});
