// A moving background in the brand's colours (dc-pipeline #50): soft fields of colour over the
// first colour, the ground, drifting slowly through warped space and leaning toward the pointer.
//
// Its still is the same fields where they start, as CSS gradients (`still()`), and the first
// frame draws exactly that, so the fade from the still to the effect is barely seen. The fields
// are composited the way CSS composites gradients, one over another, so the still and the frames
// share their colours: it is opaque, and text over it is checked against its frames (dc-qa).
//
// Options (data-motion-options, or the component's props):
//   colors   two to five colours in hex, the first the ground
//   speed    1; 0.5 is half as fast
//   pointer  how far the fields lean toward a mouse or pen, 0.5; 0 ignores it
//   grain    0.03, a static texture that keeps the gradients from banding; 0 for none
//
// It draws at half the element's CSS pixels and 30 frames a second: a soft, slow gradient looks
// the same scaled up and at that rate, for an eighth of the work at full size and 60, which is
// what decides it on a phone's battery and in a lab test's throttled CPU (CI's Lighthouse drew
// it in software at 560 ms of blocking time at full size and 60, 2026-11-24).

import { rgb, surface } from './gl.js';

// Where each field starts, and its size, as fractions of the element's width and height: the
// same numbers for the still's CSS and the shader, so they meet.
const FIELDS = [
  { at: [0.16, 0.2], size: [0.62, 0.7], drift: [0.21, 0.17], phase: [0.4, 1.9] },
  { at: [0.86, 0.16], size: [0.56, 0.66], drift: [0.16, 0.23], phase: [2.6, 0.7] },
  { at: [0.7, 0.9], size: [0.66, 0.62], drift: [0.24, 0.15], phase: [1.3, 2.8] },
  { at: [0.1, 0.88], size: [0.5, 0.58], drift: [0.18, 0.2], phase: [3.4, 4.1] },
];
const DRIFT = 0.14; // how far a field wanders, as a fraction of the element
const WARP = 0.16; // how far the noise bends space
const LEAN = 0.22; // how far the fields lean toward the pointer at `pointer: 1`

// One minus smoothstep, at the quarters: the shader's falloff as stops CSS can draw.
const STOPS = [[0, 1], [25, 0.84375], [50, 0.5], [75, 0.15625], [100, 0]];

/** The still for `colors`: the value of a CSS `background`. */
export function still(colors) {
  const [ground, ...fields] = colors.slice(0, 5).map(rgb);
  if (!ground) return 'none';
  const layers = fields.flatMap((colour, i) => {
    if (!colour) return [];
    const { at, size } = FIELDS[i];
    const [r, g, b] = colour.map((c) => Math.round(c * 255));
    const stops = STOPS.map(([p, a]) => `rgb(${r} ${g} ${b} / ${a}) ${p}%`).join(', ');
    return [`radial-gradient(${pct(size[0])} ${pct(size[1])} at ${pct(at[0])} ${pct(at[1])}, ${stops})`];
  });
  // CSS paints its first layer on top; the shader paints the first field first, at the bottom.
  const [r, g, b] = ground.map((c) => Math.round(c * 255));
  return [...layers.reverse(), `rgb(${r} ${g} ${b})`].join(', ');
}

const pct = (n) => `${Math.round(n * 1000) / 10}%`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_size;
uniform float u_time;
uniform float u_count;
uniform float u_grain;
uniform vec3 u_ground;
uniform vec3 u_color[4];
uniform vec2 u_at[4];
uniform vec2 u_extent[4];

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 bend(vec2 uv, float t) {
  return vec2(noise(uv * 1.7 + vec2(t * 0.07, 0.0)), noise(uv * 1.7 + vec2(5.2, t * 0.06))) - 0.5;
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) / u_size; // from the top left, as CSS
  vec2 p = uv + ${WARP.toFixed(3)} * (bend(uv, u_time) - bend(uv, 0.0)); // still at time 0
  vec3 colour = u_ground;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= u_count) break;
    float d = length((p - u_at[i]) / u_extent[i]);
    colour = mix(colour, u_color[i], 1.0 - smoothstep(0.0, 1.0, d));
  }
  colour += (hash(floor(gl_FragCoord.xy)) - 0.5) * u_grain;
  gl_FragColor = vec4(colour, 1.0);
}
`;

export default {
  loops: true,
  fps: 30,
  setup(element, kit) {
    const options = { speed: 1, pointer: 0.5, grain: 0.03, ...kit.options };
    const [ground, ...colours] = (options.colors ?? []).slice(0, 5).map(rgb);
    if (!ground || !colours.length || colours.includes(null)) {
      console.error('dc-motion: the gradient needs two to five colours in hex', options.colors);
      return null;
    }
    const canvas = kit.layer('canvas');
    const shader = surface(canvas, FRAGMENT, { lost: kit.lost, restored: kit.restored });
    if (!shader || shader.status() === 'failed') return null;
    const { gl, uniform } = shader;
    let primed = false;
    // The uniforms that never change, set once the shader is ready to take them.
    const prime = () => {
      gl.uniform3fv(uniform('u_ground'), ground);
      gl.uniform3fv(uniform('u_color'), pad(colours.flat(), 12));
      gl.uniform2fv(uniform('u_extent'), pad(FIELDS.flatMap((f) => f.size), 8));
      gl.uniform1f(uniform('u_count'), colours.length);
      gl.uniform1f(uniform('u_grain'), options.grain);
      primed = true;
    };

    const pointer = kit.pointer();
    const lean = { x: 0.5, y: 0.5, amount: 0 };
    const at = new Float32Array(8);

    return {
      resize(width, height) {
        canvas.width = Math.max(1, Math.round(width / 2));
        canvas.height = Math.max(1, Math.round(height / 2));
      },
      frame(time, delta) {
        const status = shader.status();
        if (status === 'failed') kit.failed();
        if (status !== 'ready') return false;
        if (!primed) prime();
        // The lean eases toward the pointer while it is over the element, and back when it leaves.
        const reach = options.pointer > 0 && pointer.inside ? 1 : 0;
        const ease = 1 - Math.exp(-delta * 2.5);
        lean.amount += (reach - lean.amount) * ease;
        if (pointer.inside) {
          lean.x += (pointer.x - lean.x) * ease;
          lean.y += (pointer.y - lean.y) * ease;
        }
        const t = time * options.speed;
        FIELDS.forEach(({ at: [x, y], drift: [fx, fy], phase: [px, py] }, i) => {
          const dx = DRIFT * (Math.sin(t * fx + px) - Math.sin(px));
          const dy = DRIFT * (Math.cos(t * fy + py) - Math.cos(py));
          const pull = LEAN * options.pointer * lean.amount;
          at[i * 2] = x + dx + (lean.x - x) * pull;
          at[i * 2 + 1] = y + dy + (lean.y - y) * pull;
        });
        gl.uniform2f(uniform('u_size'), canvas.width, canvas.height);
        gl.uniform2fv(uniform('u_at'), at);
        gl.uniform1f(uniform('u_time'), t);
        shader.draw();
      },
      destroy: shader.destroy,
    };
  },
};

function pad(values, length) {
  const out = new Float32Array(length);
  out.set(values.slice(0, length));
  return out;
}
