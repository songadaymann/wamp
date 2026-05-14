import Phaser from 'phaser';

export type CombatPresentationSource = 'sword' | 'gun';
export type CombatPresentationOwner = 'local' | 'remote';

export interface CombatPresentationEvent {
  id: string;
  owner: CombatPresentationOwner;
  source: CombatPresentationSource;
  x: number;
  y: number;
  facing: -1 | 1;
  startedAt: number;
  durationMs: number;
  effectX: number;
  effectY: number;
  downward: boolean;
  projectile: {
    x: number;
    y: number;
    velocityX: number;
    lifetimeMs: number;
  } | null;
}

export interface CombatPresentationOptions {
  autoUpdateProjectile?: boolean;
}

export interface PresentedProjectile {
  id: string;
  owner: CombatPresentationOwner;
  rect: Phaser.GameObjects.Rectangle;
  startX: number;
  startY: number;
  velocityX: number;
  createdAt: number;
  expiresAt: number;
  autoUpdate: boolean;
}

interface PresentedSwordBlade {
  id: string;
  owner: CombatPresentationOwner;
  container: Phaser.GameObjects.Container;
}

interface OverworldCombatPresentationControllerHost {
  scene: Phaser.Scene;
  playSwordSlashFx(x: number, y: number, facing: -1 | 1, downward: boolean): void;
  playMuzzleFlashFx(x: number, y: number, facing: -1 | 1): void;
  onDisplayObjectsChanged?: () => void;
}

export class OverworldCombatPresentationController {
  private readonly projectiles = new Map<string, PresentedProjectile>();
  private readonly swordBlades = new Map<string, PresentedSwordBlade>();

  constructor(private readonly host: OverworldCombatPresentationControllerHost) {}

  present(
    event: CombatPresentationEvent,
    options: CombatPresentationOptions = {},
  ): PresentedProjectile | null {
    if (event.source === 'sword') {
      this.spawnSwordBlade(event);
      this.host.playSwordSlashFx(event.effectX, event.effectY, event.facing, event.downward);
      return null;
    }

    this.host.playMuzzleFlashFx(event.effectX, event.effectY, event.facing);
    if (!event.projectile) {
      return null;
    }

    const projectile = this.spawnProjectile(event, options.autoUpdateProjectile === true);
    return projectile;
  }

  update(now = Date.now()): void {
    for (const projectile of [...this.projectiles.values()]) {
      if (!projectile.rect.active || now >= projectile.expiresAt) {
        this.destroyProjectile(projectile);
        continue;
      }

      if (!projectile.autoUpdate) {
        continue;
      }

      const elapsedSeconds = Math.max(0, now - projectile.createdAt) / 1000;
      projectile.rect.setPosition(
        projectile.startX + projectile.velocityX * elapsedSeconds,
        projectile.startY,
      );
    }
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return [
      ...[...this.projectiles.values()].map((projectile) => projectile.rect),
      ...[...this.swordBlades.values()].map((blade) => blade.container),
    ];
  }

  getProjectileCount(): number {
    return this.projectiles.size;
  }

  destroyProjectile(projectile: PresentedProjectile): void {
    if (this.projectiles.get(projectile.id) === projectile) {
      this.projectiles.delete(projectile.id);
    }
    if (projectile.rect.active) {
      projectile.rect.destroy();
    }
    this.host.onDisplayObjectsChanged?.();
  }

  destroyProjectiles(owner?: CombatPresentationOwner): void {
    for (const projectile of [...this.projectiles.values()]) {
      if (!owner || projectile.owner === owner) {
        this.destroyProjectile(projectile);
      }
    }
    for (const blade of [...this.swordBlades.values()]) {
      if (!owner || blade.owner === owner) {
        this.destroySwordBlade(blade);
      }
    }
  }

  private spawnSwordBlade(event: CombatPresentationEvent): void {
    const bladeId = `${event.owner}:blade:${event.id}`;
    const existing = this.swordBlades.get(bladeId);
    if (existing) {
      this.destroySwordBlade(existing);
    }

    const scene = this.host.scene;
    const anchorX = event.effectX + (event.downward ? 0 : event.facing * 7);
    const anchorY = event.effectY + (event.downward ? 4 : -4);
    const container = scene.add.container(anchorX, anchorY);
    container.setDepth(event.owner === 'remote' ? 31 : 30);
    container.setAlpha(0.96);

    if (event.downward) {
      this.populateDownwardSwordBlade(container, event.facing);
    } else {
      this.populateSideSwordBlade(container, event.facing);
    }

    const blade: PresentedSwordBlade = {
      id: bladeId,
      owner: event.owner,
      container,
    };
    this.swordBlades.set(blade.id, blade);
    this.host.onDisplayObjectsChanged?.();

    scene.tweens.add({
      targets: container,
      alpha: 0,
      scaleX: event.downward ? 0.86 : 1.18,
      scaleY: event.downward ? 1.18 : 0.9,
      duration: Phaser.Math.Clamp(event.durationMs, 120, 260),
      ease: 'Quad.easeOut',
      onComplete: () => this.destroySwordBlade(blade),
    });
  }

