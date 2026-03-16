import Phaser from 'phaser';
import { playSfx, type SfxCue } from '../audio/sfx';
import { FX_ANIMATION_KEYS } from './manifest';

type GoalFxKind = 'start' | 'checkpoint' | 'success' | 'fail' | 'abandon';

interface SceneFxControllerOptions {
  scene: Phaser.Scene;
  onDisplayObjectsChanged?: () => void;
}

export class SceneFxController {
  private readonly displayObjects = new Set<Phaser.GameObjects.GameObject>();

  constructor(private readonly options: SceneFxControllerOptions) {}

  destroy(): void {
    for (const object of this.displayObjects) {
      object.destroy();
    }
    this.displayObjects.clear();
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return Array.from(this.displayObjects);
  }

  playCollectFx(x: number, y: number, scoreDelta: number, cue: SfxCue = 'collect'): void {
    this.playAnimatedFx(FX_ANIMATION_KEYS['coin-collect'], x, y - 8, {
      scale: 1.4,
      depth: 29,
    });
    this.playAnimatedFx(FX_ANIMATION_KEYS.shine, x, y - 10, {
      scale: 2,
      alpha: 0.8,
      depth: 28,
    });
    this.spawnScorePopup(`+${scoreDelta}`, x, y - 18, '#ffe599');
    playSfx(cue);
  }

  playEnemyKillFx(x: number, y: number): void {
    this.playAnimatedFx(FX_ANIMATION_KEYS.hit, x, y - 8, {
      scale: 1.6,
      depth: 29,
    });
    this.playAnimatedFx(FX_ANIMATION_KEYS.dust, x, y - 2, {
      scale: 1.2,
      depth: 28,
    });
    this.spawnFlash(x, y - 8, 28, 0xfff0b3, 0.3);
    playSfx('enemy-kill');
  }

  playBounceFx(x: number, y: number): void {
    this.playAnimatedFx(FX_ANIMATION_KEYS.boing, x, y - 4, {
      scale: 1.2,
      depth: 28,
    });
    this.spawnFlash(x, y - 4, 24, 0x9deaff, 0.22);
    playSfx('bounce');
  }

  playBombExplosionFx(x: number, y: number): void {
    this.playAnimatedFx(FX_ANIMATION_KEYS['bomb-explosion'], x, y - 10, {
      scale: 1.4,
      depth: 30,
    });
    this.playAnimatedFx(FX_ANIMATION_KEYS.dust, x, y - 4, {
      scale: 1.1,
      depth: 29,
      tint: 0xffd27a,
    });
    this.spawnFlash(x, y - 8, 30, 0xffd27a, 0.28);
    playSfx('enemy-kill');
  }

  playJumpDustFx(x: number, y: number, facing: number): void {
    this.playAnimatedFx(FX_ANIMATION_KEYS['player-jump-dust'], x, y - 2, {
      scale: 1.1,
      depth: 26,
      flipX: facing < 0,
      originY: 1,
    });
    playSfx('jump');
  }

  playLandingDustFx(x: number, y: number, facing: number): void {
    this.playAnimatedFx(FX_ANIMATION_KEYS['player-landing-dust'], x, y - 1, {
      scale: 1.1,
      depth: 26,
      flipX: facing < 0,
      originY: 1,
    });
    playSfx('land');
  }

  playSwordSlashFx(x: number, y: number, facing: number, downward = false): void {
    this.playAnimatedFx(FX_ANIMATION_KEYS.hit, x + (downward ? 0 : facing * 10), y - (downward ? -6 : 6), {
      scale: downward ? 1.35 : 1.2,
      depth: 29,
      flipX: facing < 0,
    });
    this.spawnFlash(x + (downward ? 0 : facing * 8), y - 4, 18, 0xfff0b3, 0.18);
    playSfx('sword-slash');
  }

  playMuzzleFlashFx(x: number, y: number, facing: number): void {
    this.playAnimatedFx(FX_ANIMATION_KEYS['player-muzzle-flash'], x, y, {
      scale: 1,
      depth: 29,
      flipX: facing < 0,
    });
    playSfx('gun-shot');
  }

  playBulletImpactFx(x: number, y: number): void {
    this.playAnimatedFx(FX_ANIMATION_KEYS['player-bullet-impact'], x, y, {
      scale: 0.95,
      depth: 29,
    });
    this.spawnFlash(x, y, 12, 0x9deaff, 0.2);
    playSfx('bullet-impact');
  }

