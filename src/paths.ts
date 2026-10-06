/**
 * True when a link points at the page being rendered, so "/about" and "/about/"
 * both match on the About page. Only whole site paths can match: "#", "#section",
 * a section of a page like "/#about", and full https:// addresses never do. On the
 * homepage, Home is current and its section links (Services, About) are not.
 *
 * For marking the current menu link:
 *   aria-current={isCurrentPage(item.href, Astro.url.pathname) ? 'page' : undefined}
 */
export function isCurrentPage(href: string, pathname: string) {
  if (!href.startsWith('/') || href.includes('#')) return false;
  const clean = (path: string) => path.replace(/\/+$/, '') || '/';
  return clean(href) === clean(pathname);
}
