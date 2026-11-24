// The runtime behind every motion effect: what each effect would otherwise repeat, and could get
// wrong, done once (dc-pipeline docs/motion.md, "The bar"). An effect is a module that draws; this
// decides when it may.
//
// - **The still comes first.** An effect's element carries its still in its own markup and CSS (a
//   gradient, a photo): it is what shows without scripts, under reduced motion, before the effect
//   starts and whenever it can't run. The effect draws in a layer over the still and behind the
//   content, and fades in once it has drawn a frame.
// - **Nothing starts until the page has loaded**, and then only once the browser is idle and the
//   element is near the screen. An effect's code is fetched then, so it costs the first paint nothing.
// - **Reduced motion means the still**, and no effect's code is fetched. A change of the setting
//   while the page is open is followed.
// - **One pause control for the page** (WCAG 2.2.2, Level A: anything moving for more than five
//   seconds beside other content can be paused). Every `.dc-motion-toggle` button pauses and
//   resumes every effect, and shows its state in `aria-pressed`. It stays hidden until a looping
//   effect runs, and the choice is remembered from page to page. A paused effect holds its frame.
// - **Off-screen and in a hidden tab, nothing draws.**
// - **A lost WebGL context shows the still**, and the effect starts again if the context returns.
//
// The markup, the same on a site and in a concept (the components in this folder write it):
//
//   <section class="dc-motion" data-motion="gradient" data-motion-options='{"colors":["#111","#f33"]}'
//            style="background: …the still…">…content…</section>
//   <button type="button" class="dc-motion-toggle" aria-pressed="false" hidden>Pause motion</button>
//   <script type="module">
//     import { register } from 'dc-toolkit/motion';
//     register({ gradient: () => import('dc-toolkit/motion/gradient.js') });
//   </script>
//
// An effect module's default export:
//
//   { loops: true, setup(element, kit) { …; return { frame(time, delta), resize(width, height, dpr), destroy() } } }
//
// `setup` returns null when the effect can't run (no WebGL, say), and the still stays. `frame`
// draws the effect at `time`, in seconds of its own running, and depends on nothing else but the
// pointer, so a check can draw any moment (`window.dcMotion.seek`). An effect with no `frame`
// animates in CSS, paused through its element's `data-motion-state`. `loops` is false for an
// effect that plays once and stops within five seconds, which needs no pause control.
//
// Plain JavaScript with no build and no imports, so a concept runs the same file the site does.

const STORE = 'dc-motion-paused';
const effects = new Map(); // a name in data-motion → its effect, or a function that imports it
const records = new Map(); // an element → what the runtime knows of it
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const bound = new WeakSet();
let paused = readPaused();
let hidden = document.hidden;
let begun = false;
let observer = null;
let resizer = null;
let raf = 0;
let last = 0;

/** Makes effects available by name, and starts any on the page once it has loaded. */
export function register(named) {
  for (const [name, effect] of Object.entries(named)) effects.set(name, effect);
  if (begun) return scan();
  begun = true;
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(begin, { timeout: 2000 }) : setTimeout(begin, 200));
  if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
}

function begin() {
  observer = new IntersectionObserver(onIntersect, { rootMargin: '200px 0px' });
  resizer = new ResizeObserver((entries) => entries.forEach((entry) => measure(records.get(entry.target))));
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    update();
  });
  reduce.addEventListener('change', () => {
    for (const record of records.values()) {
      if (reduce.matches) {
        observer.unobserve(record.el);
        teardown(record);
      } else {
        observer.observe(record.el);
      }
    }
    update();
  });
  addEventListener('pointermove', onPointer, { passive: true });
  scan();
}

function scan() {
  bindToggles();
  for (const el of document.querySelectorAll('[data-motion]')) {
    if (records.has(el) || !effects.has(el.dataset.motion)) continue;
    const record = { el, name: el.dataset.motion, state: 'still', reason: null, visible: false, inst: null, layer: null, loops: false, time: 0, drawn: false, lost: false, loading: false, pointer: null };
    records.set(el, record);
    setState(record, 'still');
    if (!reduce.matches) observer.observe(el);
  }
  update();
}

function onIntersect(entries) {
  for (const entry of entries) {
    const record = records.get(entry.target);
    if (!record) continue;
    record.visible = entry.isIntersecting;
    if (record.visible && !record.inst && !record.loading && record.state !== 'failed') setup(record);
  }
  update();
}

async function setup(record) {
  record.loading = true;
  setState(record, 'loading');
  let effect = effects.get(record.name);
  try {
    if (typeof effect === 'function') {
      const module = await effect();
      effect = module.default ?? module;
      effects.set(record.name, effect);
    }
  } catch (error) {
    record.loading = false;
    console.error(`dc-motion: the "${record.name}" effect did not load`, error);
    return fail(record, 'load');
  }
  record.loading = false;
  if (reduce.matches) return setState(record, 'still');
  let inst = null;
  try {
    inst = effect.setup(record.el, kit(record));
  } catch (error) {
    console.error(`dc-motion: the "${record.name}" effect failed to start`, error);
  }
  if (!inst) return fail(record, 'unsupported');
  record.inst = inst;
  record.loops = Boolean(effect.loops);
  record.time = 0;
  record.drawn = false;
  record.lost = false;
  resizer.observe(record.el);
  measure(record);
  if (!inst.frame) reveal(record);
  if (record.loops) showToggles();
  update();
}

