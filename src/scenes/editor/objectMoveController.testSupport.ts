import { vi } from 'vitest';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { EditorObjectMoveController } from './objectMoveController';

/** A real Move tool on an empty room cell at the world origin, seen through `camera`. */
export function objectMoveFixture(camera: { getWorldPoint(x: number, y: number): { x: number; y: number } }) {
  const graphics = { clear: vi.fn(() => graphics), lineStyle: vi.fn(() => graphics), strokeRect: vi.fn(() => graphics), fillStyle: vi.fn(() => graphics), fillRect: vi.fn(() => graphics), setDepth: vi.fn(() => graphics), destroy: vi.fn() };
  const runtime = {
    getRoomOrigin: () => ({ x: 0, y: 0 }),
    findPlacedObjectAt: () => null,
    documentRevision: 1,
    moveArea: vi.fn(() => { runtime.documentRevision += 1; return true; }),
  };
  const emitter = () => ({ on: vi.fn(), off: vi.fn(), once: vi.fn() });
  const ownerDocument = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: null };
  const scene = {
    events: emitter(), scale: emitter(), cameras: { main: camera }, add: { graphics: () => graphics },
    game: { events: emitter(), canvas: { ownerDocument, getBoundingClientRect: () => ({ width: 4000, height: 4000 }) } },
  };
  const host = {
    isEnabled: () => true,
    getRuntimeAt: (x: number, y: number) => (x >= 0 && x < ROOM_PX_WIDTH && y >= 0 && y < ROOM_PX_HEIGHT ? runtime : null),
    prepare: vi.fn(), showStatus: vi.fn(), onChanged: vi.fn(),
  };
  const controller = new EditorObjectMoveController(scene as never, host as never);
  controller.activate();
  return { controller, host, runtime };
}
