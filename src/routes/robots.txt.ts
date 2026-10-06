import type { APIRoute } from 'astro';

// robots.txt, prerendered at build time like a page. An endpoint rather than a file in public/,
// so the Sitemap line is built from the site's `site` and stays right when `site`
// changes at launch.
//
// It asks AI-training crawlers to stay out itself, with the list Cloudflare's managed robots.txt
// carried on 2026-10-03, because the managed file is switched off on every client's zone: its
// Content-Signal line fails Lighthouse's robots.txt audit, which held every live page's SEO score
// at 92 (README, `robots.txt`). Unlike the
// managed file, this list does not update itself: compare it with Cloudflare's now and then.
const AI_TRAINING = [
  'Amazonbot', 'Applebot-Extended', 'Bytespider', 'CCBot', 'ClaudeBot', 'Diffbot', 'Google-Extended',
  'GPTBot', 'omgili', 'anthropic-ai', 'Claude-Web', 'cohere-ai', 'MistralAI-Training',
  'meta-externalagent', 'GoogleOther', 'Baiduspider', 'PetalBot', 'AwarioSmartBot', 'AwarioRssBot',
  'Google-CloudVertexBot', 'QualifiedBot', 'Cotoyogi', 'ICC-Crawler', 'atlassian-bot', 'FishBot',
  'BorderxBot', 'NavuBot', 'SemrushBot-SWA', 'WARDBot', 'magpie-crawler', 'KimiBot',
  'CitibotSiteCrawler',
];

export const GET: APIRoute = ({ site }) =>
  new Response(
    [
      'User-agent: *',
      'Allow: /',
      '',
      '# AI training crawlers',
      ...AI_TRAINING.map((bot) => `User-agent: ${bot}`),
      'Disallow: /',
      '',
      `Sitemap: ${new URL('sitemap-index.xml', site).href}`,
      '',
    ].join('\n'),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
