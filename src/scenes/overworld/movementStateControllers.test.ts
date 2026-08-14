import { describe, expect, it } from 'vitest';
import {
  OverworldButtStompMovementStateController,
  OverworldCrateMovementStateController,
  OverworldLadderMovementStateController,
  OverworldWallMovementStateController,
} from './movementStateControllers';

describe('movement state controllers', () => {
  it('owns ladder entry, switching, clearing, and sound idempotence', () => {
    const state = new OverworldLadderMovementStateController();

    expect(state.setActiveLadder('ladder-a')).toEqual({ changed: true, entering: true });
    expect(state.setActiveLadder('ladder-a')).toEqual({ changed: false, entering: false });
    expect(state.setActiveLadder('ladder-b')).toEqual({ changed: true, entering: false });
    expect(state.isClimbing()).toBe(true);
    expect(state.getActiveLadderKey()).toBe('ladder-b');

    expect(state.setClimbSfxPlaying(true)).toBe(true);
    expect(state.setClimbSfxPlaying(true)).toBe(false);
    expect(state.isClimbSfxPlaying()).toBe(true);
    expect(state.setActiveLadder(null)).toEqual({ changed: true, entering: false });
    expect(state.isClimbing()).toBe(false);
    expect(state.getActiveLadderKey()).toBeNull();
  });

  it('owns butt-stomp flip and inclusive impact-grace boundaries', () => {
    const state = new OverworldButtStompMovementStateController();

    state.start(1_000, 190);
    expect(state.isActive()).toBe(true);
    expect(state.isInFlipPause(1_189)).toBe(true);
    expect(state.isInFlipPause(1_190)).toBe(false);

    state.clear(1_200, { keepImpactGrace: true, impactGraceMs: 120 });
    expect(state.isActive()).toBe(false);
    expect(state.isImpactActive(1_320)).toBe(true);
    expect(state.isImpactActive(1_321)).toBe(false);

    state.clear(1_250);
    expect(state.getFlipUntil()).toBe(0);
    expect(state.getImpactGraceUntil()).toBe(0);
  });

  it('owns crate mode and facing as one coherent interaction', () => {
    const state = new OverworldCrateMovementStateController();

    state.sync({ mode: 'push', facing: 1 });
    expect(state.getMode()).toBe('push');
    expect(state.getFacing()).toBe(1);

    state.sync({ mode: 'pull', facing: -1 });
    expect(state.getMode()).toBe('pull');
    expect(state.getFacing()).toBe(-1);

    state.clear();
    expect(state.getMode()).toBeNull();
    expect(state.getFacing()).toBeNull();
  });

  it('owns wall contact grace, sliding, jump direction, lock, and reset', () => {
    const state = new OverworldWallMovementStateController();

    state.update({
      rawContactSide: 1,
      gravityVelocity: 40,
      now: 1_000,
      contactGraceMs: 140,
    });
    expect(state.getContactSide()).toBe(1);
    expect(state.getContactGraceSide()).toBe(1);
    expect(state.getContactGraceUntil()).toBe(1_140);
    expect(state.isSliding()).toBe(true);
    expect(state.getJumpDirectionFromContact()).toBe(-1);

    state.update({
      rawContactSide: 0,
      gravityVelocity: 40,
      now: 1_140,
      contactGraceMs: 140,
    });
    expect(state.getContactSide()).toBe(1);
    expect(state.isSliding()).toBe(false);

    state.commitJump(-1, 1_140, 240);
    expect(state.getContactSide()).toBe(0);
    expect(state.isJumpActive()).toBe(true);
    expect(state.getJumpDirection()).toBe(-1);
    expect(state.isJumpChainActive()).toBe(true);
    expect(state.getJumpLockUntil()).toBe(1_380);

    state.update({
      rawContactSide: 0,
      gravityVelocity: -1,
      now: 1_380,
      contactGraceMs: 140,
    });
    expect(state.isJumpActive()).toBe(true);
    expect(state.getJumpDirection()).toBe(-1);

    state.update({
      rawContactSide: 0,
      gravityVelocity: 0,
      now: 1_381,
      contactGraceMs: 140,
    });
    expect(state.isJumpActive()).toBe(false);
    expect(state.getJumpDirection()).toBe(0);

    state.finishGroundJump();
    expect(state.getJumpLockUntil()).toBe(0);
    expect(state.isJumpChainActive()).toBe(false);
    expect(state.getContactGraceSide()).toBe(0);
  });
});
