import '../common/mark.mts';
import { Renderer, moveBody, runLoop } from './engine.mts';
import {
  bench, buildWorkload, installGLCounter, scenario, playerIntent, hudRect, HUD_RECTS, params,
  RW, RH, RPW, RPH, VIEW_W, VIEW_H, PLAY_ZOOM, MAP_ZOOM, GRAVITY, JUMP_V, STAR_LAYERS,
  tileRect, objRect, playerRect, previewRect, WHITE,
} from '../common/common.mts';
window.__tImported = performance.now();
installGLCounter();
const CULL = params.get('cull') !== '0';

const canvas = document.createElement('canvas'); canvas.width = VIEW_W; canvas.height = VIEW_H; document.body.appendChild(canvas);
const R = new Renderer(canvas);
const W = buildWorkload();
const atlas = R.texture(W.atlas), stars = R.texture(W.stars, true), prevTex = R.texture(W.previewAtlas);
const rgba = (rgb, a) => ((Math.round(a * 255) << 24) | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)) >>> 0;
const visible = (x, y, w, h) => !CULL || (x < R.view.x1 && x + w > R.view.x0 && y < R.view.y1 && y + h > R.view.y0);

// room page: all baked room layers in ONE texture (purpose-built-engine choice; WAMP/Phaser use one texture per room layer)
let roomPage = null;
const rooms = W.full;
const roomMap = new Map(rooms.map(r => [r.rx + ',' + r.ry, r]));
if (scenario === 'play') {
  const c = document.createElement('canvas'); c.width = 4 * RPW; c.height = 5 * RPH; const g = c.getContext('2d');
  rooms.forEach((r, i) => { const s = i * 2; r.baseSlot = [(s % 4) * RPW, ((s / 4) | 0) * RPH]; r.fgSlot = [((s + 1) % 4) * RPW, (((s + 1) / 4) | 0) * RPH]; g.drawImage(r.baseCanvas, r.baseSlot[0], r.baseSlot[1]); g.drawImage(r.fgCanvas, r.fgSlot[0], r.fgSlot[1]); });
  roomPage = R.texture(c);
} else if (scenario === 'playTilemap') {
  for (const r of rooms) {
    const quads = (layers) => { const q = []; for (const L of layers) for (let i = 0; i < L.length; i++) { const t = L[i]; if (t < 0) continue; const [sx, sy] = tileRect(t); q.push([r.ox + (i % RW) * 16, r.oy + ((i / RW) | 0) * 16, 16, 16, sx, sy, 16, 16]); } return q; };
    r.baseLayer = R.staticLayer(atlas, quads([r.bg, r.terrain])); r.fgLayer = R.staticLayer(atlas, quads([r.fg]));
  }
}
const solidAt = (tx, ty) => {
  const rx = Math.floor(tx / RW), ry = Math.floor(ty / RH); const r = roomMap.get(rx + ',' + ry); if (!r) return false;
  return r.terrain[(ty - ry * RH) * RW + (tx - rx * RW)] >= 0;
};

// entities
const player = { x: -306, y: 19 * 16 - 11, w: 12, h: 22, vx: 0, vy: 0, g: GRAVITY, blockedD: false, flip: false };
const intent = { dir: 1, n: 0 }; let hits = 0;
const statics = [], enemies = [];
for (const r of rooms) {
  r.decos = []; r.ents = [];
  for (const o of r.objects) {
    const x = r.ox + o.x, y = r.oy + o.y;
    if (o.kind === 'deco') r.decos.push({ x: x - 8, y: y - 8, type: o.type, animated: o.animated });
    else if (o.kind === 'solid') { const s = { x: x - 8, y: y - 8, w: 16, h: 16, type: o.type }; statics.push(s); r.decos.push({ x: s.x, y: s.y, type: o.type, animated: false }); }
    else { const e = { x: x - 7, y: y - 7, w: 14, h: 14, vx: o.speed, vy: 0, g: GRAVITY, speed: Math.abs(o.speed), minX: r.ox + 16, maxX: r.ox + RPW - 16, type: o.type }; enemies.push(e); r.ents.push(e); }
  }
}
let mapT = 0; const markers = Array.from({ length: 20 }, (_, i) => ({ i, x: 0, y: 0 }));
bench.ready = true;
window.__benchExtra = { quadsLastFrame: 0 };

function update(dt) {
  if (scenario === 'worldmap') { mapT++; markers.forEach(m => { m.x = Math.sin(mapT * 0.02 + m.i) * 5000; m.y = Math.cos(mapT * 0.017 + m.i * 2) * 1800; }); return; }
  const it = playerIntent(intent, player.x + 6, player.blockedD);
  player.vx = it.vx; player.flip = it.vx < 0; if (it.jump) player.vy = JUMP_V;
  moveBody(player, dt, solidAt, statics);
  for (const e of enemies) {
    if (e.blockedL || e.x + 7 < e.minX) e.vx = e.speed; else if (e.blockedR || e.x + 7 > e.maxX) e.vx = -e.speed;
    moveBody(e, dt, solidAt, null);
    if (player.x < e.x + e.w && player.x + player.w > e.x && player.y < e.y + e.h && player.y + player.h > e.y) hits++;
  }
}

