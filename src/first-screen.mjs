// The first screen's images: dc-qa's first-screen check (dc-pipeline docs/site-stack.md, "Images").
// Astro's <Image> loads lazily unless it is given `priority` or `loading="eager"`, so a photo that
// opens a page waits for layout before it is even fetched: on 2026-11-28 the largest paint was a
// lazily loaded image on six pages of three sites, and Lighthouse, which only lowers the score
// for it, passed them all. Chrome's Modern Web Guidance: "Never use `loading="lazy"` on the LCP
// image", which takes `fetchpriority="high"`, and no image above the fold loads lazily.
//
// findFirstScreen runs inside the page (`page.evaluate(findFirstScreen)`), so it is
// self-contained. Run it as soon as the page has loaded, before anything scrolls or clicks: the
// largest contentful paint is read from the browser's own record of it, and scrolling ends it.
// Of equal images, such as a row of cards, whichever paints first is the largest paint, so the
// rule is met when the largest paint, or an image on the first screen as large, has the priority.

/** The page's largest paint, if it is an image, and every lazily loaded image on the first screen. */
export function findFirstScreen() {
  const name = (img) => (img.currentSrc || img.src || '').split('/').pop().split('?')[0].slice(0, 60);
  const onScreen = (el) => {
    const box = el.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) return false;
    if (box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && !el.closest('[hidden]');
  };
  return new Promise((resolve) => {
    let last = null;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) last = entry;
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
    // Buffered entries arrive in a task of their own, after a frame.
    requestAnimationFrame(() => setTimeout(() => {
      observer.disconnect();
      const el = last?.element;
      const area = (img) => { const b = img.getBoundingClientRect(); return b.width * b.height; };
      const high = (img) => img.getAttribute('fetchpriority') === 'high';
      const lcp = el?.tagName === 'IMG'
        ? {
          image: name(el),
          alt: (el.alt || '').slice(0, 40),
          loading: el.getAttribute('loading') ?? 'eager',
          prioritised: high(el) || [...document.images].some((img) => high(img) && onScreen(img) && area(img) >= area(el) * 0.98),
        }
        : null;
      const lazy = [...document.images]
        .filter((img) => img.loading === 'lazy' && onScreen(img))
        .map((img) => ({ image: name(img), alt: (img.alt || '').slice(0, 40) }));
      resolve({ lcp, lazy });
    }, 50));
  });
}
