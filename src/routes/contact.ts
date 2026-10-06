import type { APIRoute } from 'astro';
import { env as workerEnv } from 'cloudflare:workers';
import { handleContact, type ContactEnv } from '../contact-handler';

// The contact form's Worker route: checks a message and emails it to the owner through
// Cloudflare Email Service. The only route besides the CMS that runs on demand, so it is listed
// in the site's wrangler.jsonc, assets.run_worker_first. What each check is for: README,
// "The contact form".
//
// It answers JSON, which the site's ContactForm.astro turns into words. Every refusal names a
// reason the visitor can act on and nothing about the checks themselves.
//
// The bindings arrive only when the form goes live (README, "Going live").
// Until then, and on branch previews, the route answers "unavailable". Under `astro dev` there
// are no bindings at all (the Cloudflare adapter only loads for builds), so it logs the message
// instead of sending it. The work itself is src/contact-handler.ts, which the tests run.
export const prerender = false;

export const POST: APIRoute = ({ request, url, clientAddress }) => {
  let ip = '';
  try {
    ip = clientAddress;
  } catch {
    // Astro throws when the platform gives no address. Every such request then shares one limit.
  }
  return handleContact(request, { url, ip, env: workerEnv as ContactEnv, dev: import.meta.env.DEV });
};

export const GET: APIRoute = () =>
  new Response('Method not allowed', { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
