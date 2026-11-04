// Shared synthetic workload + measurement harness used by BOTH the Phaser and the minimal engine builds.
// Browser code: bundled by engine-bench/build.mts, never run by Node.
// Workload shape modelled on WAMP (see src/scenes/overworld/fullRoomPresenter.ts, previewStreaming.ts):
//  - full rooms: 3x3 neighbourhood (FULL_ROOM_BUDGET = (STREAM_RADIUS*2+1)^2, STREAM_RADIUS = 1)
//  - each full room: bg colour Rectangle (depth 8), 2 starfield TileSprites (depth 9/9.1),
//    baked bg+terrain room Image (depth 10), baked foreground Image (depth 30),
//    hidden terrain TilemapLayer used only for Arcade collision, placed objects (Sprites, some animated,
//    some static Arcade bodies, some dynamic Arcade bodies = enemies)
//  - preview ring: 7x7 minus 3x3 = 40 preview room Images (PLAY_NEAR_MAX_PREVIEW_ROOMS = 49)
//  - HUD Graphics redrawn every frame
export const TILE = 16, RW = 40, RH = 22, RPW = 640, RPH = 352;
export const VIEW_W = 1280, VIEW_H = 720;
export const PREVIEW_TILE = 4, PW = RW * PREVIEW_TILE, PH = RH * PREVIEW_TILE; // 160x88
export const PREVIEW_COLS = 24, PREVIEW_ROWS = 12;
const DENS = +(new URLSearchParams(location.search).get('dens') || 1);
export const OBJECTS_PER_ROOM = { deco: 25 * DENS, decoAnimated: 10 * DENS, solid: 8 * DENS, enemy: 7 * DENS };
export const GRAVITY = 900, PLAYER_SPEED = 160, JUMP_V = -380;
export const PLAY_ZOOM = 2, MAP_ZOOM = 0.1;
export const STAR_LAYERS = [{ parallax: 0.035, tileScale: 1, alpha: 1 }, { parallax: 0.12, tileScale: 0.58, alpha: 0.28 }];

export const params = new URLSearchParams(location.search);
export const scenario = params.get('scenario') || 'play'; // play | playTilemap | worldmap
export const WARM = +(params.get('warm') || 120);
export const N = +(params.get('n') || 480);

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- atlas layout (shared) ----------
// tiles: index t in [0,128) at ((t%64)*16, (t>>6)*16) (Phaser tileset with 64 columns -> same mapping)
// object frames: k = type*4+f (type<32, f<4) at ((k%64)*16, 64 + (k>>6)*16)
// player frames f<4: (f*16, 128) size 16x24
// white: (1016,504) 8x8
export const ATLAS_W = 1024, ATLAS_H = 512;
export function tileRect(t) { return [(t % 64) * 16, (t >> 6) * 16, 16, 16]; }
export function objRect(type, f) { const k = type * 4 + f; return [(k % 64) * 16, 64 + (k >> 6) * 16, 16, 16]; }
export function playerRect(f) { return [f * 16, 128, 16, 24]; }
export const WHITE = [1016, 504, 8, 8];

function hsl(h, s, l) { return `hsl(${h},${s}%,${l}%)`; }
export function makeAtlasCanvas() {
  const c = document.createElement('canvas'); c.width = ATLAS_W; c.height = ATLAS_H;
  const g = c.getContext('2d');
  for (let t = 0; t < 128; t++) {
    const [x, y] = tileRect(t);
    g.fillStyle = hsl((t * 37) % 360, 50, 35 + (t % 5) * 6); g.fillRect(x, y, 16, 16);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y, 16, 2); g.fillRect(x, y, 2, 16);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 4 + (t % 6), y + 6, 4, 4);
  }
  for (let type = 0; type < 32; type++) for (let f = 0; f < 4; f++) {
    const [x, y] = objRect(type, f);
    g.fillStyle = hsl((type * 53) % 360, 70, 55); g.fillRect(x + 2, y + 2 + f, 12, 12 - f);
    g.fillStyle = '#000'; g.fillRect(x + 4 + f, y + 5, 2, 2); g.fillRect(x + 9 + f, y + 5, 2, 2);
  }
  for (let f = 0; f < 4; f++) { const [x, y] = playerRect(f); g.fillStyle = '#ffd34d'; g.fillRect(x + 3, y + 2, 10, 20 - (f & 1)); g.fillStyle = '#222'; g.fillRect(x + 8, y + 6, 2, 2); }
  g.fillStyle = '#fff'; g.fillRect(WHITE[0], WHITE[1], WHITE[2], WHITE[3]);
  return c;
}
export function makeStarsCanvas() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d'); const r = rng(7);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; g.fillRect((r() * 128) | 0, (r() * 128) | 0, 1 + (r() < 0.1), 1); }
  return c;
}

