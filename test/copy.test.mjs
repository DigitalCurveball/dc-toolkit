import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFragments, missingCopy, normalise, pageText } from '../src/copy.mjs';

const COPY = `# The brief

### Approved copy

**The hero**

Tagline: **Fix it once. Keep it fixed.**

Button: Ask for a quote

- Small jobs: one day at most.
The form: name, contact, message

### The facts

Prices: $300
`;

test('the copy between its markers, split at sentences and colons, without labels or headings', () => {
  const fragments = copyFragments(COPY, { from: '### Approved copy', to: '### The facts', ignore: ['^(Button|Tagline): ', '^The form:.*'] });
  assert.deepEqual(fragments, ['Fix it once.', 'Keep it fixed.', 'Ask for a quote', 'Small jobs', 'one day at most.']);
  assert.throws(() => copyFragments(COPY, { from: 'Nowhere' }), /No line holds "Nowhere"/);
});

test('a page reads as its visible text: blocks and breaks are spaces, scripts and entities gone', () => {
  const html = `<head><title>Not this</title></head><body><h1>Fix&nbsp;it once.</h1><p>Keep it<br data-astro-cid-x>fixed.</p>
    <p>Mail hello [at] example.com<script>document.write('x')</script>.</p><p>Don&#39;t &amp; won’t</p></body>`;
  assert.equal(normalise(pageText(html)), "fix it once. keep it fixed. mail hello@example.com. don't & won't");
});

test('a changed word or a lost comma is missing; case, quotes and spacing are not', () => {
  const fragments = ['Fix it once.', 'Small jobs, one day at most.', "Don't wait"];
  const html = '<body><p>FIX   IT ONCE.</p><p>Small jobs one day at most.</p><p>Don’t wait</p></body>';
  assert.deepEqual(missingCopy(fragments, html), ['Small jobs, one day at most.']);
});
