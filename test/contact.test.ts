import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HONEYPOT, LIMITS, contactEmail, parseContactForm } from '../src/contact.ts';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  const all = { name: 'Ada', email: 'ada@example.com', message: 'Hello', 'cf-turnstile-response': 'token', ...fields };
  for (const [key, value] of Object.entries(all)) data.set(key, value);
  return data;
};

test('a good message parses', () => {
  assert.deepEqual(parseContactForm(form({})), {
    kind: 'ok',
    message: { name: 'Ada', email: 'ada@example.com', message: 'Hello' },
    token: 'token',
  });
});

test('a filled honeypot is caught before anything else', () => {
  assert.deepEqual(parseContactForm(form({ [HONEYPOT]: 'x', name: '' })), { kind: 'honeypot' });
});

test('header injection through the name or the address is refused', () => {
  const attempts: Record<string, string>[] = [
    { name: 'Ada\nBcc: x@example.com' },
    { email: 'ada@example.com\nBcc: x@example.com' },
    { email: 'ada@example.com, x@example.com' },
    { email: 'Ada <ada@example.com>' },
    { email: '"ada"@example.com' },
  ];
  for (const fields of attempts) {
    assert.deepEqual(parseContactForm(form(fields)), { kind: 'invalid' }, JSON.stringify(fields));
  }
});

test('a message keeps line breaks and tabs, normalises CRLF, and refuses other control characters', () => {
  const parsed = parseContactForm(form({ message: 'one\r\ntwo\tthree' }));
  assert.equal(parsed.kind === 'ok' && parsed.message.message, 'one\ntwo\tthree');
  assert.deepEqual(parseContactForm(form({ message: 'bell\u0007' })), { kind: 'invalid' });
});

test('limits hold at the boundary, and blanks are refused', () => {
  assert.equal(parseContactForm(form({ name: 'a'.repeat(LIMITS.name) })).kind, 'ok');
  assert.equal(parseContactForm(form({ name: 'a'.repeat(LIMITS.name + 1) })).kind, 'invalid');
  assert.equal(parseContactForm(form({ message: 'a'.repeat(LIMITS.message + 1) })).kind, 'invalid');
  assert.equal(parseContactForm(form({ name: '   ' })).kind, 'invalid');
  assert.equal(parseContactForm(form({ 'cf-turnstile-response': '' })).kind, 'invalid');
});

test('the email to the owner is plain text naming the site', () => {
  const { subject, text } = contactEmail({ name: 'Ada', email: 'ada@example.com', message: 'Hi' }, 'example.com');
  assert.equal(subject, 'Website message from Ada');
  assert.match(text, /^Name: Ada\nEmail: ada@example\.com\n\nHi\n/);
  assert.match(text, /contact form on example\.com\./);
});
