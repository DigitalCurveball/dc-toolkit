// WebGL for the effects that colour a whole surface: one fragment shader over a triangle that
// covers the canvas. WebGL 1, which every browser that can run these has, on the low-power GPU
// where there are two, with the context's loss and return passed to the runtime (runtime.js), so
// the still shows meanwhile.

const VERTEX = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

/**
 * A shader surface on `canvas`, or null where WebGL or the shader is unavailable.
 * `uniform(name)` is a uniform's location; `draw()` draws the whole canvas.
 */
export function surface(canvas, fragment, { lost, restored } = {}) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const program = link(gl, fragment);
  if (!program) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

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

function link(gl, fragment) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      console.error('dc-motion: a shader did not compile', gl.getShaderInfoLog(shader));
      return null;
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    console.error('dc-motion: a shader did not link', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

/** A colour as CSS writes it in hex (#rgb or #rrggbb) as three numbers from 0 to 1, or null. */
export function rgb(hex) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join('') : match[1];
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255);
}
