import Phaser from 'phaser';
import { playSfx } from '../../audio/sfx';
import type { DefaultPlayerAnimationState } from '../../player/defaultPlayer';
import type {
  CombatPresentationEvent,
  CombatPresentationOptions,
  PresentedProjectile,
} from './combatPresentation';
import type { WeaponHitResult } from './liveObjects';
import { createForwardSwordAttackRect } from './swordGeometry';

export interface OverworldPlayerProjectile {
  presentation: PresentedProjectile;
  directionX: number;
  speed: number;
  expiresAt: number;
}

interface OverworldCombatControllerHost {
  getCurrentTime(): number;
  getPlayer(): Phaser.GameObjects.Rectangle | null;
  getPlayerBody(): Phaser.Physics.Arcade.Body | null;
  getPlayerFacing(): -1 | 1;
  isPlayerCrouching(): boolean;
  attackEnemiesInRect(attackRect: Phaser.Geom.Rectangle, maxHits: number, hitKeys: Set<string>): WeaponHitResult[];
  attackEnemyAtPoint(worldX: number, worldY: number, radius: number): WeaponHitResult | null;
  attackPeerInRect(attackRect: Phaser.Geom.Rectangle, source: 'sword'): WeaponHitResult | null;
  attackPeerAtPoint(worldX: number, worldY: number, source: 'gun'): WeaponHitResult | null;
  isProjectileBlocked(worldX: number, worldY: number): boolean;
  applyWeaponKnockback(velocityX: number): void;
  presentCombatEvent(
    event: CombatPresentationEvent,
    options?: CombatPresentationOptions,
  ): PresentedProjectile | null;
  destroyPresentedProjectile(projectile: PresentedProjectile): void;
  playBulletImpactFx(x: number, y: number): void;
  playPeerHitFx(x: number, y: number): void;
  shakeCamera(durationMs: number, intensity: number): void;
  publishCombatAction(event: CombatPresentationEvent): void;
}

interface OverworldCombatControllerOptions {
  playerStandingHeight: number;
  swordCooldownMs: number;
  swordAttackMs: number;
  swordActiveMs: number;
  swordMaxHitsPerSwing: number;
  swordHitLungeVelocity: number;
  downwardSlashBounceVelocity: number;
  gunCooldownMs: number;
  gunAttackMs: number;
  gunHitRadius: number;
  gunRecoilVelocity: number;
  projectileSpeed: number;
  projectileLifetimeMs: number;
  playerSpeed: number;
}

interface ActiveSwordSwing {
  until: number;
  facing: -1 | 1;
  downward: boolean;
  remainingEnemyHits: number;
  enemyHitKeys: Set<string>;
  peerHit: boolean;
  connected: boolean;
  lastCheckedAt: number | null;
  attackRect: Phaser.Geom.Rectangle | null;
}

export class OverworldCombatController {
  private activeAttackAnimation: DefaultPlayerAnimationState | null = null;
  private activeAttackAnimationUntil = 0;
  private meleeCooldownUntil = 0;
  private rangedCooldownUntil = 0;
  private playerProjectiles: OverworldPlayerProjectile[] = [];
  private activeSwordSwing: ActiveSwordSwing | null = null;

  constructor(
    private readonly host: OverworldCombatControllerHost,
    private readonly options: OverworldCombatControllerOptions,
  ) {}

  reset(): void {
    this.clearAttackAnimation();
    this.meleeCooldownUntil = 0;
    this.rangedCooldownUntil = 0;
    this.destroyProjectiles();
  }

  clearAttackAnimation(): void {
    this.activeAttackAnimation = null;
    this.activeAttackAnimationUntil = 0;
    this.activeSwordSwing = null;
  }

  getCurrentAttackAnimation(now: number): DefaultPlayerAnimationState | null {
    if (!this.activeAttackAnimation || now >= this.activeAttackAnimationUntil) {
      return null;
    }

    return this.activeAttackAnimation;
  }

  getActiveAttackAnimation(): DefaultPlayerAnimationState | null {
    return this.activeAttackAnimation;
  }

  getMeleeCooldownRemainingMs(now: number): number {
    return Math.max(0, this.meleeCooldownUntil - now);
  }

  getRangedCooldownRemainingMs(now: number): number {
    return Math.max(0, this.rangedCooldownUntil - now);
  }

  getProjectileCount(): number {
    return this.playerProjectiles.length;
  }

  getSwordSwingState(now: number) {
    const swing = this.activeSwordSwing;
    if (!swing || now >= swing.until) return null;
    return {
      remainingMs: swing.until - now,
      remainingEnemyHits: swing.remainingEnemyHits,
      enemyContacts: swing.enemyHitKeys.size,
      peerHit: swing.peerHit,
      connected: swing.connected,
      facing: swing.facing,
      downward: swing.downward,
      rect: swing.attackRect ? {
        x: swing.attackRect.x, y: swing.attackRect.y,
        width: swing.attackRect.width, height: swing.attackRect.height,
      } : null,
    };
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return this.playerProjectiles.map((projectile) => projectile.presentation.rect);
  }

