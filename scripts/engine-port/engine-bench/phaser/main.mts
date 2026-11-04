import '../common/mark.mts';
import Phaser from 'phaser';
import {
  bench, buildWorkload, installGLCounter, scenario, playerIntent, hudRect, HUD_RECTS,
  RW, RH, RPW, RPH, TILE, VIEW_W, VIEW_H, PLAY_ZOOM, MAP_ZOOM, GRAVITY, JUMP_V, STAR_LAYERS,
  objRect, playerRect, previewRect,
} from '../common/common.mts';
window.__tImported = performance.now();
installGLCounter();

class BenchScene extends Phaser.Scene {
  constructor() { super('bench'); }
  create() {
    const W = buildWorkload();
    const tex = this.textures;
    const atlas = tex.addCanvas('atlas', W.atlas);
    for (let type = 0; type < 32; type++) for (let f = 0; f < 4; f++) { const r = objRect(type, f); atlas.add(`o${type}_${f}`, 0, r[0], r[1], r[2], r[3]); }
    for (let f = 0; f < 4; f++) { const r = playerRect(f); atlas.add(`p${f}`, 0, r[0], r[1], r[2], r[3]); }
    tex.addCanvas('stars', W.stars);
    const prev = tex.addCanvas('preview', W.previewAtlas);
    for (const room of W.previews) { const r = previewRect(room.previewSlot); prev.add(`s${room.previewSlot}`, 0, r[0], r[1], r[2], r[3]); }
    for (let type = 0; type < 32; type++) this.anims.create({ key: `a${type}`, frames: [0, 1, 2, 3].map(f => ({ key: 'atlas', frame: `o${type}_${f}` })), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'run', frames: [0, 1, 2, 3].map(f => ({ key: 'atlas', frame: `p${f}` })), frameRate: 10, repeat: -1 });

    const cam = this.cameras.main;
    cam.setRoundPixels(true);
    this.starSprites = [];
    this.enemies = [];
    this.hud = this.add.graphics().setScrollFactor(0).setDepth(100);

    for (const room of W.previews) {
      const img = this.add.image(room.ox + RPW / 2, room.oy + RPH / 2, 'preview', `s${room.previewSlot}`);
      img.setDisplaySize(RPW, RPH).setDepth(5);
    }

    if (scenario === 'worldmap') {
      for (let i = 0; i < 2; i++) {
        const ts = this.add.tileSprite(0, 0, VIEW_W, VIEW_H, 'stars').setOrigin(0, 0).setScrollFactor(0).setDepth(1).setAlpha(STAR_LAYERS[i].alpha);
        ts.setTileScale(STAR_LAYERS[i].tileScale, STAR_LAYERS[i].tileScale);
        this.starSprites.push({ s: ts, cfg: STAR_LAYERS[i] });
      }
      this.markers = [];
      for (let i = 0; i < 20; i++) { const m = this.add.sprite(0, 0, 'atlas', 'o5_0').setScale(8).setDepth(50); m.play(`a${i % 20}`); this.markers.push(m); }
      this.grid = this.add.graphics().setDepth(40);
      cam.setZoom(MAP_ZOOM);
      this.mapT = 0;
      bench.ready = true;
      return;
    }

    // ----- play / playTilemap -----
    const physics = this.physics;
    const player = physics.add.sprite(-300, 19 * TILE, 'atlas', 'p0').setDepth(25);
    player.body.setSize(12, 22).setGravityY(GRAVITY).setMaxVelocity(400, 600);
    player.play('run');
    this.player = player; this.intent = { dir: 1, n: 0 }; this.hits = 0;
    const statics = [];
    for (const room of W.full) {
      const { ox, oy } = room;
      this.add.rectangle(ox, oy, RPW, RPH, 0x0b0f1a).setOrigin(0, 0).setDepth(8);
      for (let i = 0; i < 2; i++) {
        const c = STAR_LAYERS[i];
        const ts = this.add.tileSprite(ox, oy, RPW, RPH, 'stars').setOrigin(0, 0).setDepth(9 + i * 0.1).setAlpha(c.alpha);
        this.starSprites.push({ s: ts, cfg: c });
      }
      const map = this.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: RW, height: RH });
      const tileset = map.addTilesetImage('atlas', 'atlas', TILE, TILE, 0, 0, 0);
      const fill = (layer, data) => { for (let i = 0; i < data.length; i++) if (data[i] >= 0) layer.putTileAt(data[i], i % RW, (i / RW) | 0); };
      let terrainLayer;
      if (scenario === 'play') {
        tex.addCanvas(`room${room.rx}_${room.ry}`, room.baseCanvas);
        tex.addCanvas(`fg${room.rx}_${room.ry}`, room.fgCanvas);
        this.add.image(ox + RPW / 2, oy + RPH / 2, `room${room.rx}_${room.ry}`).setDepth(10);
        this.add.image(ox + RPW / 2, oy + RPH / 2, `fg${room.rx}_${room.ry}`).setDepth(30);
        terrainLayer = map.createBlankLayer(`t${room.rx}_${room.ry}`, tileset, ox, oy);
        fill(terrainLayer, room.terrain);
        terrainLayer.setVisible(false);
      } else {
        const bgL = map.createBlankLayer(`b${room.rx}_${room.ry}`, tileset, ox, oy).setDepth(10); fill(bgL, room.bg);
        terrainLayer = map.createBlankLayer(`t${room.rx}_${room.ry}`, tileset, ox, oy).setDepth(11); fill(terrainLayer, room.terrain);
        const fgL = map.createBlankLayer(`f${room.rx}_${room.ry}`, tileset, ox, oy).setDepth(30); fill(fgL, room.fg);
      }
      terrainLayer.setCollisionByExclusion([-1]);
      physics.add.collider(player, terrainLayer);
      const roomEnemies = [];
      for (const o of room.objects) {
        const x = ox + o.x, y = oy + o.y;
        if (o.kind === 'deco') {
          const s = this.add.sprite(x, y, 'atlas', `o${o.type}_0`).setDepth(20);
          if (o.animated) s.play(`a${o.type}`);
        } else if (o.kind === 'solid') {
          const s = this.add.sprite(x, y, 'atlas', `o${o.type}_0`).setDepth(20);
          physics.add.existing(s, true); statics.push(s);
        } else {
          const s = this.add.sprite(x, y, 'atlas', `o${o.type}_0`).setDepth(20);
          physics.add.existing(s);
          s.body.setSize(14, 14).setGravityY(GRAVITY).setVelocityX(o.speed);
          s.play(`a${o.type}`);
          s.speed = Math.abs(o.speed); s.minX = ox + 16; s.maxX = ox + RPW - 16;
          roomEnemies.push(s); this.enemies.push(s);
        }
      }
      physics.add.collider(roomEnemies, terrainLayer);
    }
    physics.add.collider(player, statics);
    physics.add.overlap(player, this.enemies, () => { this.hits++; });
    cam.setZoom(PLAY_ZOOM);
    cam.startFollow(player, true, 1, 1);
    window.__benchExtra = { gameObjects: this.children.list.length, bodies: physics.world.bodies.size + physics.world.staticBodies.size };
    bench.ready = true;
  }

  update(time) {
    const cam = this.cameras.main;
    for (const { s, cfg } of this.starSprites) { s.tilePositionX = (cam.scrollX * cfg.parallax) / cfg.tileScale; s.tilePositionY = (cam.scrollY * cfg.parallax) / cfg.tileScale; }
    const g = this.hud; g.clear();
    for (let i = 0; i < HUD_RECTS; i++) { const [x, y, w, h, c, a] = hudRect(i, time); g.fillStyle(c, a); g.fillRect(x, y, w, h); }
    if (scenario === 'worldmap') {
      this.mapT++;
      cam.centerOn(2000 * Math.sin(this.mapT * 0.01), 300 * Math.cos(this.mapT * 0.013));
      const gr = this.grid; gr.clear(); gr.lineStyle(10, 0x334466, 0.6);
      for (let x = -10; x <= 10; x++) gr.lineBetween(x * RPW, -6 * RPH, x * RPW, 6 * RPH);
      for (let y = -6; y <= 6; y++) gr.lineBetween(-10 * RPW, y * RPH, 10 * RPW, y * RPH);
      this.markers.forEach((m, i) => m.setPosition(Math.sin(this.mapT * 0.02 + i) * 5000, Math.cos(this.mapT * 0.017 + i * 2) * 1800));
      return;
    }
    const p = this.player, b = p.body;
    const it = playerIntent(this.intent, p.x, b.blocked.down);
    b.setVelocityX(it.vx); p.setFlipX(it.vx < 0);
    if (it.jump) b.setVelocityY(JUMP_V);
    for (const e of this.enemies) {
      const eb = e.body;
      if (eb.blocked.left || e.x < e.minX) eb.setVelocityX(e.speed);
      else if (eb.blocked.right || e.x > e.maxX) eb.setVelocityX(-e.speed);
      e.setFlipX(eb.velocity.x < 0);
    }
  }
}

const game = new Phaser.Game({
  type: Phaser.WEBGL, width: VIEW_W, height: VIEW_H, parent: document.body,
  pixelArt: true, roundPixels: true, maxTextures: +(new URLSearchParams(location.search).get('maxTextures') || -1), backgroundColor: '#050505', audio: { noAudio: true }, banner: false,
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  scene: [BenchScene],
});
game.events.on('prestep', () => bench.frameStart());
game.events.on('poststep', () => bench.updDone());
game.events.on('postrender', () => bench.frameEnd());
window.__game = game;