  playGoalFx(kind: GoalFxKind, x: number, y: number, cueOverride?: SfxCue | null): void {
    const playGoalCue = (fallbackCue: SfxCue): void => {
      if (cueOverride === null) {
        return;
      }
      playSfx(cueOverride ?? fallbackCue);
    };

    switch (kind) {
      case 'start':
        this.playAnimatedFx(FX_ANIMATION_KEYS.shine, x, y - 20, {
          scale: 2.2,
          depth: 30,
          alpha: 0.9,
        });
        playGoalCue('goal-start');
        break;
      case 'checkpoint':
        this.playAnimatedFx(FX_ANIMATION_KEYS['shine-white'], x, y - 20, {
          scale: 2.4,
          depth: 30,
          alpha: 0.95,
        });
        this.spawnRing(x, y - 12, 0x7de5ff);
        playGoalCue('goal-checkpoint');
        break;
      case 'success':
        this.playAnimatedFx(FX_ANIMATION_KEYS['bomb-explosion'], x, y - 16, {
          scale: 1.5,
          depth: 31,
        });
        this.playAnimatedFx(FX_ANIMATION_KEYS.shine, x, y - 20, {
          scale: 3,
          depth: 30,
          alpha: 0.9,
        });
        this.spawnRing(x, y - 14, 0xffd27a);
        playGoalCue('goal-success');
        break;
      case 'fail':
      case 'abandon':
        this.playAnimatedFx(FX_ANIMATION_KEYS.hit, x, y - 16, {
          scale: 1.4,
          depth: 30,
          tint: 0xff6b6b,
        });
        this.playAnimatedFx(FX_ANIMATION_KEYS.dust, x, y - 10, {
          scale: 1.1,
          depth: 29,
          tint: 0xff8b8b,
        });
        this.spawnRing(x, y - 10, 0xff6b6b);
        playGoalCue(kind === 'abandon' ? 'challenge-abandon' : 'goal-fail');
        break;
      default:
        break;
    }
  }

  private playAnimatedFx(
    animationKey: string,
    x: number,
    y: number,
    options: {
      depth?: number;
      scale?: number;
      alpha?: number;
      tint?: number;
      flipX?: boolean;
      originX?: number;
      originY?: number;
    } = {},
  ): Phaser.GameObjects.Sprite {
    const animation = this.options.scene.anims.get(animationKey);
    const firstFrame = animation?.frames[0];
    const sprite = this.options.scene.add.sprite(
      x,
      y,
      firstFrame?.textureKey ?? '__MISSING',
      firstFrame?.textureFrame
    );
    sprite.setDepth(options.depth ?? 26);
    sprite.setScale(options.scale ?? 1);
    sprite.setAlpha(options.alpha ?? 1);
    sprite.setFlipX(Boolean(options.flipX));
    sprite.setOrigin(options.originX ?? 0.5, options.originY ?? 0.5);
    if (options.tint !== undefined) {
      sprite.setTint(options.tint);
    }
    this.track(sprite);
    sprite.play(animationKey);
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      sprite.destroy();
    });
    return sprite;
  }

  private spawnScorePopup(text: string, x: number, y: number, color: string): void {
    const label = this.options.scene.add.text(x, y, text, {
      fontFamily: 'Courier New',
      fontSize: '12px',
      color,
      stroke: '#050505',
      strokeThickness: 3,
    });
    label.setOrigin(0.5);
    label.setDepth(32);
    this.track(label);
    this.options.scene.tweens.add({
      targets: label,
      y: y - 18,
      alpha: 0,
      duration: 460,
      ease: 'Quad.easeOut',
      onComplete: () => {
        label.destroy();
      },
    });
  }

  private spawnFlash(x: number, y: number, radius: number, color: number, alpha: number): void {
    const flash = this.options.scene.add.circle(x, y, radius, color, alpha);
    flash.setDepth(27);
    this.track(flash);
    this.options.scene.tweens.add({
      targets: flash,
      scaleX: 1.35,
      scaleY: 1.35,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => {
        flash.destroy();
      },
    });
  }

  private spawnRing(x: number, y: number, color: number): void {
    const ring = this.options.scene.add.circle(x, y, 14);
    ring.setDepth(27);
    ring.setStrokeStyle(2, color, 0.88);
    this.track(ring);
    this.options.scene.tweens.add({
      targets: ring,
      scaleX: 2.1,
      scaleY: 2.1,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => {
        ring.destroy();
      },
    });
  }

  private track<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.displayObjects.add(object);
    this.options.onDisplayObjectsChanged?.();
    object.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.displayObjects.delete(object);
      this.options.onDisplayObjectsChanged?.();
    });
    return object;
  }
}
