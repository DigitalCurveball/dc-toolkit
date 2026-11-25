// How far the page has brought an element on, for the effects that play once as an element
// arrives, tied to the scrolling rather than a clock (dc-pipeline #55): the photos that open
// (reveal.js) and the photos that print themselves (print.js).

/**
 * How far the page has scrolled `element` on: 0 as its top comes onto the screen at the foot, 1 by
 * the time its middle reaches the screen's, or by the foot of the page if the page can't scroll so
 * far. An effect keeps the most it has seen, so it never goes back.
 */
export function arrival(element) {
  const { top, height } = element.getBoundingClientRect();
  const foot = top - (document.documentElement.scrollHeight - innerHeight - scrollY); // its top, the page scrolled to its foot
  const end = Math.max(innerHeight / 2 - height / 2, foot);
  return innerHeight - end > 1 ? clamp((innerHeight - top) / (innerHeight - end)) : 1;
}

/**
 * `value` moved toward `target` over `delta` seconds, trailing it as GSAP's "scrub" does, about
 * `lag` seconds behind, and landing on it once within a thousandth.
 */
export function trail(value, target, delta, lag = 0.18) {
  if (Math.abs(target - value) < 0.001) return target;
  return value + (target - value) * (1 - Math.exp(-delta / lag));
}

const clamp = (n) => Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), 1);
