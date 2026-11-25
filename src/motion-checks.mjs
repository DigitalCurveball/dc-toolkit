// dc-qa's checks for motion effects (src/motion/), run on a page that has one. axe sees none of
// this: it can't see into a canvas, so text over a moving background comes back from it neither
// passed nor failed, and nothing automated tests WCAG 2.2.2's pause control (dc-pipeline
// docs/motion.md, "The bar"; facts.md, "WCAG on moving content").
//
// - **A still without scripts**: every effect's element paints something of its own (a background
//   image or colour, or an image inside it) when no script runs; a type effect (reveal, scramble,
//   band) has its text.
// - **The still under reduced motion**: no effect starts, and nothing is drawn over the still.
// - **Each effect starts**, once scrolled to: it loads, and runs. One that can't run in this browser
//   (no WebGL) is noted, not failed, since its still is what shows.
// - **The pause control**: where a looping effect runs, a visible `.dc-motion-toggle` with a name
//   pauses every effect and says so in aria-pressed, and a second press resumes them.
// - **Text over motion keeps its contrast**: every line of text inside an effect's element is
//   measured against what is behind it, pixel by pixel, at the still and at moments across the
//   effect's movement, with the text itself made transparent. The darkest and lightest of what is
//   behind it (ignoring the extreme 2%, the grain) must both reach 4.5:1, or 3:1 for large text
//   (24px, or 18.66px bold), the thresholds axe uses.

// Moments across the movement, in seconds: past a whole drift of the slowest field.
export const MOMENTS = [0, 4, 8, 13, 19, 26, 34, 43];
const VIEWPORT = { width: 1280, height: 900 };
const WAIT = 15000;

/** Whether the page at `target` has any motion effect. */
export async function hasMotion(page) {
  return (await page.locator('[data-motion]').count()) > 0;
}

/** The checks, run in their own browser contexts: { effects, problems, notes, contrast }. */
export async function checkMotion(browser, target) {
  const problems = [];
  const notes = [];

  // Without scripts: a still on every effect's element.
  await withPage(browser, target, { javaScriptEnabled: false }, async (page) => {
    for (const name of await page.evaluate(missingStills)) problems.push(`${name} has no still without scripts`);
  });

  // Reduced motion: the still, and nothing drawn.
  const still = await withPage(browser, target, { reducedMotion: 'reduce' }, async (page) => {
    await settle(page);
    for (const { name, state, layers } of await page.evaluate(effectStates)) {
      if (state !== 'still' || layers) problems.push(`${name} moves under reduced motion (${state}${layers ? ', a layer drawn' : ''})`);
    }
    return measureText(page, ['still']);
  });

  // Motion: each effect starts; the pause control; text over each moment.
  const moving = await withPage(browser, target, { reducedMotion: 'no-preference' }, async (page) => {
    await settle(page);
    const effects = await page.evaluate(effectStates);
    for (const { name, state, reason } of effects) {
      if (state === 'failed' && reason === 'unsupported') notes.push(`${name} can't run in this browser (no WebGL?): its still shows`);
      else if (!['running', 'paused', 'idle'].includes(state)) problems.push(`${name} did not start (${state}${reason ? `, ${reason}` : ''})`);
    }
    if (effects.some((e) => e.loops && e.state === 'running')) problems.push(...(await checkToggle(page)));
    // The pause control's check left the mouse on it, and a control that changes colour under the
    // mouse would be measured in one colour over the other's background.
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.dcMotion.pause());
    const contrast = await measureText(page, MOMENTS);
    return { effects, contrast };
  });

  const contrast = mergeContrast(still, moving.contrast);
  for (const c of contrast) {
    if (c.ratio < c.needs) problems.push(`text over motion: "${c.text}" (${c.element}) is ${c.ratio.toFixed(2)}:1 at its worst (${c.at}), needs ${c.needs}:1`);
  }
  return { effects: moving.effects, problems, notes, contrast };
}

