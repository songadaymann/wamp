import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  playSfx: vi.fn(),
  showDamageFlash: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: {
    Textures: { FilterMode: { NEAREST: 0 } },
  },
}));
vi.mock('../../audio/sfx', () => ({ playSfx: mocks.playSfx }));
vi.mock('../../ui/setup/pvpModal', () => ({
  showPvpDamageFlashOverlay: mocks.showDamageFlash,
}));

import { OverworldPvpLocalPresentationController } from './pvpLocalPresentationController';
import type { PvpMatchSnapshot } from '../../pvp/model';

function createSnapshot(overrides: Partial<PvpMatchSnapshot> = {}): PvpMatchSnapshot {
  return {
    matchId: 'match-1',
    mode: 'arena',
    roomId: '0,0',
    roomCoordinates: { x: 0, y: 0 },
    status: 'active',
    participants: [
      {
        userId: 'alice',
        displayName: 'Alice',
        avatarId: 'default-player',
        hearts: 4,
        connected: true,
        invulnerableUntil: Date.now() + 1_000,
        losses: 1,
        hits: 2,
      },
      {
        userId: 'bob',
        displayName: 'Bob',
        avatarId: 'default-player',
        hearts: 3,
        connected: true,
        invulnerableUntil: 0,
        losses: 2,
        hits: 1,
      },
    ],
    startedAt: Date.now(),
    countdownEndsAt: null,
    finishedAt: null,
    winnerUserId: null,
    loserUserId: null,
    draw: false,
    lastEvent: null,
    ...overrides,
  };
}

function createFixture() {
  const icons: Array<{
    setOrigin: ReturnType<typeof vi.fn>;
    setPosition: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    texture: { setFilter: ReturnType<typeof vi.fn> };
  }> = [];
  const container = {
    setDepth: vi.fn(),
    setVisible: vi.fn(),
    add: vi.fn(),
    setPosition: vi.fn(),
    destroy: vi.fn(),
  };
  const graphics = {
    setDepth: vi.fn(),
    setVisible: vi.fn(),
    clear: vi.fn(),
    fillStyle: vi.fn(),
    fillRect: vi.fn(),
    lineStyle: vi.fn(),
    strokeRect: vi.fn(),
    destroy: vi.fn(),
  };
  const sprite = {
    y: 120,
    displayHeight: 30,
    setAlpha: vi.fn(),
    clearTint: vi.fn(),
    setTintFill: vi.fn(),
  };
  const scene = {
    add: {
      container: vi.fn(() => container),
      image: vi.fn(() => {
        const icon = {
          setOrigin: vi.fn(),
          setPosition: vi.fn(),
          destroy: vi.fn(),
          texture: { setFilter: vi.fn() },
        };
        icons.push(icon);
        return icon;
      }),
      graphics: vi.fn(() => graphics),
    },
    cameras: {
      main: { flash: vi.fn(), shake: vi.fn() },
    },
    time: { delayedCall: vi.fn((_delay: number, callback: () => void) => callback()) },
  };
  const onDisplayObjectsChanged = vi.fn();
  const controller = new OverworldPvpLocalPresentationController({
    scene: scene as never,
    playerWidth: 18,
    playerStandingHeight: 30,
    getPlayerSprite: () => sprite as never,
    onDisplayObjectsChanged,
  });
  return { controller, scene, sprite, container, graphics, icons, onDisplayObjectsChanged };
}

describe('OverworldPvpLocalPresentationController', () => {
  beforeEach(() => {
    mocks.playSfx.mockClear();
    mocks.showDamageFlash.mockClear();
  });

  it('owns hearts, position, invulnerability, and stable display objects', () => {
    const fixture = createFixture();
    const playerBody = { center: { x: 80 }, top: 92, bottom: 122 };

    fixture.controller.sync({
      snapshot: createSnapshot(),
      localUserId: 'alice',
      playerPresent: true,
      playerBody,
    });
    fixture.controller.sync({
      snapshot: createSnapshot(),
      localUserId: 'alice',
      playerPresent: true,
      playerBody,
    });

    expect(fixture.scene.add.image).toHaveBeenCalledTimes(4);
    expect(fixture.scene.add.graphics).toHaveBeenCalledTimes(1);
    expect(fixture.container.setPosition).toHaveBeenLastCalledWith(80, 78);
    expect(fixture.graphics.setDepth).toHaveBeenCalledWith(32);
    expect(fixture.controller.getBackdropIgnoredObjects()).toHaveLength(2);
  });

  it('tears down presentation when a match completes or the local participant disappears', () => {
    const fixture = createFixture();
    fixture.controller.sync({
      snapshot: createSnapshot(),
      localUserId: 'alice',
      playerPresent: true,
      playerBody: { center: { x: 80 }, top: 92, bottom: 122 },
    });

    fixture.controller.sync({
      snapshot: createSnapshot({ status: 'complete' }),
      localUserId: 'alice',
      playerPresent: true,
      playerBody: { center: { x: 80 }, top: 92, bottom: 122 },
    });

    expect(fixture.container.destroy).toHaveBeenCalledOnce();
    expect(fixture.graphics.destroy).toHaveBeenCalledOnce();
    expect(fixture.sprite.setAlpha).toHaveBeenLastCalledWith(1);
    expect(fixture.controller.getBackdropIgnoredObjects()).toEqual([]);
  });

  it('preserves damage feedback strength, tint duration, and cleanup', () => {
    const fixture = createFixture();

    fixture.controller.playDamageFeedback(5, 3);

    expect(mocks.playSfx).toHaveBeenCalledWith('player-hurt', { ignoreCooldown: true });
    expect(mocks.showDamageFlash).toHaveBeenCalledOnce();
    expect(fixture.scene.cameras.main.flash).toHaveBeenCalledWith(150, 255, 32, 42, false);
    expect(fixture.scene.cameras.main.shake).toHaveBeenCalledWith(110, 0.0075);
    expect(fixture.sprite.setTintFill).toHaveBeenCalledWith(0xff4f5f);
    expect(fixture.scene.time.delayedCall).toHaveBeenCalledWith(90, expect.any(Function));
    expect(fixture.sprite.clearTint).toHaveBeenCalled();
  });
});