function render(now) {
  R.begin();
  const anim = (base, fps) => Math.floor(now * fps / 1000) % 4;
  let quads = 0;
  if (scenario === 'worldmap') {
    const cx = 2000 * Math.sin(mapT * 0.01), cy = 300 * Math.cos(mapT * 0.013);
    R.camera(VIEW_W / 2, VIEW_H / 2, 1);
    for (const c of STAR_LAYERS) { const ox = (cx - VIEW_W / (2 * MAP_ZOOM)) * c.parallax / c.tileScale, oy = (cy - VIEW_H / (2 * MAP_ZOOM)) * c.parallax / c.tileScale; R.quad(stars, 0, 0, VIEW_W, VIEW_H, ox, oy, VIEW_W / c.tileScale, VIEW_H / c.tileScale, rgba(0xffffff, c.alpha)); }
    R.camera(cx, cy, MAP_ZOOM);
    for (const r of W.previews) if (visible(r.ox, r.oy, RPW, RPH)) { const s = previewRect(r.previewSlot); R.quad(prevTex, r.ox, r.oy, RPW, RPH, s[0], s[1], s[2], s[3]); quads++; }
    const lc = rgba(0x334466, 0.6);
    for (let x = -10; x <= 10; x++) R.quad(atlas, x * RPW - 5, -6 * RPH, 10, 12 * RPH, WHITE[0] + 2, WHITE[1] + 2, 2, 2, lc);
    for (let y = -6; y <= 6; y++) R.quad(atlas, -10 * RPW, y * RPH - 5, 20 * RPW, 10, WHITE[0] + 2, WHITE[1] + 2, 2, 2, lc);
    for (const m of markers) { const o = objRect(5 + (m.i % 15), anim(0, 8)); R.quad(atlas, m.x - 64, m.y - 64, 128, 128, o[0], o[1], o[2], o[3]); }
  } else {
    const cx = player.x + 6, cy = player.y + 11;
    R.camera(cx, cy, PLAY_ZOOM);
    for (const r of W.previews) if (visible(r.ox, r.oy, RPW, RPH)) { const s = previewRect(r.previewSlot); R.quad(prevTex, r.ox, r.oy, RPW, RPH, s[0], s[1], s[2], s[3]); }
    const vis = rooms.filter(r => visible(r.ox, r.oy, RPW, RPH));
    const bgc = rgba(0x1a0f0b, 1);
    for (const r of vis) R.quad(atlas, r.ox, r.oy, RPW, RPH, WHITE[0] + 2, WHITE[1] + 2, 2, 2, bgc);
    const view0x = cx - VIEW_W / (2 * PLAY_ZOOM), view0y = cy - VIEW_H / (2 * PLAY_ZOOM);
    for (const c of STAR_LAYERS) { const col = rgba(0xffffff, c.alpha); for (const r of vis) R.quad(stars, r.ox, r.oy, RPW, RPH, view0x * c.parallax / c.tileScale, view0y * c.parallax / c.tileScale, RPW / c.tileScale, RPH / c.tileScale, col); }
    if (scenario === 'play') for (const r of vis) R.quad(roomPage, r.ox, r.oy, RPW, RPH, r.baseSlot[0], r.baseSlot[1], RPW, RPH);
    else for (const r of vis) R.drawStatic(r.baseLayer);
    for (const r of vis) {
      for (const d of r.decos) { const o = objRect(d.type, d.animated ? anim(0, 8) : 0); R.quad(atlas, d.x, d.y, 16, 16, o[0], o[1], 16, 16); quads++; }
      for (const e of r.ents) { const o = objRect(e.type, anim(0, 8)); R.quad(atlas, e.x - 1, e.y - 1, 16, 16, o[0], o[1], 16, 16, 0xffffffff, e.vx < 0); quads++; }
    }
    const pf = playerRect(anim(0, 10)); R.quad(atlas, player.x - 2, player.y - 1, 16, 24, pf[0], pf[1], 16, 24, 0xffffffff, player.flip);
    if (scenario === 'play') for (const r of vis) R.quad(roomPage, r.ox, r.oy, RPW, RPH, r.fgSlot[0], r.fgSlot[1], RPW, RPH);
    else for (const r of vis) R.drawStatic(r.fgLayer);
  }
  R.camera(VIEW_W / 2, VIEW_H / 2, 1);
  for (let i = 0; i < HUD_RECTS; i++) { const [x, y, w, h, c, a] = hudRect(i, now); R.quad(atlas, x, y, w, h, WHITE[0] + 2, WHITE[1] + 2, 2, 2, rgba(c, a)); }
  R.flush();
  window.__benchExtra.quadsLastFrame = quads; window.__benchExtra.hits = hits;
}

runLoop(update, render, bench);