async function withPage(browser, target, options, work) {
  const context = await browser.newContext({ viewport: VIEWPORT, ...options });
  // The browser draws WebGL in software here, where the effects would show their stills
  // (src/motion/gl.js): the checks need their frames, to measure the text over them.
  await context.addInitScript(() => (window.dcMotionSoftware = true));
  const page = await context.newPage();
  try {
    await page.goto(target, { waitUntil: 'load' });
    return await work(page);
  } finally {
    await context.close();
  }
}

/** Scrolls each effect into view, which starts it, and waits until none is still on its way. */
async function settle(page) {
  for (const el of await page.locator('[data-motion]').all()) {
    await el.scrollIntoViewIfNeeded();
    await page.waitForFunction(
      (node) => !['still', 'loading'].includes(node.dataset.motionState) || matchMedia('(prefers-reduced-motion: reduce)').matches,
      await el.elementHandle(),
      { timeout: WAIT },
    ).catch(() => {});
  }
  await page.waitForTimeout(300);
}

function missingStills() {
  // The type effects' still is their own text (kinetic type, dc-pipeline #54).
  const text = new Set(['reveal', 'scramble', 'band']);
  return [...document.querySelectorAll('[data-motion]')].filter((el) => {
    if (text.has(el.dataset.motion) && el.textContent.trim()) return false;
    const style = getComputedStyle(el);
    const colour = style.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
    const opaque = colour.length === 3 || (colour.length === 4 && colour[3] > 0);
    const image = [...el.querySelectorAll('img, picture, svg, video[poster]')].some((m) => m.getBoundingClientRect().width > 0);
    return style.backgroundImage === 'none' && !opaque && !image;
  }).map((el) => `the "${el.dataset.motion}" effect${el.id ? ` (#${el.id})` : ''}`);
}

function effectStates() {
  return [...document.querySelectorAll('[data-motion]')].map((el) => {
    const record = window.dcMotion?.instances().find((i) => i.element === el);
    return {
      name: `the "${el.dataset.motion}" effect${el.id ? ` (#${el.id})` : ''}`,
      state: el.dataset.motionState ?? 'not started',
      reason: record?.reason ?? null,
      loops: record?.loops ?? false,
      layers: el.querySelectorAll(':scope > .dc-motion-layer').length,
    };
  });
}

async function checkToggle(page) {
  const problems = [];
  const toggle = page.locator('.dc-motion-toggle').filter({ visible: true }).first();
  if (!(await toggle.count())) return ['a looping effect runs with no visible pause control (.dc-motion-toggle; WCAG 2.2.2)'];
  const name = (await toggle.evaluate((b) => (b.getAttribute('aria-label') || b.textContent).trim()));
  if (!name) problems.push('the pause control has no name');
  const states = () => page.evaluate(() => window.dcMotion.instances().filter((i) => i.loops).map((i) => i.state));
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') problems.push('the pause control does not show it is pressed (aria-pressed)');
  if ((await states()).some((s) => s === 'running')) problems.push('the pause control does not pause every effect');
  await toggle.click();
  if ((await toggle.getAttribute('aria-pressed')) !== 'false') problems.push('the pause control stays pressed after a second press');
  // Back to the effects, so the ones in view run again before the moments are measured.
  for (const el of await page.locator('[data-motion]').all()) await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  if (!(await states()).some((s) => s === 'running')) problems.push('a second press of the pause control does not resume the effects');
  return problems;
}

/**
 * Each text element inside an effect, with the darkest and lightest of what is behind it over
 * `moments` (seconds, or 'still' for the page as it is).
 */
async function measureText(page, moments) {
  const texts = await page.evaluate(() => {
    const found = [];
    document.querySelectorAll('[data-motion]').forEach((effect, e) => {
      const walker = document.createTreeWalker(effect, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      while (walker.nextNode()) {
        const el = walker.currentNode.parentElement;
        if (!walker.currentNode.textContent.trim() || seen.has(el) || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        if (el.closest('[aria-hidden="true"], .dc-motion-layer')) continue;
        seen.add(el);
        const i = found.length;
        el.dataset.dcContrast = String(i);
        const style = getComputedStyle(el);
        const size = parseFloat(style.fontSize);
        const weight = Number(style.fontWeight) || 400;
        found.push({
          i, effect: e, color: style.color,
          large: size >= 24 || (size >= 18.66 && weight >= 700),
          text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40),
          element: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : ''),
        });
      }
    });
    const hide = document.createElement('style');
    hide.id = 'dc-contrast';
    hide.textContent = '[data-dc-contrast] { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }';
    document.head.append(hide);
    return found;
  });

  for (const text of texts) Object.assign(text, { darkest: 1, lightest: 0, darkAt: null, lightAt: null });
  for (const moment of moments) {
    if (moment !== 'still') await page.evaluate((t) => window.dcMotion.seek(t), moment);
    for (const text of texts) {
      const el = page.locator(`[data-dc-contrast="${text.i}"]`);
      if (!(await el.count())) continue; // an effect put back its own markup, which is measured as itself
      await el.scrollIntoViewIfNeeded();
      if (moment !== 'still') await page.evaluate((t) => window.dcMotion.seek(t), moment); // scrolling may have redrawn
      // The text's own line boxes, not the element's: a button's border and the corners outside
      // its radius are not behind its words.
      const box = await el.evaluate((node) => {
        const rects = [...node.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()).flatMap((n) => {
          const range = document.createRange();
          range.selectNodeContents(n);
          return [...range.getClientRects()];
        });
        if (!rects.length) return null;
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        return { x: left, y: top, width: Math.max(...rects.map((r) => r.right)) - left, height: Math.max(...rects.map((r) => r.bottom)) - top };
      });
      const clip = box && inView(box);
      if (!clip) continue;
      const shot = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
      const [low, high] = await luminanceRange(shot);
      const at = moment === 'still' ? 'the still' : `${moment}s`;
      if (low < text.darkest) Object.assign(text, { darkest: low, darkAt: at });
      if (high > text.lightest) Object.assign(text, { lightest: high, lightAt: at });
    }
  }
  await page.evaluate(() => {
    document.getElementById('dc-contrast')?.remove();
    document.querySelectorAll('[data-dc-contrast]').forEach((el) => delete el.dataset.dcContrast);
  });
  return texts;
}

/** The part of a box on screen, or null: a screenshot's clip can't reach past the viewport. */
function inView({ x, y, width, height }) {
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(VIEWPORT.width, x + width);
  const bottom = Math.min(VIEWPORT.height, y + height);
  return right - left >= 1 && bottom - top >= 1 ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

/** The 2nd and 98th percentiles of a screenshot's relative luminance. */
async function luminanceRange(png) {
  const { default: sharp } = await import('sharp'); // a site's own dependency, needed only here
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const values = new Float64Array(info.width * info.height);
  for (let p = 0, i = 0; i < data.length; i += 3, p++) values[p] = luminance(data[i], data[i + 1], data[i + 2]);
  values.sort();
  const at = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  return [at(0.02), at(0.98)];
}

const LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function luminance(r, g, b) {
  return 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
}

const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Each text element's worst contrast across the still and the moments. */
function mergeContrast(still, moving) {
  const all = [...(still ?? []), ...(moving ?? [])];
  const byText = new Map();
  for (const t of all) {
    const key = `${t.effect}:${t.element}:${t.text}`;
    const seen = byText.get(key);
    if (!seen) byText.set(key, { ...t });
    else {
      if (t.darkest < seen.darkest) Object.assign(seen, { darkest: t.darkest, darkAt: t.darkAt });
      if (t.lightest > seen.lightest) Object.assign(seen, { lightest: t.lightest, lightAt: t.lightAt });
    }
  }
  return [...byText.values()].filter((t) => t.darkAt || t.lightAt).map((t) => {
    const [r, g, b] = t.color.match(/[\d.]+/g).map(Number);
    const text = luminance(Math.round(r), Math.round(g), Math.round(b));
    const dark = ratio(text, t.darkest);
    const light = ratio(text, t.lightest);
    return {
      text: t.text, element: t.element, large: t.large, needs: t.large ? 3 : 4.5,
      ratio: Math.min(dark, light), at: dark <= light ? t.darkAt : t.lightAt,
    };
  });
}
