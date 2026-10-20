import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../audio/sfx', () => ({ playSfx: vi.fn() }));
vi.mock('../feedback/haptics', () => ({ playHaptic: vi.fn() }));
import { SceneFxController } from './controller';
import { playHaptic } from '../feedback/haptics';
import { playSfx } from '../audio/sfx';

beforeEach(() => vi.clearAllMocks());
function fixture() {
  const fx = new SceneFxController({ scene: {} as never });
  Object.assign(fx, {
    playAnimatedFx: vi.fn(), spawnScorePopup: vi.fn(), spawnFlash: vi.fn(), spawnRing: vi.fn(),
  });
  return fx;
}

it('local pickups and clear feedback remain tactile when their sound cue is suppressed', () => {
  const fx = fixture();
  fx.playCollectFx(0, 0, 1, 'collect', null);
  fx.playGoalFx('success', 0, 0, null);
  expect(playHaptic).toHaveBeenNthCalledWith(1, 'collect');
  expect(playHaptic).toHaveBeenNthCalledWith(2, 'goal');
  expect(playSfx).not.toHaveBeenCalled();
});

it('shared enemy, projectile and ambient presentation never masquerades as a local hit', () => {
  const fx = fixture();
  fx.playEnemyKillFx(0, 0); fx.playBombExplosionFx(0, 0); fx.playBounceFx(0, 0);
  fx.playBulletImpactFx(0, 0); fx.playLandingDustFx(0, 0, 1);
  fx.playSwordSlashFx(0, 0, 1); fx.playMuzzleFlashFx(0, 0, 1);
  fx.playGoalFx('start', 0, 0); fx.playGoalFx('checkpoint', 0, 0); fx.playGoalFx('abandon', 0, 0);
  expect(playHaptic).not.toHaveBeenCalled();
  fx.playJumpDustFx(0, 0, 1); fx.playPlayerDeathFx(0, 0); fx.playGoalFx('fail', 0, 0);
  expect(vi.mocked(playHaptic).mock.calls).toEqual([['jump'], ['damage'], ['damage']]);
});
