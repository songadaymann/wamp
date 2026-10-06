import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KILL_HITSTOP_MS, OverworldGameFeelController, PLAYER_DEATH_BEAT_MS, PLAYER_RESPAWN_FADE_MS } from './gameFeel';

function fixture(pvp = false, initiallyPaused = false) {
  let paused = initiallyPaused;
  const host = {
    canApplyFeedback: () => true, isPvpActive: () => pvp, isPhysicsPaused: () => paused,
    pausePhysics: vi.fn(() => { paused = true; }), resumePhysics: vi.fn(() => { paused = false; }),
    hidePlayer: vi.fn(), restorePlayerVisual: vi.fn(), fadeInPlayer: vi.fn(),
  };
  return { host, controller: new OverworldGameFeelController(host), paused: () => paused };
}

describe('bounded game feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds only physics for 50 real milliseconds and extends a repeated hit', () => {
    const f = fixture(); f.controller.hitstop();
    vi.advanceTimersByTime(30); f.controller.hitstop();
    vi.advanceTimersByTime(49); expect(f.paused()).toBe(true);
    vi.advanceTimersByTime(1); expect(f.paused()).toBe(false);
    expect(f.host.pausePhysics).toHaveBeenCalledTimes(1);
    expect(f.host.resumePhysics).toHaveBeenCalledTimes(1);
  });

  it('skips hitstop and the retry delay in PvP', () => {
    const f = fixture(true), respawn = vi.fn();
    f.controller.hitstop(); f.controller.deathBeat(respawn);
    expect(respawn).toHaveBeenCalledTimes(1);
    expect(f.host.pausePhysics).not.toHaveBeenCalled();
    expect(f.host.hidePlayer).not.toHaveBeenCalled();
    expect(f.controller.shouldPlayRespawnCue()).toBe(false);
  });

  it('replaces hitstop with one death beat and fades the available respawn', () => {
    const f = fixture(), respawn = vi.fn(() => f.controller.playerAvailable());
    f.controller.hitstop(); vi.advanceTimersByTime(20);
    f.controller.deathBeat(respawn); f.controller.deathBeat(respawn);
    vi.advanceTimersByTime(PLAYER_DEATH_BEAT_MS - 1);
    expect(respawn).not.toHaveBeenCalled(); expect(f.controller.isDeathPending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(respawn).toHaveBeenCalledTimes(1); expect(f.paused()).toBe(false);
    expect(f.host.fadeInPlayer).toHaveBeenCalledExactlyOnceWith(PLAYER_RESPAWN_FADE_MS);
    expect(f.controller.shouldPlayRespawnCue()).toBe(false);
    expect(f.controller.shouldPlayRespawnCue()).toBe(true);
  });

  it('retains the fade until an asynchronously loaded player is available', () => {
    const f = fixture(); f.controller.deathBeat(vi.fn());
    vi.advanceTimersByTime(PLAYER_DEATH_BEAT_MS);
    expect(f.host.fadeInPlayer).not.toHaveBeenCalled();
    expect(f.controller.describe().pendingRespawnFade).toBe(true);
    f.controller.playerAvailable(); f.controller.playerAvailable();
    expect(f.host.fadeInPlayer).toHaveBeenCalledTimes(1);
  });

  it('cancels stale death callbacks and fades on Stop, Restart or teardown', () => {
    const f = fixture(), respawn = vi.fn(); f.controller.deathBeat(respawn);
    vi.advanceTimersByTime(50); f.controller.reset(); vi.advanceTimersByTime(1000);
    expect(respawn).not.toHaveBeenCalled(); expect(f.paused()).toBe(false);
    expect(f.host.restorePlayerVisual).toHaveBeenCalledTimes(1);
    f.controller.playerAvailable(); expect(f.host.fadeInPlayer).not.toHaveBeenCalled();
    expect(f.controller.shouldPlayRespawnCue()).toBe(true);
  });

  it('never resumes a physics pause owned elsewhere', () => {
    const f = fixture(false, true); f.controller.hitstop();
    vi.advanceTimersByTime(KILL_HITSTOP_MS);
    expect(f.host.resumePhysics).not.toHaveBeenCalled(); expect(f.paused()).toBe(true);
  });

  it('retains short combat presses during hitstop once and discards them on death or reset', () => {
    const f = fixture(); f.controller.hitstop();
    f.controller.bufferCombatInput({ swordPressed: true, gunPressed: false });
    f.controller.bufferCombatInput({ swordPressed: false, gunPressed: true });
    vi.advanceTimersByTime(KILL_HITSTOP_MS);
    expect(f.controller.consumeCombatInput({ swordPressed: false, gunPressed: false }))
      .toEqual({ swordPressed: true, gunPressed: true });
    expect(f.controller.consumeCombatInput({ swordPressed: false, gunPressed: false }))
      .toEqual({ swordPressed: false, gunPressed: false });
    f.controller.hitstop(); f.controller.bufferCombatInput({ swordPressed: true, gunPressed: true });
    f.controller.deathBeat(vi.fn());
    expect(f.controller.consumeCombatInput({ swordPressed: false, gunPressed: false }))
      .toEqual({ swordPressed: false, gunPressed: false });
    f.controller.reset(); f.controller.hitstop();
    f.controller.bufferCombatInput({ swordPressed: true, gunPressed: true }); f.controller.reset();
    expect(f.controller.consumeCombatInput({ swordPressed: false, gunPressed: false }))
      .toEqual({ swordPressed: false, gunPressed: false });
  });
});
