import type { AstroUserConfig } from 'astro';
import type { SitemapOptions } from '@astrojs/sitemap';

export interface SiteConfig extends AstroUserConfig {
  /** Injects /api/contact, the contact form's Worker route. Off unless set. */
  contactForm?: boolean;
  /** Options for @astrojs/sitemap, such as a filter for pages that name another as canonical. */
  sitemap?: SitemapOptions;
}

export function defineSite(config: SiteConfig): AstroUserConfig;
export function buildConfig(config: SiteConfig, run: { isDev: boolean; branch?: string }): AstroUserConfig;
