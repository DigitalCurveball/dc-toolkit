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
// While a photo ripples it has a WebGL canvas of its own, laid over the photo and drawn directly,
// and lets it go once the ripple settles: a gallery holds a context only for each photo moving,
// and none until one does. One context shared by every photo, each copying its frame from it, swapped
// two photos rippling at once in Firefox for Android, which read the shared canvas out of step
// (2026-11-25).

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
    // The ripple and the photo swap at once: the ripple's first and last frames are the photo.
    photo.style.transition = 'none';

    const pointer = kit.pointer();
    // Each ripple: where it starts, as a share of the photo's width and height; when, in the
    // effect's time; and how strong it is.
    const drops = [];
    if (options.enter && !kit.opening) drops.push({ x: 0.5, y: 0.5, t: 0, s: ENTER * options.strength });
    let trail = null; // where the cursor last dropped one
    let width = 0;
    let height = 0;
    let ratio = 1;
    // While it ripples: its canvas, the WebGL surface on it, and the size the photo was uploaded at.
    let canvas = null;
    let gl = null;
    let uploaded = '';
    let placed = '';
    const uniform = new Float32Array(DROPS * 4);

    /** Lets the canvas and its context go, and the photo shows. */
    function release() {
      gl?.destroy();
      canvas?.remove();
      canvas = gl = null;
      uploaded = placed = '';
      return false;
    }

    /** The photo, its whole drawn at `[x, y, width, height]` within a `w` by `h` canvas, as the texture. */
    function upload(w, h, [x, y, pw, ph]) {
      scratch.width = w;
      scratch.height = h;
      scratch.getContext('2d').drawImage(photo, x * ratio, y * ratio, pw * ratio, ph * ratio);
      const context = gl.gl;
      context.bindTexture(context.TEXTURE_2D, context.createTexture());
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
      // Throws for a photo from another origin without CORS.
      context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, scratch);
    }

    return {
      resize(w, h, dpr) {
        width = w;
        height = h;
        ratio = Math.min(dpr, 2);
      },
      frame(time) {
        if (!drops.length && !(options.pointer > 0 && pointer.inside)) return release();
        const outer = element.getBoundingClientRect();
        const rect = photo.getBoundingClientRect();
        const pw = rect.width;
        const ph = rect.height;
        if (!pw || !ph || !photo.complete || !photo.naturalWidth) return release();
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
        if (!live.length) return release();

        if (!canvas) {
          canvas = kit.layer('canvas');
          canvas.style.transition = 'none';
          gl = surface(canvas, FRAGMENT, { lost: release });
          if (!gl) {
            release();
            kit.failed();
            return false;
          }
        }
        const status = gl.status();
        if (status === 'failed') {
          release();
          kit.failed();
          return false;
        }
        if (status !== 'ready') return false; // the photo shows until the shader is ready

        // The canvas covers what the page shows of the photo: its box, or for a photo fitted with
        // `contain`, the part of the box the photo fills.
        const place = fitted(photo, pw, ph);
        const [sx, sy] = [Math.max(0, place[0]), Math.max(0, place[1])];
        const sw = Math.min(pw, place[0] + place[2]) - sx;
        const sh = Math.min(ph, place[1] + place[3]) - sy;
        const w = Math.max(1, Math.round(sw * ratio));
        const h = Math.max(1, Math.round(sh * ratio));
        const where = [left + sx, top + sy, sw, sh].join(' ');
        if (placed !== where) {
          const style = canvas.style;
          [style.inset, style.left, style.top, style.width, style.height] = ['auto', `${left + sx}px`, `${top + sy}px`, `${sw}px`, `${sh}px`];
          style.borderRadius = getComputedStyle(photo).borderRadius;
          placed = where;
        }
        if (uploaded !== `${w} ${h}`) {
          canvas.width = w;
          canvas.height = h;
          try {
            upload(w, h, [place[0] - sx, place[1] - sy, place[2], place[3]]);
          } catch (error) {
            console.error('dc-motion: the ripple could not read its photo', error);
            release();
            kit.failed();
            return false;
          }
          uploaded = `${w} ${h}`;
        }

        const { gl: context, uniform: at } = gl;
        uniform.fill(0);
        live.forEach((d, i) => uniform.set([d.x * pw - sx, d.y * ph - sy, time - d.t, d.s], i * 4));
        context.uniform2f(at('u_size'), w, h);
        context.uniform2f(at('u_box'), sw, sh);
        context.uniform4fv(at('u_drops'), uniform);
        context.uniform1f(at('u_count'), live.length);
        gl.draw();
        canvas.classList.add('is-shown');
      },
      destroy: release,
    };
  },
};

/**
 * Where the whole photo goes in its `w` by `h` box, in CSS pixels, as the page fits it: [x, y,
 * width, height], overflowing the box for `cover`. The whole photo is placed and the box clips it,
 * rather than a part of it cut out, because for a photo chosen through srcset, as Astro's are,
 * naturalWidth is corrected for density, in CSS pixels, while a cut is made in the photo's own.
 */
function fitted(photo, w, h) {
  const nw = photo.naturalWidth;
  const nh = photo.naturalHeight;
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
