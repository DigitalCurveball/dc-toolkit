import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkChecker } from '../src/link-status.mjs';

// A fetch that answers each call with the next of `answers`: a status, or an Error to throw.
function fakeFetch(answers) {
  const calls = [];
  const get = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return { status: answer, ok: answer >= 200 && answer < 300 };
  };
  return { get, calls };
}
const check = (answers) => {
  const fake = fakeFetch(answers);
  return { fake, status: linkChecker({ fetch: fake.get, wait: () => 0 }) };
};

test('a link that resolves is fetched once', async () => {
  const { fake, status } = check([200]);
  assert.equal(await status('https://a.test/'), null);
  assert.equal(fake.calls.length, 1);
});

test('a dropped connection is tried again, and passes when the next try does', async () => {
  const { fake, status } = check([new TypeError('fetch failed'), 200]);
  assert.equal(await status('https://a.test/projects/'), null);
  assert.equal(fake.calls.length, 2);
});

test('a 429 or a 5xx is tried again; three failures report the last', async () => {
  const { fake, status } = check([429, 503, 502]);
  assert.equal(await status('https://a.test/'), '502');
  assert.equal(fake.calls.length, 3);
});

test('a 404 is final, with no second try', async () => {
  const { fake, status } = check([404]);
  assert.equal(await status('https://a.test/gone/'), '404');
  assert.equal(fake.calls.length, 1);
});

test('a network error on every try reports its message', async () => {
  const { status } = check([new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')]);
  assert.equal(await status('https://a.test/'), 'fetch failed');
});

test('a HEAD the server refuses is asked again as a GET', async () => {
  const { fake, status } = check([405, 200]);
  assert.equal(await status('https://a.test/'), null);
  assert.deepEqual(fake.calls, ['HEAD https://a.test/', 'GET https://a.test/']);
});

test('the same URL on many pages is fetched once', async () => {
  const { fake, status } = check([200]);
  const results = await Promise.all([status('https://a.test/about/'), status('https://a.test/about/')]);
  assert.deepEqual(results, [null, null]);
  assert.equal(fake.calls.length, 1);
});