  handleCombatInput(input: {
    swordPressed: boolean;
    gunPressed: boolean;
    downHeld: boolean;
    grounded: boolean;
  }): void {
    const player = this.host.getPlayer();
    const playerBody = this.host.getPlayerBody();
    if (!player || !playerBody) {
      return;
    }

    const now = this.host.getCurrentTime();
    if (input.swordPressed && now >= this.meleeCooldownUntil) {
      this.performSwordAttack(input.downHeld, input.grounded, player, playerBody, now);
      return;
    }

    if (input.gunPressed && now >= this.rangedCooldownUntil) {
      this.fireGunProjectile(player, playerBody, now);
    }
  }

  updateProjectiles(delta: number): void {
    if (this.playerProjectiles.length === 0) {
      return;
    }

    const now = this.host.getCurrentTime();
    for (const projectile of [...this.playerProjectiles]) {
      const projectileRect = projectile.presentation.rect;
      if (!projectileRect.active || now >= projectile.expiresAt) {
        this.destroyProjectile(projectile);
        continue;
      }

      const startX = projectileRect.x;
      const stepDistance = (projectile.speed * delta) / 1000;
      const nextX = startX + projectile.directionX * stepDistance;
      const sampleCount = Math.max(1, Math.ceil(Math.abs(nextX - startX) / 6));
      let destroyed = false;

      for (let index = 1; index <= sampleCount; index += 1) {
        const sampleX = Phaser.Math.Linear(startX, nextX, index / sampleCount);
        const sampleY = projectileRect.y;
        const enemyHit = this.host.attackEnemyAtPoint(sampleX, sampleY, this.options.gunHitRadius);
        if (enemyHit) {
          playSfx('enemy-hit');
          this.host.playBulletImpactFx(enemyHit.x, enemyHit.y - 2);
          this.host.shakeCamera(40, 0.0015);
          this.destroyProjectile(projectile);
          destroyed = true;
          break;
        }

        const peerHit = this.host.attackPeerAtPoint(sampleX, sampleY, 'gun');
        if (peerHit) {
          playSfx('enemy-hit');
          this.host.playPeerHitFx(peerHit.x, peerHit.y);
          this.host.shakeCamera(40, 0.0015);
          this.destroyProjectile(projectile);
          destroyed = true;
          break;
        }

        if (this.host.isProjectileBlocked(sampleX, sampleY)) {
          this.host.playBulletImpactFx(sampleX, sampleY);
          this.destroyProjectile(projectile);
          destroyed = true;
          break;
        }
      }

      if (!destroyed) {
        projectileRect.x = nextX;
      }
    }
  }

  updateSwordSwing(): void {
    const swing = this.activeSwordSwing;
    if (!swing) return;
    const now = this.host.getCurrentTime();
    const playerBody = this.host.getPlayerBody();
    if (now >= swing.until || !playerBody || !this.host.getPlayer()) {
      this.activeSwordSwing = null;
      return;
    }
    if (swing.lastCheckedAt === now) return;
    swing.lastCheckedAt = now;
    const forwardRect = createForwardSwordAttackRect({
      centerX: playerBody.center.x, feetY: playerBody.bottom,
      facing: swing.facing, standingHeight: this.options.playerStandingHeight,
    });
    const attackRect = swing.downward
      ? new Phaser.Geom.Rectangle(playerBody.center.x - 12, playerBody.bottom - 2, 24, 28)
      : new Phaser.Geom.Rectangle(forwardRect.x, forwardRect.y, forwardRect.width, forwardRect.height);
    swing.attackRect = attackRect;
    const hits = swing.remainingEnemyHits > 0
      ? this.host.attackEnemiesInRect(attackRect, swing.remainingEnemyHits, swing.enemyHitKeys)
      : [];
    if (this.activeSwordSwing !== swing) return;
    swing.remainingEnemyHits = Math.max(0, swing.remainingEnemyHits - hits.length);
    const peerHit = swing.peerHit ? null : this.host.attackPeerInRect(attackRect, 'sword');
    if (this.activeSwordSwing !== swing) return;
    if (peerHit) {
      swing.peerHit = true;
      this.host.playPeerHitFx(peerHit.x, peerHit.y);
    }
    if ((hits.length === 0 && !peerHit) || swing.connected) return;
    swing.connected = true;
    playSfx('enemy-hit');
    if (swing.downward) {
      playerBody.setVelocityY(this.options.downwardSlashBounceVelocity);
    } else {
      this.host.applyWeaponKnockback(
        Phaser.Math.Clamp(
          playerBody.velocity.x + swing.facing * this.options.swordHitLungeVelocity,
          -this.options.playerSpeed * 1.35,
          this.options.playerSpeed * 1.35,
        ),
      );
    }
    this.host.shakeCamera(50, 0.002);
  }

