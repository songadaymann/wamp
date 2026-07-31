import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Textures: {
      FilterMode: { NEAREST: 0 },
    },
  },
}));

import { PvpHeartDisplay } from './pvpHeartDisplay';

describe('PvpHeartDisplay', () => {
  it('does not rebuild unchanged heart icons', () => {
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
      },
    };
    const display = new PvpHeartDisplay(scene as never, 30);

    display.setHearts(3);
    const positionCalls = icons.map((icon) => icon.setPosition.mock.calls.length);
    display.setHearts(3.9);

    expect(scene.add.image).toHaveBeenCalledTimes(3);
    expect(icons.map((icon) => icon.setPosition.mock.calls.length)).toEqual(positionCalls);
  });
});
