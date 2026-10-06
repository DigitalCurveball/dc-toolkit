// Type fixtures for defineSite(), checked by test/types.test.mjs with tsc. A site's
// `astro check` reads astro.config.mjs the same way, so a type that fails here fails there.
import { fontProviders } from 'astro/config';
import { defineSite } from 'dc-toolkit';

// A local font's options are typed by its provider, as with Astro's own defineConfig.
defineSite({
  site: 'https://example.com',
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Example Sans',
      cssVariable: '--font-example',
      fallbacks: ['system-ui', 'sans-serif'],
      options: { variants: [{ src: ['./example.woff2'], weight: '400 700', style: 'normal' }] },
    },
  ],
  contactForm: true,
  sitemap: { filter: (page) => !page.includes('/drafts/') },
});

// @ts-expect-error contactForm is a boolean
defineSite({ contactForm: 'yes' });