  private populateSideSwordBlade(
    container: Phaser.GameObjects.Container,
    facing: -1 | 1,
  ): void {
    const scene = this.host.scene;
    const direction = facing;
    container.setRotation(direction > 0 ? -0.18 : 0.18);

    const glow = scene.add.rectangle(direction * 16, 0, 40, 13, 0x9deaff, 0.2);
    glow.setOrigin(direction > 0 ? 0 : 1, 0.5);
    const blade = scene.add.rectangle(direction * 2, 0, 32, 5, 0x9fffe5, 0.96);
    blade.setOrigin(direction > 0 ? 0 : 1, 0.5);
    const core = scene.add.rectangle(direction * 4, -0.5, 24, 2, 0xffffff, 0.86);
    core.setOrigin(direction > 0 ? 0 : 1, 0.5);
    const tip = scene.add.triangle(
      direction * 34,
      0,
      direction > 0 ? 0 : 7,
      -4,
      direction > 0 ? 7 : 0,
      0,
      direction > 0 ? 0 : 7,
      4,
      0x9fffe5,
      0.96,
    );
    const hilt = scene.add.rectangle(-direction * 2, 2, 5, 11, 0x1aa88f, 1);
    hilt.setRotation(direction * 0.45);
    container.add([glow, blade, core, tip, hilt]);
  }

  private populateDownwardSwordBlade(
    container: Phaser.GameObjects.Container,
    facing: -1 | 1,
  ): void {
    const scene = this.host.scene;
    container.setRotation(facing > 0 ? 0.1 : -0.1);

    const glow = scene.add.rectangle(0, 16, 14, 42, 0x9deaff, 0.2);
    glow.setOrigin(0.5, 0);
    const blade = scene.add.rectangle(0, 2, 5, 34, 0x9fffe5, 0.96);
    blade.setOrigin(0.5, 0);
    const core = scene.add.rectangle(-0.5, 5, 2, 26, 0xffffff, 0.86);
    core.setOrigin(0.5, 0);
    const tip = scene.add.triangle(0, 38, -4, 0, 4, 0, 0, 8, 0x9fffe5, 0.96);
    const hilt = scene.add.rectangle(0, -2, 12, 5, 0x1aa88f, 1);
    container.add([glow, blade, core, tip, hilt]);
  }

  private destroySwordBlade(blade: PresentedSwordBlade): void {
    if (this.swordBlades.get(blade.id) === blade) {
      this.swordBlades.delete(blade.id);
    }
    if (blade.container.active) {
      blade.container.destroy(true);
    }
    this.host.onDisplayObjectsChanged?.();
  }

  private spawnProjectile(
    event: CombatPresentationEvent,
    autoUpdate: boolean,
  ): PresentedProjectile {
    const projectileId = `${event.owner}:${event.id}`;
    const existing = this.projectiles.get(projectileId);
    if (existing) {
      this.destroyProjectile(existing);
    }

    const projectilePayload = event.projectile;
    if (!projectilePayload) {
      throw new Error('Cannot spawn a combat projectile without projectile payload.');
    }

    const rect = this.host.scene.add.rectangle(
      projectilePayload.x,
      projectilePayload.y,
      8,
      3,
      0x9deaff,
      1,
    );
    rect.setDepth(event.owner === 'remote' ? 28 : 27);

    const projectile: PresentedProjectile = {
      id: projectileId,
      owner: event.owner,
      rect,
      startX: projectilePayload.x,
      startY: projectilePayload.y,
      velocityX: projectilePayload.velocityX,
      createdAt: event.startedAt,
      expiresAt: event.startedAt + projectilePayload.lifetimeMs,
      autoUpdate,
    };
    this.projectiles.set(projectile.id, projectile);
    this.host.onDisplayObjectsChanged?.();
    return projectile;
  }
}
