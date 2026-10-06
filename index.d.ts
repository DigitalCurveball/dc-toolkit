import type { AstroUserConfig, FontProvider, Locales } from 'astro';
import type { SitemapOptions } from '@astrojs/sitemap';

export interface ToolkitOptions {
  /** Injects /api/contact, the contact form's Worker route. Off unless set. */
  contactForm?: boolean;
  /** Options for @astrojs/sitemap, such as a filter for pages that name another as canonical. */
  sitemap?: SitemapOptions;
}

/**
 * Astro's config plus the toolkit's options. Generic as Astro's defineConfig is, so each font's
 * `options` are typed by its provider. Sessions are always off, so their driver type is fixed.
 */
export type SiteConfig<TLocales extends Locales = never, TFontProviders extends Array<FontProvider> = never> =
  AstroUserConfig<TLocales, never, TFontProviders> & ToolkitOptions;

export function defineSite<const TLocales extends Locales = never, const TFontProviders extends Array<FontProvider> = never>(
  config: SiteConfig<TLocales, TFontProviders>,
): AstroUserConfig<TLocales, never, TFontProviders>;

export function buildConfig<const TLocales extends Locales = never, const TFontProviders extends Array<FontProvider> = never>(
  config: SiteConfig<TLocales, TFontProviders>,
  run: { isDev: boolean; branch?: string },
): AstroUserConfig<TLocales, never, TFontProviders>;
