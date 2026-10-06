import { afterEach, describe, expect, it, vi } from 'vitest';
import { GhostRaceIntro } from './ghostRaceIntro';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
const ghost = { schemaVersion: 1, attemptId: 'best', roomId: '1,2', roomVersion: 1, displayName: 'Leader',
  avatarId: 'default-player', elapsedMs: 1000, points: [
    { atMs: 0, roomX: 1, roomY: 2, x: 0, y: 10, vx: 10, vy: 0, grounded: true, snap: false },
    { atMs: 1000, roomX: 1, roomY: 2, x: 10, y: 10, vx: 10, vy: 0, grounded: true, snap: false },
  ] };
class Node extends EventTarget {
  textContent = ''; value = 'off'; disabled = false;
  classList = { add: vi.fn(), toggle: vi.fn() };
  options = { top: new EventTarget(), personal: new EventTarget() };
  querySelector(selector: string) { return selector.includes('top') ? this.options.top : this.options.personal; }
}
function fixture() {
  const select = new Node(), status = new Node(), panel = new Node();
  const nodes: Record<string, Node> = { 'room-ghost-race': panel, 'room-ghost-race-choice': select, 'room-ghost-race-status': status };
  const doc = { getElementById: (id: string) => nodes[id] ?? null } as unknown as Document;
  vi.stubGlobal('window', { location: { search: '' }, localStorage: { getItem: () => null } });
  const room = createDefaultRoomSnapshot('1,2', { x: 1, y: 2 }); room.status = 'published';
  room.goal = { type: 'reach_exit', exit: { x: 100, y: 100 }, timeLimitMs: null };
  return { controller: new GhostRaceIntro(doc), room, select, status, panel };
}
const response = () => ({ roomId: '1,2', roomVersion: 1, top: { ghost, reason: null }, personal: { ghost: null, reason: 'no_run' } });
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
afterEach(() => vi.unstubAllGlobals());
describe('optional intro races', () => {
  it('loads the top choice, keeps Off by default, then hands the selected ghost to Start', async () => {
    const f = fixture(); vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
    f.controller.open(f.room, false); await flush();
    expect(f.status.textContent).toContain('Choose a ghost');
    expect(f.select.value).toBe('off');
    f.select.value = 'top'; f.select.dispatchEvent(new Event('change'));
    expect(f.status.textContent).toBe('#1 Leader · 1.00s');
    expect(f.controller.take()).toEqual({ ghost, choice: 'top' });
    f.controller.destroy();
  });
  it('cancels stale loads when the room closes and does not revive an old choice', async () => {
    const f = fixture(); let resolve!: (value: Response) => void;
    const fetch = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(r => { resolve = r; })); vi.stubGlobal('fetch', fetch);
    f.controller.open(f.room, true); f.controller.close();
    resolve(Response.json(response())); await flush();
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(f.controller.take()).toEqual({ ghost: null, choice: 'off' });
    f.controller.destroy();
  });
  it('offers normal Start after failures and rejects mismatched room versions', async () => {
    const f = fixture(); vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...response(), roomVersion: 3 })));
    f.controller.open(f.room, true); await flush();
    expect(f.status.textContent).toContain('could not load');
    expect(f.controller.take().ghost).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw Error('offline'); }));
    f.controller.open(f.room, false); await flush();
    expect(f.controller.take().choice).toBe('off');
    f.controller.destroy();
  });
});
