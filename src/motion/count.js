// Numbers that count up (dc-pipeline #57): a figure counts from zero to itself, in its own format
// ("$4,900", "98%", "120+", "1.5"), in about a second and a half, slowing at the end, once, when
// half of it is on the screen.
//
// The number stays in the page as written, transparent while it counts, so screen readers, search
// and visitors without scripts have it throughout, and the count is laid over it, hidden from
// screen readers, as the scramble does. Figures of equal width (`font-variant-numeric:
// tabular-nums`, which Count.astro sets from the first paint) keep the count inside the number's
// own width, so nothing moves. Afterwards it is its own text node again. A figure on the screen
// when the page opens is as written, and so is every figure while motion is paused.
//
// Plain text only, one number with what is before and after it: a figure with markup in it stays
// as it is. Only the client's own figures, never one made up.
//
// It plays once: no pause control (`loops: false`). The pause control leaves it be
// (`pausable: false`) but for showing the figure at once.

const DURATION = 1.6; // seconds

export default {
  loops: false,
  pausable: false,
  setup(element, kit) {
    const text = element.textContent;
    const match = text.match(/^(\D*?)(\d[\d,]*(?:\.\d+)?)(\D*)$/s);
    if (element.children.length || !match) {
      console.warn('dc-motion: a count-up takes plain text holding one number', element);
      return {};
    }
    if (kit.opening || kit.paused()) return {};
    const [, before, digits, after] = match;
    const decimals = (digits.split('.')[1] ?? '').length;
    const target = Number(digits.replace(/,/g, ''));
    const format = new Intl.NumberFormat('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: digits.includes(',') });
    const original = [...element.childNodes];
    const real = document.createElement('span');
    real.style.color = 'transparent';
    real.append(...original);
    const over = document.createElement('span');
    over.setAttribute('aria-hidden', 'true');
    over.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap';
    element.replaceChildren(real, over);
    if (getComputedStyle(element).position === 'static') element.style.position = 'relative';
    let done = false;
    let shown = '';
    const finish = () => {
      if (done) return;
      done = true;
      element.replaceChildren(...original);
      element.style.removeProperty('position');
    };

    return {
      frame(time) {
        if (done) return false;
        if (kit.paused() || time >= DURATION) return finish();
        const value = before + format.format(target * (1 - (1 - time / DURATION) ** 3)) + after;
        if (value === shown) return false;
        shown = value;
        over.textContent = value;
      },
      destroy: finish,
    };
  },
};
