// Photos that ripple (dc-pipeline #52): the cursor drops ripples where it moves over a photo, like
// a finger drawn through water, with a faint glint on each wave, and they fade within about two
// seconds, leaving the photo exactly as it was. A phone has no cursor: there, a photo ripples once
// from its centre as it scrolls into view. A photo already on the screen when the page opens
// stays still until it is hovered, so nothing wobbles at a visitor on arrival and nothing runs
// while the page loads.
//
// Its still is the photo itself, the element's first <img> or the one marked `data-motion-still`,
// which screen readers keep throughout. The ripple is drawn over it only while it moves, from a
// copy made at the size the photo is drawn, cropped as the page crops it (object-fit, with
// object-position in percentages), so the photo comes back unchanged. The photo must be from the
// site's own origin, or served with CORS: WebGL can't read another's.
//
// It moves only when the visitor does, for about two seconds: it needs no pause control
// (`loops: false`), and draws nothing while nothing moves.
//
// Options (data-motion-options, or the component's props):
//   strength  how far the ripples bend the photo, 1; 0.5 is half as far
//   pointer   1; 0 ignores the cursor, leaving the ripple as a photo scrolls in
//   enter     true; false leaves a photo still as it scrolls in, so only the cursor ripples it
//
// One WebGL context for the page, made when the first photo ripples and shared by every photo:
// each draws its frame there and copies it to its own canvas, so a gallery costs one context, not
// one a photo, and nothing until it moves.

import { surface } from './gl.js';

const DROPS = 8; // ripples drawn at once; the oldest is given up first
const SPACING = 28; // how far the cursor moves between one drop and the next, in CSS pixels
const ENTER = 1.3; // the strength of the ripple as a photo scrolls in, beside a cursor's 1
const SPEED = 240; // how fast a ring spreads, in CSS pixels a second
const WAVELENGTH = 30; // from one crest to the next, in CSS pixels
const WIDTH = 46; // how wide a ring's band of waves is, in CSS pixels
const DECAY = 1.9; // how quickly a ripple dies, a second
const AMPLITUDE = 6; // how far the photo bends at a ripple's strongest, in CSS pixels
const MOST = 9; // the most the photo bends where ripples overlap, in CSS pixels
const GLINT = 0.006; // how much light a wave catches, for each CSS pixel it bends, up to 6% brighter or darker
const STILL = 0.15; // below this bend, in CSS pixels, a ripple is over

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_photo;
uniform vec2 u_size; // the photo in device pixels
uniform vec2 u_box; // and in CSS pixels
uniform vec4 u_drops[${DROPS}]; // each ripple: where, in CSS pixels from the top left; its age, in seconds; its strength
uniform float u_count;