  destroyProjectiles(): void {
    for (const projectile of this.playerProjectiles) {
      this.host.destroyPresentedProjectile(projectile.presentation);
    }
    this.playerProjectiles = [];
  }

  private performSwordAttack(
    downHeld: boolean,
    grounded: boolean,
    player: Phaser.GameObjects.Rectangle,
    playerBody: Phaser.Physics.Arcade.Body,
    now: number,
  ): void {
    const playerFacing = this.host.getPlayerFacing();
    const downward = !grounded && downHeld;
    const attackAnimation: DefaultPlayerAnimationState = downward ? 'air-slash-down' : 'sword-slash';
    this.activeAttackAnimation = attackAnimation;
    this.activeAttackAnimationUntil = now + this.options.swordAttackMs;
    this.meleeCooldownUntil = now + this.options.swordCooldownMs;
    this.activeSwordSwing = {
      until: now + this.options.swordActiveMs,
      facing: playerFacing, downward,
      remainingEnemyHits: this.options.swordMaxHitsPerSwing,
      enemyHitKeys: new Set(), peerHit: false, connected: false,
      lastCheckedAt: null, attackRect: null,
    };

    if (downward && playerBody.velocity.y < 120) {
      playerBody.setVelocityY(120);
    }

    const event = this.createCombatPresentationEvent({
      source: 'sword',
      player,
      playerBody,
      facing: playerFacing,
      durationMs: this.options.swordAttackMs,
      effectX: player.x,
      effectY: downward ? playerBody.bottom - 2 : playerBody.bottom - this.options.playerStandingHeight * 0.5,
      downward,
      projectile: null,
    });
    this.host.presentCombatEvent(event);
    this.host.publishCombatAction(event);
    this.updateSwordSwing();
  }

  private fireGunProjectile(
    player: Phaser.GameObjects.Rectangle,
    playerBody: Phaser.Physics.Arcade.Body,
    now: number,
  ): void {
    this.activeSwordSwing = null;
    const playerFacing = this.host.getPlayerFacing();
    this.activeAttackAnimation = 'gun-fire';
    this.activeAttackAnimationUntil = now + this.options.gunAttackMs;
    this.rangedCooldownUntil = now + this.options.gunCooldownMs;

    const muzzleX = player.x + playerFacing * 10;
    const muzzleY = playerBody.center.y - (this.host.isPlayerCrouching() ? 1 : 5);
    const event = this.createCombatPresentationEvent({
      source: 'gun',
      player,
      playerBody,
      facing: playerFacing,
      durationMs: this.options.gunAttackMs,
      effectX: muzzleX,
      effectY: muzzleY,
      downward: false,
      projectile: {
        x: muzzleX,
        y: muzzleY,
        velocityX: playerFacing * this.options.projectileSpeed,
        lifetimeMs: this.options.projectileLifetimeMs,
      },
    });
    const projectile = this.host.presentCombatEvent(event, { autoUpdateProjectile: false });
    this.host.publishCombatAction(event);

    if (projectile) {
      this.playerProjectiles.push({
        presentation: projectile,
        directionX: playerFacing,
        speed: this.options.projectileSpeed,
        expiresAt: now + this.options.projectileLifetimeMs,
      });
    }

    this.host.applyWeaponKnockback(
      Phaser.Math.Clamp(
        playerBody.velocity.x - playerFacing * this.options.gunRecoilVelocity,
        -this.options.playerSpeed * 1.2,
        this.options.playerSpeed * 1.2,
      ),
    );
  }

  private destroyProjectile(projectile: OverworldPlayerProjectile): void {
    this.host.destroyPresentedProjectile(projectile.presentation);
    this.playerProjectiles = this.playerProjectiles.filter((candidate) => candidate !== projectile);
  }

  private createCombatPresentationEvent(input: {
    source: CombatPresentationEvent['source'];
    player: Phaser.GameObjects.Rectangle;
    playerBody: Phaser.Physics.Arcade.Body;
    facing: -1 | 1;
    durationMs: number;
    effectX: number;
    effectY: number;
    downward: boolean;
    projectile: CombatPresentationEvent['projectile'];
  }): CombatPresentationEvent {
    const startedAt = Date.now();
    return {
      id: [
        'combat',
        input.source,
        startedAt,
        Math.random().toString(36).slice(2, 8),
      ].join(':'),
      owner: 'local',
      source: input.source,
      x: input.player.x,
      y: input.playerBody.bottom,
      facing: input.facing,
      startedAt,
      durationMs: input.durationMs,
      effectX: input.effectX,
      effectY: input.effectY,
      downward: input.downward,
      projectile: input.projectile,
    };
  }
}
