import type { APIRoute } from 'astro';
import { env as workerEnv } from 'cloudflare:workers';
import { MAX_BODY_BYTES, TURNSTILE_ACTION, contactEmail, parseContactForm } from '../contact';

// The contact form's Worker route: checks a message and emails it to the owner through
// Cloudflare Email Service. The only route besides the CMS that runs on demand, so it is listed
// in the site's wrangler.jsonc, assets.run_worker_first. What each check is for: README,
// "The contact form".
//
// It answers JSON, which the site's ContactForm.astro turns into words. Every refusal names a
// reason the visitor can act on and nothing about the checks themselves.
//
// The bindings below arrive only when the form goes live (README, "Going live").
// Until then, and on branch previews, the route answers "unavailable". Under `astro dev` there
// are no bindings at all (the Cloudflare adapter only loads for builds), so it logs the message
// instead of sending it.
export const prerender = false;

interface SendEmail {
  send(message: {
    to: string;
    from: { email: string; name?: string };
    replyTo: { email: string; name?: string };
    subject: string;
    text: string;
  }): Promise<{ messageId: string }>;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface ContactEnv {
  /** send_email binding, pinned to the owner's verified inbox by destination_address. */
  EMAIL?: SendEmail;
  /** The owner's inbox, the same address as the binding's destination_address. */
  CONTACT_TO?: string;
  /** ratelimits binding, counted per visitor IP. */
  CONTACT_RATE_LIMIT?: RateLimit;
  /** The sender, on a subdomain onboarded to Email Sending, never the root domain. */
  CONTACT_FROM?: string;
  /** A Worker secret, set in the dashboard. Never in the repo. */
  TURNSTILE_SECRET_KEY?: string;
}

const env = workerEnv as ContactEnv;

type Refusal = 'origin' | 'size' | 'invalid' | 'check' | 'busy' | 'unavailable' | 'send';

const reply = (status: number, body: { ok: true } | { error: Refusal }) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Cloudflare's test secrets pass (or fail) every token from any site. They are accepted only on
// localhost, where `wrangler dev` runs, so one left in production refuses every message rather
// than letting every message through.
const TEST_SECRET = /^[123]x0+AA$/;
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

async function verifyTurnstile(token: string, secret: string, ip: string, hostname: string) {
  const testing = TEST_SECRET.test(secret);
  if (testing && !LOCAL.has(hostname)) return 'misconfigured';

  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json()) as { success?: boolean; action?: string; hostname?: string };
    if (!result.success) return 'failed';
    // A real token must come from this form on this site. Test tokens carry neither.
    if (!testing && (result.action !== TURNSTILE_ACTION || result.hostname !== hostname)) return 'failed';
    return 'passed';
  } catch {
    return 'failed';
  }
}

export const POST: APIRoute = async ({ request, url, clientAddress }) => {
  // Only this site's own page may post here. Astro's security.checkOrigin already refuses
  // cross-site form posts from browsers; this also refuses requests that send no Origin at all.
  if (request.headers.get('origin') !== url.origin) return reply(403, { error: 'origin' });

  // Refuse anything large before reading it. Browsers always send a length for a form.
  const length = Number(request.headers.get('content-length'));
  if (!length || length > MAX_BODY_BYTES) return reply(413, { error: 'size' });

  if (import.meta.env.DEV) {
    const parsed = parseContactForm(await request.formData());
    if (parsed.kind === 'invalid') return reply(400, { error: 'invalid' });
    console.log('[contact] astro dev: not sent.', parsed.kind === 'ok' ? contactEmail(parsed.message, url.hostname) : 'Honeypot filled.');
    return reply(200, { ok: true });
  }

  const { EMAIL, CONTACT_TO, CONTACT_RATE_LIMIT, CONTACT_FROM, TURNSTILE_SECRET_KEY } = env;
  if (!EMAIL || !CONTACT_TO || !CONTACT_RATE_LIMIT || !CONTACT_FROM || !TURNSTILE_SECRET_KEY) {
    return reply(503, { error: 'unavailable' });
  }

  // The rate limit comes before any other work, so a flood costs as little as possible.
  let ip = '';
  try {
    ip = clientAddress;
  } catch {
    // Astro throws when the platform gives no address. Every such request then shares one limit.
  }
  if (!(await CONTACT_RATE_LIMIT.limit({ key: ip || 'unknown' })).success) return reply(429, { error: 'busy' });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply(400, { error: 'invalid' });
  }
  const parsed = parseContactForm(form);
  // A bot that filled the honeypot is told it succeeded, so it learns nothing.
  if (parsed.kind === 'honeypot') return reply(200, { ok: true });
  if (parsed.kind === 'invalid') return reply(400, { error: 'invalid' });

  const check = await verifyTurnstile(parsed.token, TURNSTILE_SECRET_KEY, ip, url.hostname);
  if (check === 'misconfigured') {
    console.error('[contact] refused: a Turnstile test secret outside localhost');
    return reply(503, { error: 'unavailable' });
  }
  if (check === 'failed') return reply(403, { error: 'check' });

  // CONTACT_TO is the owner's inbox, and the binding's destination_address refuses any other,
  // so this route can only ever email the owner. (Cloudflare's docs say `to` may be left out for
  // a pinned binding; wrangler dev's simulator refuses that, so it is always given.) The
  // visitor's address goes in Reply-To and is never sent anything.
  const { subject, text } = contactEmail(parsed.message, url.hostname);
  try {
    await EMAIL.send({
      to: CONTACT_TO,
      from: { email: CONTACT_FROM, name: 'Website contact form' },
      replyTo: { email: parsed.message.email, name: parsed.message.name },
      subject,
      text,
    });
  } catch (error) {
    // The code only: a log line never carries what the visitor wrote.
    console.error('[contact] send failed:', (error as { code?: string }).code ?? 'unknown');
    return reply(502, { error: 'send' });
  }
  return reply(200, { ok: true });
};

export const GET: APIRoute = () =>
  new Response('Method not allowed', { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
