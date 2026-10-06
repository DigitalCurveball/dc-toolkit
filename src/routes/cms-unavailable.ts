import type { APIRoute } from 'astro';

// Answers /keystatic on branch previews, which leave the CMS out (defineSite(), in index.mjs).
//
// It also keeps a Worker script in those builds. Without any server route the
// adapter emits a static-only deployment, and Wrangler refuses the
// assets.run_worker_first setting in the site's wrangler.jsonc when there is no script to run
// first, so every branch deploy would fail.
export const GET: APIRoute = () =>
  new Response('The CMS is only on the main site. Previews are for looking, not editing.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