// ---------- rooms ----------
export function genRoom(rx, ry) {
  const r = rng(((rx + 1000) * 73856093) ^ ((ry + 1000) * 19349663));
  const n = RW * RH;
  const bg = new Int16Array(n).fill(-1), terrain = new Int16Array(n).fill(-1), fg = new Int16Array(n).fill(-1);
  for (let y = 20; y < 22; y++) for (let x = 0; x < RW; x++) terrain[y * RW + x] = (r() * 16) | 0; // solid floor
  const platforms = [];
  for (let p = 0; p < 5; p++) {
    const len = 3 + ((r() * 6) | 0), px = 2 + ((r() * (RW - len - 4)) | 0), py = 6 + ((r() * 11) | 0);
    for (let x = px; x < px + len; x++) terrain[py * RW + x] = 16 + ((r() * 16) | 0);
    platforms.push([px, py, len]);
  }
  for (let i = 0; i < n; i++) { if (i < 20 * RW && terrain[i] < 0 && r() < 0.25) bg[i] = 64 + ((r() * 16) | 0); if (terrain[i] < 0 && r() < 0.05) fg[i] = 96 + ((r() * 16) | 0); }
  const objects = [];
  const O = OBJECTS_PER_ROOM;
  for (let i = 0; i < O.deco; i++) objects.push({ kind: 'deco', type: (r() * 20) | 0, animated: i < O.decoAnimated, x: 8 + r() * (RPW - 16), y: 8 + r() * (19 * 16) });
  for (let i = 0; i < O.solid; i++) { const p = platforms[i % platforms.length]; objects.push({ kind: 'solid', type: 20 + (i % 4), animated: false, x: (p[0] + (i % p[2])) * 16 + 8, y: (p[1] - 1) * 16 + 8 }); }
  for (let i = 0; i < O.enemy; i++) objects.push({ kind: 'enemy', type: 24 + (i % 8), animated: true, x: 40 + (i % 7) * 80 + r() * 20, y: 19 * 16 + 8, speed: (40 + r() * 20) * (r() < 0.5 ? -1 : 1) });
  return { rx, ry, ox: rx * RPW, oy: ry * RPH, bg, terrain, fg, objects };
}

export function bakeRoom(atlas, room, layers, scale, ctx, dx, dy) {
  const ts = TILE * scale;
  for (const name of layers) {
    const L = room[name];
    for (let i = 0; i < L.length; i++) { const t = L[i]; if (t < 0) continue; const [sx, sy] = tileRect(t); ctx.drawImage(atlas, sx, sy, 16, 16, dx + (i % RW) * ts, dy + ((i / RW) | 0) * ts, ts, ts); }
  }
}
export function roomCanvas(atlas, room, layers) {
  const c = document.createElement('canvas'); c.width = RPW; c.height = RPH;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false; bakeRoom(atlas, room, layers, 1, g, 0, 0); return c;
}

// preview atlas: PREVIEW_COLS x PREVIEW_ROWS slots of 160x88 (4 px per tile) — one texture in both engines
export function makePreviewAtlas(atlas, rooms) {
  const c = document.createElement('canvas'); c.width = PREVIEW_COLS * PW; c.height = PREVIEW_ROWS * PH;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  rooms.forEach((room, i) => {
    const sx = (i % PREVIEW_COLS) * PW, sy = ((i / PREVIEW_COLS) | 0) * PH;
    g.fillStyle = '#10141c'; g.fillRect(sx, sy, PW, PH);
    bakeRoom(atlas, room, ['bg', 'terrain', 'fg'], PREVIEW_TILE / TILE, g, sx, sy);
    room.previewSlot = i;
  });
  return c;
}
export function previewRect(slot) { return [(slot % PREVIEW_COLS) * PW, ((slot / PREVIEW_COLS) | 0) * PH, PW, PH]; }

