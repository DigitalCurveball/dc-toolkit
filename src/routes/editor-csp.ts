// The editor's pages (/keystatic) are left out of the site's Content Security Policy (index.mjs,
// CSP). Keystatic's interface adds its styles as it runs and loads its typeface from Google
// Fonts, both of which the policy refuses, and it was unstyled under it (2026-11-28). It is
// behind Keystatic Cloud's own sign-in and shows visitors nothing, so it keeps the security
// headers the zone rule sends and goes without the policy; every page a visitor sees has it.
// Astro sends the policy as a header on a page rendered on demand, as the editor's are, and a
// <meta> on a prerendered one, which this never touches.
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (!context.url.pathname.startsWith('/keystatic')) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-security-policy');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
