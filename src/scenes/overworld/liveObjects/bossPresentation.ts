import type Phaser from 'phaser';
import { bossPhase } from '../../../enemies/boss';
import type { LoadedRoomObject } from './model';
import type { ArcadeObjectBody } from './bodies';

const paintedHealth = new WeakMap<LoadedRoomObject, number>();

export function createBossPresentation(scene: Phaser.Scene, liveObject: LoadedRoomObject): void {
  if (!liveObject.runtime.boss) return;
  liveObject.bossHealthBar = scene.add.graphics().setDepth(liveObject.sprite.depth + 0.1);
  liveObject.helpers.push(liveObject.bossHealthBar);
  syncBossPresentation(liveObject, scene.time.now);
}

export function syncBossPresentation(liveObject: LoadedRoomObject, now: number): void {
  const boss = liveObject.runtime.boss;
  const bar = liveObject.bossHealthBar;
  if (!boss || !bar?.active) return;
  const body = liveObject.sprite.body as ArcadeObjectBody | null;
  bar.setPosition(
    Math.round((body ? body.center.x : liveObject.sprite.x) - 15),
    Math.round(Math.min(body?.top ?? Infinity,
      liveObject.sprite.y - liveObject.sprite.displayHeight * liveObject.sprite.originY
        + (liveObject.config.previewOffsetY ?? 0) * liveObject.sprite.scaleY) - 9),
  );
  bar.setVisible(liveObject.sprite.visible && boss.health > 0);
  if (paintedHealth.get(liveObject) !== boss.health) {
    bar.clear();
    bar.fillStyle(0x101522, 1).fillRect(0, 0, 30, 6);
    bar.fillStyle(0x405269, 1).fillRect(1, 1, 28, 4);
    bar.fillStyle(bossPhase(boss) === 2 ? 0xffad42 : 0x78e0a1, 1)
      .fillRect(1, 1, Math.ceil(28 * boss.health / boss.maximum), 4);
    paintedHealth.set(liveObject, boss.health);
  }
  if (now < boss.protectedUntil && Math.floor(now / 90) % 2 === 0) {
    liveObject.sprite.setTint(0xffddaa);
  } else {
    liveObject.sprite.clearTint();
  }
}

/** An accepted hit interrupts the attack immediately; the AI preserves this recoil during hurt. */
export function applyBossHitRecoil(
  liveObject: LoadedRoomObject,
  playerBody: Phaser.Physics.Arcade.Body | null,
  now: number,
): void {
  const boss = liveObject.runtime.boss;
  if (!boss) return;
  liveObject.runtime.aiState = 'cooldown';
  liveObject.runtime.actionStartedAt = now;
  liveObject.runtime.activatedUntil = now;
  liveObject.runtime.cooldownUntil = boss.hurtUntil;
  const body = liveObject.sprite.body as Phaser.Physics.Arcade.Body | null;
  if (!body) return;
  const away = playerBody
    ? body.center.x >= playerBody.center.x ? 1 : -1
    : -liveObject.runtime.directionX;
  body.setAllowGravity(true);
  body.setVelocity(away * 100, Math.min(body.velocity.y, -120));
}
