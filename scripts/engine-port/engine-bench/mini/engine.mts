// Throwaway minimal 2D engine: WebGL2, sprite batching into one dynamic VBO (flush on texture/camera change),
// static per-room tile VBOs, fixed-timestep loop, AABB-vs-tile collision. No scene graph, no input, no text.
const VS = `#version 300 es
in vec2 aPos; in vec2 aUV; in vec4 aCol;
uniform vec4 uCam; out vec2 vUV; out vec4 vCol;
void main(){ vUV=aUV; vCol=aCol; gl_Position=vec4(aPos*uCam.xy+uCam.zw,0.0,1.0); }`;
const FS = `#version 300 es
precision mediump float; in vec2 vUV; in vec4 vCol; uniform sampler2D uTex; out vec4 o;
void main(){ o=texture(uTex,vUV)*vCol; }`;
const MAX_QUADS = 16383, STRIDE = 20; // x y u v (f32) + rgba8

export class Renderer {
  constructor(canvas) {
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl2');
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = this.prog = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aUV'); gl.bindAttribLocation(p, 2, 'aCol');
    gl.linkProgram(p); gl.useProgram(p);
    this.uCam = gl.getUniformLocation(p, 'uCam');
    this.ab = new ArrayBuffer(MAX_QUADS * 4 * STRIDE); this.f32 = new Float32Array(this.ab); this.u32 = new Uint32Array(this.ab);
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let i = 0, v = 0; i < idx.length; i += 6, v += 4) { idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2; idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3; }
    this.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.vao = this.makeVAO(this.vbo = gl.createBuffer(), this.ab.byteLength, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.02, 0.02, 0.02, 1);
    this.n = 0; this.tex = null; this.W = canvas.width; this.H = canvas.height;
  }
  makeVAO(buf, bytesOrData, usage) {
    const gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, bytesOrData, usage);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, STRIDE, 16);
    gl.bindVertexArray(null); return vao;
  }
  texture(canvas, repeat = false) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    return { gl: t, w: canvas.width, h: canvas.height };
  }
  // camera: centre (cx,cy), zoom z ; screen camera: cx=W/2, cy=H/2, z=1
  camera(cx, cy, z) {
    this.flush();
    const sx = 2 * z / this.W, sy = -2 * z / this.H;
    cx = Math.round(cx * z) / z; cy = Math.round(cy * z) / z; // roundPixels
    this.gl.uniform4f(this.uCam, sx, sy, -cx * sx, -cy * sy);
    this.view = { x0: cx - this.W / (2 * z), y0: cy - this.H / (2 * z), x1: cx + this.W / (2 * z), y1: cy + this.H / (2 * z) };
  }
  begin() { const gl = this.gl; gl.viewport(0, 0, this.W, this.H); gl.clear(gl.COLOR_BUFFER_BIT); this.n = 0; this.tex = null; }
  // pixel-space source rect (sx,sy,sw,sh) of texture tex; colour 0xAABBGGRR
  quad(tex, x, y, w, h, sx, sy, sw, sh, col = 0xffffffff, flip = false) {
    if (tex !== this.tex || this.n === MAX_QUADS) { this.flush(); this.tex = tex; }
    const iw = 1 / tex.w, ih = 1 / tex.h;
    let u0 = sx * iw, u1 = (sx + sw) * iw; const v0 = sy * ih, v1 = (sy + sh) * ih;
    if (flip) { const t = u0; u0 = u1; u1 = t; }
    const f = this.f32, u = this.u32; let o = this.n * 20; this.n++;
    const x1 = x + w, y1 = y + h;
    f[o] = x; f[o + 1] = y; f[o + 2] = u0; f[o + 3] = v0; u[o + 4] = col;
    f[o + 5] = x1; f[o + 6] = y; f[o + 7] = u1; f[o + 8] = v0; u[o + 9] = col;
    f[o + 10] = x1; f[o + 11] = y1; f[o + 12] = u1; f[o + 13] = v1; u[o + 14] = col;
    f[o + 15] = x; f[o + 16] = y1; f[o + 17] = u0; f[o + 18] = v1; u[o + 19] = col;
  }
  flush() {
    if (!this.n) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.f32, 0, this.n * 20);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.gl);
    gl.drawElements(gl.TRIANGLES, this.n * 6, gl.UNSIGNED_SHORT, 0);
    this.n = 0;
  }
  // static tile layer: list of [tex, x, y, w, h, sx, sy, sw, sh]
  staticLayer(tex, quads) {
    const save = this.n; this.n = 0; const prevTex = this.tex; this.tex = tex;
    for (const q of quads) this.quad(tex, q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7]);
    const data = this.f32.slice(0, this.n * 20), count = this.n; this.n = save; this.tex = prevTex;
    const buf = this.gl.createBuffer(); const vao = this.makeVAO(buf, data, this.gl.STATIC_DRAW);
    return { tex, vao, count };
  }
  drawStatic(L) {
    this.flush(); const gl = this.gl;
    gl.bindVertexArray(L.vao); gl.bindTexture(gl.TEXTURE_2D, L.tex.gl);
    gl.drawElements(gl.TRIANGLES, L.count * 6, gl.UNSIGNED_SHORT, 0); this.tex = null;
  }
}

// AABB (top-left x,y, w,h) movers vs solid tile query
export function moveBody(b, dt, solidAt, statics) {
  b.vy = Math.min(b.vy + b.g * dt, 600);
  b.blockedL = b.blockedR = b.blockedD = false;
  // X
  b.x += b.vx * dt;
  const ty0 = Math.floor(b.y / 16), ty1 = Math.floor((b.y + b.h - 0.01) / 16);
  if (b.vx > 0) { const tx = Math.floor((b.x + b.w) / 16); for (let ty = ty0; ty <= ty1; ty++) if (solidAt(tx, ty)) { b.x = tx * 16 - b.w; b.blockedR = true; break; } }
  else if (b.vx < 0) { const tx = Math.floor(b.x / 16); for (let ty = ty0; ty <= ty1; ty++) if (solidAt(tx, ty)) { b.x = (tx + 1) * 16; b.blockedL = true; break; } }
  if (statics) for (const s of statics) if (b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y) { if (b.vx > 0) { b.x = s.x - b.w; b.blockedR = true; } else if (b.vx < 0) { b.x = s.x + s.w; b.blockedL = true; } }
  // Y
  b.y += b.vy * dt;
  const tx0 = Math.floor(b.x / 16), tx1 = Math.floor((b.x + b.w - 0.01) / 16);
  if (b.vy > 0) { const ty = Math.floor((b.y + b.h) / 16); for (let tx = tx0; tx <= tx1; tx++) if (solidAt(tx, ty)) { b.y = ty * 16 - b.h; b.vy = 0; b.blockedD = true; break; } }
  else if (b.vy < 0) { const ty = Math.floor(b.y / 16); for (let tx = tx0; tx <= tx1; tx++) if (solidAt(tx, ty)) { b.y = (ty + 1) * 16; b.vy = 0; break; } }
  if (statics) for (const s of statics) if (b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y) { if (b.vy > 0) { b.y = s.y - b.h; b.vy = 0; b.blockedD = true; } else if (b.vy < 0) { b.y = s.y + s.h; b.vy = 0; } }
}

export function runLoop(update, render, hooks) {
  const STEP = 1000 / 60; let acc = 0, last = performance.now();
  const frame = now => {
    hooks.frameStart();
    acc += Math.min(now - last, 250); last = now;
    while (acc >= STEP) { update(STEP / 1000, now); acc -= STEP; }
    hooks.updDone();
    render(now);
    hooks.frameEnd();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