void main() {
  vec2 uv = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) / u_size; // from the top left, as CSS
  vec2 p = uv * u_box;
  vec2 bend = vec2(0.0);
  float glint = 0.0;
  for (int i = 0; i < ${DROPS}; i++) {
    if (float(i) >= u_count) break;
    vec4 drop = u_drops[i];
    vec2 away = p - drop.xy;
    float dist = length(away);
    float x = dist - drop.z * ${SPEED.toFixed(1)}; // from the ring's front
    float wave = exp(-(x * x) / ${(WIDTH * WIDTH).toFixed(1)}) * exp(-drop.z * ${DECAY.toFixed(2)})
      * smoothstep(0.0, 0.12, drop.z) * drop.w * ${AMPLITUDE.toFixed(1)};
    float phase = x * ${((2 * Math.PI) / WAVELENGTH).toFixed(5)};
    bend += away / max(dist, 1.0) * sin(phase) * wave;
    glint += cos(phase) * wave;
  }
  // Ripples crossing add up, but only so far: a slow drag drops them close together.
  bend /= max(1.0, length(bend) / ${MOST.toFixed(1)});
  vec3 colour = texture2D(u_photo, clamp(uv - bend / u_box, 0.0, 1.0)).rgb;
  gl_FragColor = vec4(colour + clamp(glint * ${GLINT.toFixed(4)}, -0.06, 0.06), 1.0);
}
`;

/** How long a ripple of `strength` lasts, in seconds, before it bends the photo less than STILL. */
const life = (strength) => Math.log((AMPLITUDE * strength) / STILL) / DECAY;

let gpu = null; // the page's one context, once a photo has rippled
let unavailable = false;

/** The shared context, made the first time it is asked for; null where WebGL is unavailable. */
function shared() {
  if (gpu?.restored) gpu = null; // a context that came back is made again, with its program
  if (gpu || unavailable) return gpu;
  const canvas = document.createElement('canvas');
  const s = surface(canvas, FRAGMENT, {
    lost: () => (gpu.lost = true),
    restored: () => (gpu.restored = true),
  });
  if (!s) {
    unavailable = true;
    return null;
  }
  gpu = { ...s, canvas, lost: false, restored: false };
  return gpu;
}

const scratch = document.createElement('canvas'); // where a photo is drawn at its size, to upload

export default {
  loops: false,
  setup(element, kit) {
    const options = { strength: 1, pointer: 1, enter: true, ...kit.options };
    const photo = element.querySelector('[data-motion-still]') ?? element.querySelector('img');
    if (!photo) {
      console.error('dc-motion: the ripple has no <img> inside it to draw');
      return null;
    }
    photo.setAttribute('data-motion-still', '');
    const canvas = kit.layer('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    // The ripple and the photo swap at once: the ripple's first and last frames are the photo.
    canvas.style.transition = photo.style.transition = 'none';
    canvas.width = canvas.height = 1; // its pixels are kept only while it ripples

    const pointer = kit.pointer();
    // Each ripple: where it starts, as a share of the photo's width and height; when, in the
    // effect's time; and how strong it is.
    const drops = [];
    if (options.enter && !kit.opening) drops.push({ x: 0.5, y: 0.5, t: 0, s: ENTER * options.strength });
    let trail = null; // where the cursor last dropped one
    let width = 0;
    let height = 0;
    let ratio = 1;
    let shown = false;
    let texture = null; // the photo, in the shared context, while it ripples
    const uniform = new Float32Array(DROPS * 4);

    function hide() {
      if (shown) {
        canvas.classList.remove('is-shown');
        canvas.width = canvas.height = 1;
        shown = false;
      }
      if (texture && texture.gpu === gpu && !gpu.lost) gpu.gl.deleteTexture(texture.id);
      texture = null;
      return false;
    }

    /** The photo, drawn at `w` by `h` device pixels as the page draws it, into the shared context. */
    function upload(w, h) {
      scratch.width = w;
      scratch.height = h;
      const place = fitted(photo, w, h, ratio);
      scratch.getContext('2d').drawImage(photo, ...place);
      const { gl } = gpu;
      const id = texture?.gpu === gpu ? texture.id : gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, id);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Throws for a photo from another origin without CORS.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
      // What the page shows of the photo in its box: all of it, but for a photo fitted with
      // `contain`, whose margins stay clear.
      const [x0, y0] = [Math.max(0, place[0]), Math.max(0, place[1])];
      const [x1, y1] = [Math.min(w, place[0] + place[2]), Math.min(h, place[1] + place[3])];
      texture = { id, gpu, w, h, shows: [x0, y0, x1 - x0, y1 - y0].map(Math.round) };
    }

    return {
      resize(w, h, dpr) {
        width = w;
        height = h;
        ratio = Math.min(dpr, 2);
        if (shown) {
          canvas.width = Math.round(w * ratio);
          canvas.height = Math.round(h * ratio);
        }
      },
      frame(time) {
        if (!drops.length && !(options.pointer > 0 && pointer.inside)) return hide();
        const outer = element.getBoundingClientRect();
        const rect = photo.getBoundingClientRect();
        const pw = rect.width;
        const ph = rect.height;
        if (!pw || !ph || !photo.complete || !photo.naturalWidth) return hide();
        const left = rect.left - outer.left - element.clientLeft;
        const top = rect.top - outer.top - element.clientTop;

        // The cursor drops a ripple each time it has moved SPACING over the photo.
        const x = pointer.x * width - left;
        const y = pointer.y * height - top;
        if (options.pointer > 0 && pointer.inside && x >= 0 && y >= 0 && x <= pw && y <= ph) {
          if (!trail || Math.hypot(x - trail.x, y - trail.y) >= SPACING) {
            drops.push({ x: x / pw, y: y / ph, t: time, s: options.pointer * options.strength });
            if (drops.length > DROPS) drops.shift();
            trail = { x, y };
          }
        } else {
          trail = null;
        }
        // Ripples that are over are let go; one not yet begun (a moment drawn again) is kept.
        for (let i = drops.length - 1; i >= 0; i--) if (time - drops[i].t > life(drops[i].s)) drops.splice(i, 1);
        const live = drops.filter((d) => time > d.t);
        if (!live.length) return hide();

        const status = shared()?.status() ?? 'failed';
        if (status === 'failed') {
          kit.failed();
          return false;
        }
        if (status !== 'ready' || gpu.lost) return hide();

        const w = Math.round(pw * ratio);
        const h = Math.round(ph * ratio);
        if (texture?.gpu !== gpu || texture.w !== w || texture.h !== h) {
          try {
            upload(w, h);
          } catch (error) {
            console.error('dc-motion: the ripple could not read its photo', error);
            kit.failed();
            return false;
          }
        }

        const { gl, uniform: at } = gpu;
        if (gpu.canvas.width < w || gpu.canvas.height < h) {
          gpu.canvas.width = Math.max(gpu.canvas.width, w);
          gpu.canvas.height = Math.max(gpu.canvas.height, h);
        }
        uniform.fill(0);
        live.forEach((d, i) => uniform.set([d.x * pw, d.y * ph, time - d.t, d.s], i * 4));
        gl.bindTexture(gl.TEXTURE_2D, texture.id);
        gl.uniform2f(at('u_size'), w, h);
        gl.uniform2f(at('u_box'), pw, ph);
        gl.uniform4fv(at('u_drops'), uniform);
        gl.uniform1f(at('u_count'), live.length);
        gpu.draw(w, h);

        if (!shown) {
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
          canvas.classList.add('is-shown');
          shown = true;
        }
        const [tx, ty, tw, th] = texture.shows;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(gpu.canvas, tx, gpu.canvas.height - h + ty, tw, th, Math.round(left * ratio) + tx, Math.round(top * ratio) + ty, tw, th);
      },
      destroy() {
        hide();
      },
    };
  },
};

/**
 * Where the whole photo goes in a `w` by `h` box of device pixels, as the page fits it: [x, y,
 * width, height], overflowing the box for `cover`. The whole photo is placed and the box clips it,
 * rather than a part of it cut out, because for a photo chosen through srcset, as Astro's are,
 * naturalWidth is corrected for density, in CSS pixels, while a cut is made in the photo's own.
 */
function fitted(photo, w, h, ratio) {
  const nw = photo.naturalWidth * ratio;
  const nh = photo.naturalHeight * ratio;
  const style = getComputedStyle(photo);
  const [px, py] = style.objectPosition.split(' ').map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : 0.5));
  const scale = {
    cover: Math.max(w / nw, h / nh),
    contain: Math.min(w / nw, h / nh),
    'scale-down': Math.min(1, w / nw, h / nh),
    none: 1,
  }[style.objectFit];
  if (!scale) return [0, 0, w, h]; // fill
  return [(w - nw * scale) * px, (h - nh * scale) * py, nw * scale, nh * scale];
}
