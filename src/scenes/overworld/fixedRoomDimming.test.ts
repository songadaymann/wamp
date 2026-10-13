import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedRoomDimming } from './fixedRoomDimming';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';

const layout = vi.hoisted(() => ({ deviceClass: 'phone', orientationState: 'portrait' }));
vi.mock('../../ui/deviceLayout', () => ({ getDeviceLayoutState: () => layout }));

function harness() {
  const room = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
  let fixed = true;
  const camera = { width: 390, height: 370, zoom: 390 / ROOM_PX_WIDTH,
    originX: 0.5, originY: 0.5, scrollX: ROOM_PX_WIDTH / 2 - 195, scrollY: ROOM_PX_HEIGHT / 2 - 185 };
  const graphics = { setDepth: vi.fn().mockReturnThis(), setVisible: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(), fillStyle: vi.fn().mockReturnThis(), fillRect: vi.fn(), destroy: vi.fn() };
  const on = vi.fn(); const once = vi.fn(); const off = vi.fn();
  const scene = { game: { events: { on, off } }, events: { once }, cameras: { main: camera },
    add: { graphics: vi.fn(() => graphics) } };
  const dimming = new FixedRoomDimming(scene as never, () => room, () => fixed, () => ({ x: 0, y: 0 }));
  dimming.attach();
  const update = () => on.mock.calls[0][1].call(on.mock.calls[0][2]);
  const shutdown = () => once.mock.calls[0][1].call(once.mock.calls[0][2]);
  return { dimming, camera, graphics, scene, update, shutdown, setFixed: (value: boolean) => { fixed = value; } };
}

describe('portrait fixed-room dimming', () => {
  beforeEach(() => { layout.deviceClass = 'phone'; layout.orientationState = 'portrait'; });

  it('shades the bands above and below the whole room without covering its interior', () => {
    const h = harness(); h.update();
    expect(h.graphics.fillStyle).toHaveBeenCalledWith(0x18161c, 0.7);
    expect(h.graphics.fillRect).toHaveBeenCalledTimes(2);
    for (const [x, y, width, height] of h.graphics.fillRect.mock.calls) {
      expect(x).toBeCloseTo(0); expect(width).toBeCloseTo(ROOM_PX_WIDTH);
      expect(y + height <= 0 || y >= ROOM_PX_HEIGHT).toBe(true);
    }
    h.update(); expect(h.graphics.clear).toHaveBeenCalledOnce();
  });

  it('tracks a zoom transition and clears dimming on landscape, follow rooms and Browse', () => {
    const h = harness(); h.update(); h.camera.zoom = 0.8; h.update();
    expect(h.graphics.clear).toHaveBeenCalledTimes(2);
    layout.orientationState = 'landscape'; h.update();
    expect(h.graphics.setVisible).toHaveBeenLastCalledWith(false);
    layout.orientationState = 'portrait'; h.update();
    expect(h.graphics.setVisible).toHaveBeenLastCalledWith(true);
    h.setFixed(false); h.update();
    expect(h.graphics.setVisible).toHaveBeenLastCalledWith(false);
  });

  it('registers one listener and removes its graphics and listener when the scene shuts down', () => {
    const h = harness(); h.dimming.attach(); h.update(); h.shutdown();
    expect(h.scene.game.events.on).toHaveBeenCalledOnce();
    expect(h.scene.game.events.off).toHaveBeenCalledWith('prerender', expect.any(Function), h.dimming);
    expect(h.graphics.destroy).toHaveBeenCalledOnce();
  });
});
