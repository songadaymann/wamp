import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GhostRaceIntro } from './ghostRaceIntro';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { notifyGhostBestUpdated } from '../../runs/ghostRepository';
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
const controllers = new Set<GhostRaceIntro>();
function fixture() {
  const select = new Node(), status = new Node(), panel = new Node();
  const nodes: Record<string, Node> = { 'room-ghost-race': panel, 'room-ghost-race-choice': select, 'room-ghost-race-status': status };
  const doc = { getElementById: (id: string) => nodes[id] ?? null } as unknown as Document;
  vi.stubGlobal('window', { location: { search: '' }, localStorage: { getItem: () => null } });
  const room = createDefaultRoomSnapshot('1,2', { x: 1, y: 2 }); room.status = 'published';
  room.goal = { type: 'reach_exit', exit: { x: 100, y: 100 }, timeLimitMs: null };
  const controller = new GhostRaceIntro(doc); controllers.add(controller);
  return { controller, room, select, status, panel };
}
const response = () => ({ roomId: '1,2', roomVersion: 1, top: { ghost, reason: null }, personal: { ghost: null, reason: 'no_run' } });
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
afterEach(() => { for (const controller of controllers) controller.destroy(); controllers.clear(); vi.unstubAllGlobals(); });
beforeEach(() => notifyGhostBestUpdated('1,2'));
describe('optional intro races', () => {
  it('defaults to the room record rather than the viewer personal best', async () => {
    const f = fixture(); vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
    f.controller.open(f.room, false); await flush();
    expect(f.select.value).toBe('top');
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
    expect(f.controller.take()).toEqual({ ghost: null, choice: 'top' });
    f.controller.destroy();
  });
  it('keeps #1 intent when Start precedes the recording response', () => {
    const f = fixture(); vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    f.controller.open(f.room, false);
    expect(f.select.value).toBe('top');
    expect(f.status.textContent).toContain('You can start now');
    expect(f.controller.take()).toEqual({ ghost: null, choice: 'top' });
    f.controller.destroy();
  });
  it.each(['off', 'personal'] as const)('preserves an explicit %s choice through late loading and a saved clear', async choice => {
    const f = fixture(); let resolve!: (value: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetch);
    f.controller.open(f.room, true);
    f.select.value = choice; f.select.dispatchEvent(new Event('change'));
    resolve(Response.json({ ...response(), personal: { ghost: { ...ghost, attemptId: 'personal' }, reason: null } })); await flush();
    notifyGhostBestUpdated(f.room.id);
    resolve(Response.json({ ...response(), top: { ghost: { ...ghost, attemptId: 'new-top' }, reason: null },
      personal: { ghost: { ...ghost, attemptId: 'personal' }, reason: null } })); await flush();
    expect(f.select.value).toBe(choice);
    const result = f.controller.take();
    expect(result.choice).toBe(choice); expect(result.ghost?.attemptId ?? null).toBe(choice === 'off' ? null : 'personal');
    f.controller.destroy();
  });
  it('updates an open room when its previously pending clear finishes, without reopening Play', async () => {
    const f = fixture(); const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ...response(), top: { ghost: null, reason: 'no_run' } }))
      .mockResolvedValueOnce(Response.json(response())); vi.stubGlobal('fetch', fetch);
    f.controller.open(f.room, true); await flush();
    expect(f.select.value).toBe('off');
    notifyGhostBestUpdated(f.room.id); await flush();
    expect(f.select.value).toBe('top'); expect(f.status.textContent).toBe('#1 Leader · 1.00s');
    f.controller.destroy(); notifyGhostBestUpdated(f.room.id);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('shows a recently loaded public record immediately but always rereads personal data', async () => {
    const f = fixture(); const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ...response(), personal: { ghost, reason: null } }))
      .mockImplementationOnce(() => new Promise(() => {})); vi.stubGlobal('fetch', fetch);
    f.controller.open(f.room, true); await flush(); f.controller.close();
    f.controller.open(f.room, true);
    expect(f.select.value).toBe('top'); expect(f.status.textContent).toBe('#1 Leader · 1.00s');
    expect((f.select.options.personal as unknown as Node).disabled).toBe(true);
    f.controller.destroy();
  });
});
