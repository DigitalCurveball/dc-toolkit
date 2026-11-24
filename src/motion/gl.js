// WebGL for the effects that colour a whole surface: one fragment shader over a triangle that
// covers the canvas. WebGL 1, which every browser that can run these has, on the low-power GPU
// where there are two, with the context's loss and return passed to the runtime (runtime.js), so
// the still shows meanwhile.
//
// The shader compiles in the background where the browser can (KHR_parallel_shader_compile, in
// Chromium): asking whether a shader compiled blocks the page until it has, which on a phone is a
// long task in the middle of loading. `status()` says 'compiling' until it is done, and the effect
// draws nothing till then.
//
// **Only on a graphics chip.** Where the browser draws WebGL in software (SwiftShader, llvmpipe: a
// machine with no working GPU, and every lab test, CI's Lighthouse and PageSpeed Insights among
// them), there is no surface and the effect shows its still, as without WebGL. Starting there costs
// a long task however few pixels are drawn: no background compile, and a first draw that compiles
// the pipeline (locally 7 and 22 ms after a 6 ms context; in CI, a 150 ms task, dc-pipeline #61).
// The renderer is asked straight after the context is made, before anything compiles. The
// browsers' own switch, `failIfMajorPerformanceCaveat`, gave headless Chromium and Firefox a
// context all the same (2026-11-25). The checks, which must see an effect's frames to measure the
// text over them, ask for it anyway: `window.dcMotionSoftware = true` before the page's scripts.

const VERTEX = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

/**
 * A shader surface on `canvas`, or null where WebGL is unavailable. `status()` is 'compiling',
 * 'ready' or 'failed'; once ready, `uniform(name)` is a uniform's location and `draw()` draws the
 * whole canvas.
 */
export function surface(canvas, fragment, { lost, restored } = {}) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return null;
  if (software(gl) && !globalThis.dcMotionSoftware) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  const program = gl.createProgram();
  const shaders = [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]].map(([type, source]) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    return shader;
  });
  gl.linkProgram(program);

  // Asked only once compiling is done, so it never waits.
  const finish = () => {
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (!gl.isContextLost()) {
        for (const shader of shaders) {
          const log = gl.getShaderInfoLog(shader);
          if (log) console.error('dc-motion: a shader did not compile', log);
        }
        console.error('dc-motion: a shader did not link', gl.getProgramInfoLog(program));
      }
      return 'failed';
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    return 'ready';
  };
  let status = parallel ? 'compiling' : finish();

  let destroyed = false;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); // without it, the context never returns
    if (!destroyed) lost?.();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (!destroyed) restored?.();
  });

  const locations = new Map();
  return {
    gl,
    status() {
      if (status === 'compiling' && gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) status = finish();
      return status;
    },
    uniform(name) {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name);
    },
    draw() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      destroyed = true;
      gl.getExtension('WEBGL_lose_context')?.loseContext(); // frees the GPU's memory now, not at collection
    },
  };
}

/** Whether the browser draws this context's WebGL in software, by the renderer it names. */
function software(gl) {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
}

/** A colour as CSS writes it in hex (#rgb or #rrggbb) as three numbers from 0 to 1, or null. */
export function rgb(hex) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join('') : match[1];
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255);
}
