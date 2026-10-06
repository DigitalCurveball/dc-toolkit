// defineSite(): a Digital Curveball site's Astro config, with every setup trap handled here
// once instead of copied into each site.
//
// - The Cloudflare adapter is added for builds only, never for `astro dev`. With it, Astro runs
//   server routes inside workerd during dev, which has no filesystem and no CommonJS, so
//   Keystatic's editor fails with "exports is not defined". Dev on Node, production on workerd.
// - The CMS is left out of branch previews. Keystatic Cloud reads and saves main whichever
//   deployment it is opened from, so a preview's editor could commit fields main's schema
//   rejects. Workers Builds sets WORKERS_CI_BRANCH; a preview gets a stand-in at /keystatic,
//   which also keeps a Worker script in the build, as the site's run_worker_first requires.
// - No Astro sessions. Left on, the adapter adds a SESSION KV binding with no ID, which
//   `wrangler preview` refuses, so every branch preview failed to deploy.
// - Under `astro dev`, `cloudflare:workers` (which only exists inside workerd) is a stand-in
//   with no bindings; for builds, `react-dom/server` is its edge build, or the deployed Worker
//   fails with "MessageChannel is not defined".
//
// Each trap's full story: README, "defineSite()".
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import keystatic from '@keystatic/astro';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

// The routes every site gets, injected rather than copied into each site's src/pages/.
function routes({ contactForm, includeCms }) {
  return {
    name: 'dc-toolkit',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        injectRoute({ pattern: '/robots.txt', entrypoint: 'dc-toolkit/routes/robots.txt.ts' });
        if (!includeCms) {
          injectRoute({ pattern: '/keystatic/[...path]', entrypoint: 'dc-toolkit/routes/cms-unavailable.ts', prerender: false });
        }
        if (contactForm) {
          injectRoute({ pattern: '/api/contact', entrypoint: 'dc-toolkit/routes/contact.ts', prerender: false });
        }
      },
    },
  };
}

/** The config for a given run; defineSite() supplies the run. Exported for the tests. */
export function buildConfig({ contactForm = false, sitemap: sitemapOptions, integrations = [], vite = {}, ...astro }, { isDev, branch }) {
  // "main" must match the production branch in Cloudflare's build settings.
  const includeCms = !branch || branch === 'main';
  const alias = isDev
    ? { 'cloudflare:workers': here('./src/dev-cloudflare-env.ts') }
    : { 'react-dom/server': 'react-dom/server.edge' };
  return defineConfig({
    ...astro,
    integrations: [
      ...(includeCms ? [react(), keystatic()] : []),
      sitemap(sitemapOptions),
      routes({ contactForm, includeCms }),
      ...integrations,
    ],
    adapter: isDev ? undefined : cloudflare(),
    session: false,
    vite: { ...vite, resolve: { ...vite.resolve, alias: { ...alias, ...vite.resolve?.alias } } },
  });
}

/** A Digital Curveball site's Astro config: README, "defineSite()". */
export function defineSite(config) {
  return buildConfig(config, { isDev: process.argv.includes('dev'), branch: process.env.WORKERS_CI_BRANCH });
}
