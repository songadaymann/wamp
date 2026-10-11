import { describe, expect, it, vi } from 'vitest';
import { RoomWeatherController } from './controller';

type FakeImage = {
  visible: boolean; x: number; y: number; displayWidth: number; displayHeight: number; alpha: number; tint: number;
  [method: string]: unknown;
};

function fakeScene() {
  const images: FakeImage[] = [];
  function makeImage(): FakeImage {
    const image: FakeImage = {
      visible: true, x: 0, y: 0, displayWidth: 0, displayHeight: 0, alpha: 1, tint: 0xffffff,
      setTint: vi.fn((tint: number) => { image.tint = tint; return image; }),
      setVisible: vi.fn((visible: boolean) => { image.visible = visible; return image; }),
      setPosition: vi.fn((x: number, y: number) => { image.x = x; image.y = y; return image; }),
      setDisplaySize: vi.fn((w: number, h: number) => { image.displayWidth = w; image.displayHeight = h; return image; }),
      setAlpha: vi.fn((alpha: number) => { image.alpha = alpha; return image; }),
    };
    images.push(image);
    return image;
  }
  const order: string[] = [];
  const container = { kind: 'container', children: [] as unknown[], add: vi.fn((child: unknown) => { container.children.push(child); }), setDepth: vi.fn(), destroy: vi.fn() };
  const graphics = {
    kind: 'graphics', setVisible: vi.fn(), setDepth: vi.fn(), destroy: vi.fn(), clear: vi.fn(), fillStyle: vi.fn(), fillEllipse: vi.fn(), fillRect: vi.fn(),
    lineStyle: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), strokePath: vi.fn(),
  };
  const canvas = { getContext: () => ({ beginPath: vi.fn(), ellipse: vi.fn(), fill: vi.fn(), fillStyle: '' }), refresh: vi.fn(), setFilter: vi.fn() };
  let textureMade = false;
  const scene = {
    time: { now: 1234 },
    add: { container: vi.fn(() => { order.push('container'); return container; }), graphics: vi.fn(() => { order.push('graphics'); return graphics; }) },
    make: { image: vi.fn(() => makeImage()) },
    textures: { exists: vi.fn(() => textureMade), createCanvas: vi.fn(() => { textureMade = true; return canvas; }) },
  };
  return { scene, images, container, graphics, canvas, order };
}

const bounds = { x: 640, y: -360, width: 480, height: 270 };

describe('fog drawn as pooled images (F004)', () => {
  it('draws no fog ellipses, reuses its images every frame, and hides the spare ones', () => {
    const h = fakeScene();
    const controller = new RoomWeatherController({ scene: h.scene as never, depth: 34 });
    controller.sync({ roomId: '3,-2', bounds, weather: { mode: 'fog', intensity: 50 } });
    expect(h.order).toEqual(['container', 'graphics']); // fog stays under rain and snow at the same depth
    expect(h.graphics.fillEllipse).not.toHaveBeenCalled();
    expect(h.images).toHaveLength(275);
    expect(h.images.every((image) => image.visible && image.tint === 0x82a7b7)).toBe(true);
    expect([h.images[0].x, h.images[0].y, h.images[0].displayWidth, h.images[0].displayHeight]).toEqual([829, -157, 378, 45]);
    expect(h.canvas.setFilter).toHaveBeenCalledWith(0);

    h.scene.time.now = 1250;
    controller.sync({ roomId: '3,-2', bounds, weather: { mode: 'fog', intensity: 50 } });
    expect(h.scene.make.image).toHaveBeenCalledTimes(275);
    expect(h.scene.textures.createCanvas).toHaveBeenCalledOnce();

    controller.sync({ roomId: '3,-2', bounds, weather: { mode: 'snow', intensity: 50 } });
    expect(h.images.every((image) => !image.visible)).toBe(true);
    expect(controller.getBackdropIgnoredObjects()).toEqual([h.container, h.graphics]);
  });

  it('destroys the fog layer with the weather and starts a fresh pool next time', () => {
    const h = fakeScene();
    const controller = new RoomWeatherController({ scene: h.scene as never, depth: 34 });
    controller.sync({ roomId: '6,-3', bounds, weather: { mode: 'rain', intensity: 60 } });
    expect(h.images.length).toBeGreaterThan(0);
    expect(controller.sync({ roomId: null, bounds: null, weather: null })).toBe(true);
    expect(h.container.destroy).toHaveBeenCalledOnce();
    expect(controller.getBackdropIgnoredObjects()).toEqual([]);
  });
});

describe('weather off path (F012)', () => {
  it('skips the work once nothing is drawn for the room, and still starts weather when it changes', () => {
    const h = fakeScene();
    const controller = new RoomWeatherController({ scene: h.scene as never, depth: 34 });
    const off = { mode: 'off', intensity: 50 } as const;
    expect(controller.sync({ roomId: '3,-2', bounds, weather: off })).toBe(false);
    const debug = controller.getDebugState();
    for (let frame = 0; frame < 3; frame += 1) controller.sync({ roomId: '3,-2', bounds, weather: off });
    expect(controller.getDebugState()).toEqual(debug);
    expect(h.scene.add.graphics).not.toHaveBeenCalled();
    // Another room, or weather turning on, takes the full path.
    controller.sync({ roomId: '4,-2', bounds, weather: off });
    expect(controller.getDebugState().activeRoomId).toBe('4,-2');
    expect(controller.sync({ roomId: '4,-2', bounds, weather: { mode: 'fog', intensity: 50 } })).toBe(true);
    expect(controller.getDebugState().rendererPath).toBe('graphics');
  });
});