export function buildWorkload() {
  const t0 = performance.now();
  const atlas = makeAtlasCanvas(), stars = makeStarsCanvas();
  let full = [], previews = [];
  if (scenario === 'worldmap') {
    for (let ry = -6; ry < 6; ry++) for (let rx = -10; rx < 10; rx++) previews.push(genRoom(rx, ry));
  } else {
    for (let ry = -3; ry <= 3; ry++) for (let rx = -3; rx <= 3; rx++) {
      const room = genRoom(rx, ry);
      if (Math.abs(rx) <= 1 && Math.abs(ry) <= 1) full.push(room); else previews.push(room);
    }
  }
  const previewAtlas = makePreviewAtlas(atlas, previews);
  const bakeLayers = scenario === 'play';
  if (bakeLayers) for (const room of full) { room.baseCanvas = roomCanvas(atlas, room, ['bg', 'terrain']); room.fgCanvas = roomCanvas(atlas, room, ['fg']); }
  bench.genMs = performance.now() - t0;
  return { atlas, stars, full, previews, previewAtlas };
}

// shared scripted input
export function playerIntent(state, x, onGround) {
  if (x > 1240) state.dir = -1; else if (x < -600) state.dir = 1;
  state.n++;
  return { vx: state.dir * PLAYER_SPEED, jump: onGround && state.n % 45 === 0 };
}
export const HUD_RECTS = 30;
export function hudRect(i, t) { return [16 + (i % 10) * 14, 16 + ((i / 10) | 0) * 14, 12, 12, ((i * 2654435761) >>> 8) & 0xffffff, 0.5 + 0.5 * Math.sin(t * 0.003 + i)]; }

// ---------- measurement harness ----------
export const bench = {
  genMs: 0, frame: 0, ready: false, recording: false, done: false,
  dc: 0, tex: 0, buf: 0,
  upd: new Float64Array(N), rnd: new Float64Array(N), tot: new Float64Array(N), dcs: new Float64Array(N), texs: new Float64Array(N), bufs: new Float64Array(N), intervals: new Float64Array(N),
  i: 0, _t0: 0, _t1: 0, _last: 0,
  frameStart() { this._t0 = performance.now(); this.dc = 0; this.tex = 0; this.buf = 0; },
  updDone() { this._t1 = performance.now(); },
  frameEnd() {
    const t2 = performance.now();
    if (!this.ready) return;
    if (!window.__tFirstFrame) window.__tFirstFrame = t2;
    this.frame++;
    if (this.frame > WARM && this.i < N) {
      const i = this.i++;
      this.upd[i] = this._t1 - this._t0; this.rnd[i] = t2 - this._t1; this.tot[i] = t2 - this._t0;
      this.dcs[i] = this.dc; this.texs[i] = this.tex; this.bufs[i] = this.buf; this.intervals[i] = this._t0 - this._last;
      if (this.i === N) this.finish();
    }
    this._last = this._t0;
  },
  finish() {
    const med = a => { const s = Array.from(a).sort((x, y) => x - y); return s[s.length >> 1]; };
    const p = (a, q) => { const s = Array.from(a).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    window.__benchResult = {
      updMed: med(this.upd), rndMed: med(this.rnd), totMed: med(this.tot), totP95: p(this.tot, 0.95), totMean: mean(this.tot),
      dcMed: med(this.dcs), texMed: med(this.texs), bufBytesMed: med(this.bufs), intervalMed: med(this.intervals),
      tFirstFrame: window.__tFirstFrame, t0: window.__t0, tImported: window.__tImported, tEvalStart: window.__tEvalStart, genMs: this.genMs,
      extra: window.__benchExtra || {},
    };
    this.done = true;
  },
};
window.__bench = bench;

export function installGLCounter() {
  const wrap = (proto, name, fn) => { const orig = proto[name]; if (!orig) return; proto[name] = function (...a) { fn(a); return orig.apply(this, a); }; };
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) wrap(P, n, () => { bench.dc++; });
    for (const n of ['texImage2D', 'texSubImage2D']) wrap(P, n, () => { bench.tex++; });
    wrap(P, 'bufferData', a => { const d = a[1]; bench.buf += typeof d === 'number' ? 0 : (d && d.byteLength) || 0; });
    wrap(P, 'bufferSubData', a => { const d = a[2]; bench.buf += a[4] != null ? a[4] * (d.BYTES_PER_ELEMENT || 1) : (d && d.byteLength) || 0; });
  }
}
