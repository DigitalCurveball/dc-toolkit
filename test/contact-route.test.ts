// The contact route's refusals and its one success, run against handleContact() with fake
// bindings and a fake Siteverify. It is the single copy behind every site's live form, so each
// defence in the README's "What stops abuse" has a test here.
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { handleContact, type ContactEnv } from '../src/contact-handler.ts';

const SITE = 'https://example.com';
const TEST_SECRET = '1x0000000000000000000000000000000AA';

afterEach(() => mock.restoreAll());

async function post({
  fields = {},
  origin = SITE,
  site = SITE,
  length,
}: { fields?: Record<string, string>; origin?: string | null; site?: string; length?: string | null } = {}) {
  const form = new FormData();
  const all = { name: 'Ada', email: 'ada@example.com', message: 'Hello', 'cf-turnstile-response': 'token', ...fields };
  for (const [key, value] of Object.entries(all)) form.set(key, value);
  const encoded = new Response(form);
  const body = await encoded.arrayBuffer();
  const headers: Record<string, string> = { 'content-type': encoded.headers.get('content-type') ?? '' };
  if (origin !== null) headers.origin = origin;
  if (length !== null) headers['content-length'] = length ?? String(body.byteLength);
  return new Request(new URL('/api/contact', site), { method: 'POST', body, headers });
}

function bindings(overrides: Partial<ContactEnv> = {}) {
  const sent: Parameters<NonNullable<ContactEnv['EMAIL']>['send']>[0][] = [];
  const keys: string[] = [];
  const env: ContactEnv = {
    EMAIL: { send: async (message) => (sent.push(message), { messageId: 'id' }) },
    CONTACT_TO: 'owner@example.com',
    CONTACT_FROM: 'website@forms.example.com',
    CONTACT_RATE_LIMIT: { limit: async ({ key }) => (keys.push(key), { success: true }) },
    TURNSTILE_SECRET_KEY: 'real-secret',
    ...overrides,
  };
  return { env, sent, keys };
}

function siteverify(result: object | Error) {
  return mock.method(globalThis, 'fetch', async () => {
    if (result instanceof Error) throw result;
    return Response.json(result);
  });
}
const PASS = { success: true, action: 'contact', hostname: 'example.com' };

async function send(request: Request, { env = bindings().env, ip = '203.0.113.7', dev = false } = {}) {
  const response = await handleContact(request, { url: new URL(request.url), ip, env, dev });
  return { status: response.status, body: await response.json() };
}

test('only this site may post: a missing or foreign Origin is refused', async () => {
  const { env, sent } = bindings();
  assert.deepEqual(await send(await post({ origin: null }), { env }), { status: 403, body: { error: 'origin' } });
  assert.deepEqual(await send(await post({ origin: 'https://evil.example' }), { env }), { status: 403, body: { error: 'origin' } });
  assert.equal(sent.length, 0);
});

test('a missing or oversized length is refused before anything is read', async () => {
  assert.deepEqual(await send(await post({ length: null })), { status: 413, body: { error: 'size' } });
  assert.deepEqual(await send(await post({ length: String(32 * 1024 + 1) })), { status: 413, body: { error: 'size' } });
});

test('under astro dev it checks the form and prints the email instead of sending it', async () => {
  const fetch = siteverify(PASS);
  const log = mock.method(console, 'log', () => {});
  const { env, sent } = bindings();
  assert.deepEqual(await send(await post(), { env, dev: true }), { status: 200, body: { ok: true } });
  assert.match(String(log.mock.calls[0].arguments[1].text), /Hello/);
  assert.deepEqual(await send(await post({ fields: { name: '' } }), { env, dev: true }), { status: 400, body: { error: 'invalid' } });
  assert.equal(sent.length, 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test('without its bindings it answers unavailable', async () => {
  const { env } = bindings({ EMAIL: undefined });
  assert.deepEqual(await send(await post(), { env }), { status: 503, body: { error: 'unavailable' } });
});

test("the rate limit comes first, keyed by the visitor's address, or one shared key without one", async () => {
  const fetch = siteverify(PASS);
  const { env, keys } = bindings({ CONTACT_RATE_LIMIT: { limit: async ({ key }) => (keys.push(key), { success: false }) } });
  assert.deepEqual(await send(await post(), { env }), { status: 429, body: { error: 'busy' } });
  await send(await post(), { env, ip: '' });
  assert.deepEqual(keys, ['203.0.113.7', 'unknown']);
  assert.equal(fetch.mock.callCount(), 0);
});

test('a filled honeypot is told it was sent, and nothing is', async () => {
  const fetch = siteverify(PASS);
  const { env, sent } = bindings();
  assert.deepEqual(await send(await post({ fields: { website: 'spam.example' } }), { env }), { status: 200, body: { ok: true } });
  assert.equal(sent.length, 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test('an invalid form is refused', async () => {
  assert.deepEqual(await send(await post({ fields: { email: 'ada@example.com, x@example.com' } })), {
    status: 400,
    body: { error: 'invalid' },
  });
});

test('a Turnstile test secret is refused away from localhost, and accepted on it', async () => {
  const error = mock.method(console, 'error', () => {});
  const fetch = siteverify({ success: true });
  const remote = bindings({ TURNSTILE_SECRET_KEY: TEST_SECRET });
  assert.deepEqual(await send(await post(), { env: remote.env }), { status: 503, body: { error: 'unavailable' } });
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 1);
  assert.equal(remote.sent.length, 0);

  const local = bindings({ TURNSTILE_SECRET_KEY: TEST_SECRET });
  const here = 'http://localhost:4321';
  assert.deepEqual(await send(await post({ site: here, origin: here }), { env: local.env }), { status: 200, body: { ok: true } });
  assert.equal(local.sent.length, 1);
});

test('a token that fails, or was issued for another form or site, is refused', async () => {
  for (const result of [
    { success: false },
    { ...PASS, action: 'login' },
    { ...PASS, hostname: 'evil.example' },
    new Error('network down'),
  ]) {
    mock.restoreAll();
    siteverify(result);
    const { env, sent } = bindings();
    assert.deepEqual(await send(await post(), { env }), { status: 403, body: { error: 'check' } }, String(result));
    assert.equal(sent.length, 0);
  }
});

test('a good message is sent to the owner only, with the visitor as Reply-To', async () => {
  const fetch = siteverify(PASS);
  const { env, sent } = bindings();
  assert.deepEqual(await send(await post(), { env }), { status: 200, body: { ok: true } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.com');
  assert.deepEqual(sent[0].from, { email: 'website@forms.example.com', name: 'Website contact form' });
  assert.deepEqual(sent[0].replyTo, { email: 'ada@example.com', name: 'Ada' });
  assert.equal(sent[0].subject, 'Website message from Ada');
  const checked = fetch.mock.calls[0].arguments[1]?.body as FormData;
  assert.equal(checked.get('secret'), 'real-secret');
  assert.equal(checked.get('response'), 'token');
  assert.equal(checked.get('remoteip'), '203.0.113.7');
});

test('a failed send answers 502, and the log carries the code, never what was written', async () => {
  siteverify(PASS);
  const error = mock.method(console, 'error', () => {});
  const { env } = bindings({
    EMAIL: {
      send: async () => {
        throw Object.assign(new Error('refused'), { code: 'E_SENDER' });
      },
    },
  });
  assert.deepEqual(await send(await post(), { env }), { status: 502, body: { error: 'send' } });
  const logged = JSON.stringify(error.mock.calls.map((call) => call.arguments));
  assert.match(logged, /E_SENDER/);
  assert.doesNotMatch(logged, /Hello|ada@example\.com/);
});
