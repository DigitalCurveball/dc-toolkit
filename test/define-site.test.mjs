import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildConfig } from '../index.mjs';

const names = (config) => config.integrations.map((integration) => integration.name);
async function injected(config) {
  const routes = [];
  const toolkit = config.integrations.find((integration) => integration.name === 'dc-toolkit');
  await toolkit.hooks['astro:config:setup']({ injectRoute: (route) => routes.push(route) });
  return routes;
}

test('a build gets the adapter, the edge build of react-dom/server and no sessions', () => {
  const config = buildConfig({ site: 'https://example.com' }, { isDev: false });
  assert.equal(config.adapter?.name, '@astrojs/cloudflare');
  assert.equal(config.session, false);
  assert.equal(config.vite.resolve.alias['react-dom/server'], 'react-dom/server.edge');
  assert.equal(config.vite.resolve.alias['cloudflare:workers'], undefined);
  assert.equal(config.site, 'https://example.com');
});

test('astro dev gets no adapter, and a bindings stand-in that exists', () => {
  const config = buildConfig({}, { isDev: true });
  assert.equal(config.adapter, undefined);
  assert.equal(config.session, false);
  assert.equal(config.vite.resolve.alias['react-dom/server'], undefined);
  assert.ok(existsSync(config.vite.resolve.alias['cloudflare:workers']));
});

test('main, and a build with no branch, get the CMS and no stand-in', async () => {
  for (const branch of [undefined, 'main']) {
    const config = buildConfig({}, { isDev: false, branch });
    assert.deepEqual(names(config), ['@astrojs/react', 'keystatic', '@astrojs/sitemap', 'dc-toolkit']);
    assert.deepEqual((await injected(config)).map((route) => route.pattern), ['/robots.txt']);
  }
});

test('a branch preview gets the stand-in instead of the CMS', async () => {
  const config = buildConfig({}, { isDev: false, branch: 'preview' });
  assert.deepEqual(names(config), ['@astrojs/sitemap', 'dc-toolkit']);
  const routes = await injected(config);
  assert.deepEqual(routes.map((route) => route.pattern), ['/robots.txt', '/keystatic/[...path]']);
  assert.equal(routes[1].prerender, false);
});

test('contactForm injects the contact route, rendered on demand', async () => {
  assert.equal((await injected(buildConfig({}, { isDev: false }))).some((r) => r.pattern === '/api/contact'), false);
  const contact = (await injected(buildConfig({ contactForm: true }, { isDev: false }))).find((r) => r.pattern === '/api/contact');
  assert.equal(contact?.prerender, false);
});

test('every injected entrypoint resolves to a file in the package', async () => {
  const routes = await injected(buildConfig({ contactForm: true }, { isDev: false, branch: 'preview' }));
  for (const { entrypoint } of routes) assert.ok(existsSync(fileURLToPath(import.meta.resolve(entrypoint))), entrypoint);
});

test("a site's own settings are kept, and the toolkit's options never reach Astro", () => {
  const mine = { name: 'mine', hooks: {} };
  const config = buildConfig(
    {
      contactForm: true,
      sitemap: { filter: () => true },
      integrations: [mine],
      markdown: { gfm: false },
      vite: { resolve: { alias: { '~': '/src' } } },
    },
    { isDev: false },
  );
  assert.equal(config.integrations.at(-1), mine);
  assert.deepEqual(config.markdown, { gfm: false });
  assert.equal(config.vite.resolve.alias['~'], '/src');
  assert.equal(config.vite.resolve.alias['react-dom/server'], 'react-dom/server.edge');
  assert.equal('contactForm' in config, false);
  assert.equal('sitemap' in config, false);
});