/** What an effect is given to work with. */
function kit(record) {
  let options = {};
  try {
    options = JSON.parse(record.el.dataset.motionOptions || '{}');
  } catch {
    console.error(`dc-motion: data-motion-options on a "${record.name}" effect is not JSON`);
  }
  return {
    options,
    /** A layer over the still and behind the content, hidden from assistive technology. */
    layer(tag = 'canvas') {
      const layer = document.createElement(tag);
      layer.className = 'dc-motion-layer';
      layer.setAttribute('aria-hidden', 'true');
      record.el.prepend(layer);
      record.layer = layer;
      return layer;
    },
    /** The pointer over the element, from 0 to 1 each way, from a mouse or pen only. */
    pointer() {
      record.pointer ??= { x: 0.5, y: 0.5, inside: false };
      return record.pointer;
    },
    /** The effect's WebGL context was lost: the still shows until it returns. */
    lost() {
      record.lost = true;
      record.layer?.classList.remove('is-shown');
      update();
    },
    /** The context returned: the effect starts again, from its own setup. */
    restored() {
      teardown(record);
      if (record.visible && !reduce.matches) setup(record);
    },
  };
}

function measure(record) {
  if (!record?.inst) return;
  const { clientWidth: width, clientHeight: height } = record.el;
  record.inst.resize?.(width, height, window.devicePixelRatio || 1);
  // Resizing a canvas clears it, so a paused or idle effect draws its moment again.
  if (record.drawn && record.state !== 'running') draw(record, 0);
}

function draw(record, delta) {
  if (!record.inst?.frame || record.lost) return;
  record.inst.frame(record.time, delta);
  if (!record.drawn) reveal(record);
}

function reveal(record) {
  record.drawn = true;
  record.layer?.classList.add('is-shown');
}

function update() {
  let anyRunning = false;
  for (const record of records.values()) {
    if (!record.inst) continue;
    const running = !paused && !hidden && record.visible && !record.lost;
    const state = running ? 'running' : paused ? 'paused' : 'idle';
    if (state !== record.state) {
      if (running) record.inst.resume?.();
      else if (record.state === 'running') record.inst.pause?.();
      setState(record, state);
    }
    // A paused effect that has not drawn yet (paused on an earlier page) shows its first moment.
    if (!running && !record.drawn && record.visible) draw(record, 0);
    if (running && record.inst.frame) anyRunning = true;
  }
  // For effects that animate in CSS: `[data-motion-paused]` on <html> while the visitor has paused.
  document.documentElement.toggleAttribute('data-motion-paused', paused);
  if (anyRunning && !raf) {
    last = 0;
    raf = requestAnimationFrame(tick);
  }
}

function tick(now) {
  raf = 0;
  const delta = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  let any = false;
  for (const record of records.values()) {
    if (record.state !== 'running' || !record.inst?.frame) continue;
    record.time += delta;
    draw(record, delta);
    any = true;
  }
  if (any) raf = requestAnimationFrame(tick);
}

function teardown(record) {
  try {
    record.inst?.destroy?.();
  } catch (error) {
    console.error(error);
  }
  resizer?.unobserve(record.el);
  record.layer?.remove();
  Object.assign(record, { inst: null, layer: null, drawn: false, lost: false });
  setState(record, 'still');
}

function fail(record, reason) {
  teardown(record);
  record.reason = reason;
  setState(record, 'failed');
}

function setState(record, state) {
  record.state = state;
  record.el.dataset.motionState = state;
}

function onPointer(event) {
  if (event.pointerType === 'touch') return;
  for (const record of records.values()) {
    if (!record.pointer || record.state !== 'running') continue;
    const box = record.el.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    Object.assign(record.pointer, { x, y, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 });
  }
}

function toggles() {
  return document.querySelectorAll('.dc-motion-toggle');
}

function bindToggles() {
  for (const button of toggles()) {
    if (bound.has(button)) continue;
    bound.add(button);
    button.setAttribute('aria-pressed', String(paused));
    button.addEventListener('click', () => setPaused(!paused));
  }
}

function showToggles() {
  const buttons = toggles();
  if (!buttons.length) console.warn('dc-motion: a looping effect runs with no .dc-motion-toggle on the page (WCAG 2.2.2)');
  for (const button of buttons) button.hidden = false;
}

function setPaused(value) {
  paused = value;
  try {
    if (value) localStorage.setItem(STORE, '1');
    else localStorage.removeItem(STORE);
  } catch {
    // No storage (a private window, blocked site data): the choice lasts this page.
  }
  for (const button of toggles()) button.setAttribute('aria-pressed', String(value));
  update();
}

function readPaused() {
  try {
    return localStorage.getItem(STORE) === '1';
  } catch {
    return false;
  }
}

// For the checks, and for anyone looking from the console.
window.dcMotion = {
  /** Every effect on the page: its element, name, state (still, loading, running, paused, idle, failed), whether it loops, and why it failed. */
  instances: () => [...records.values()].map(({ el, name, state, loops, reason }) => ({ element: el, effect: name, state, loops, reason })),
  pause: () => setPaused(true),
  resume: () => setPaused(false),
  /** Draws every effect at `time` seconds; pause first, or the next frame moves on from there. */
  seek(time) {
    for (const record of records.values()) {
      if (!record.inst?.frame) continue;
      record.time = time;
      draw(record, 0);
    }
  },
};
