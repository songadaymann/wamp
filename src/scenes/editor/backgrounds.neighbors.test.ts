import { describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { EditorBackgroundController } from './backgrounds';

vi.mock('phaser', () => ({ default: {} }));
function harness() {
  const graphics = { setDepth: vi.fn(), lineStyle: vi.fn(), strokeRect: vi.fn(), destroy: vi.fn() };
  const image = { setDepth: vi.fn(), setAlpha: vi.fn(), destroy: vi.fn() };
  const scene = { add: { graphics: () => graphics, image: () => image }, textures: { exists: () => true, remove: vi.fn() } };
  const snapshot = createDefaultRoomSnapshot('1,0', { x: 1, y: 0 }); snapshot.status = 'published';
  const repository = { loadWorldWindow: vi.fn().mockResolvedValue({ rooms: [{ id: '1,0', coordinates: { x: 1, y: 0 }, state: 'published' }] }), loadPublishedRoom: vi.fn().mockResolvedValue(snapshot) };
  let active = true;
  const host = { getRoomId: () => '0,0', getRoomCoordinates: () => ({ x: 0, y: 0 }), getIgnoredBackgroundObjects: () => [], isSceneActive: () => active };
  const controller = new EditorBackgroundController(scene as never, repository as never, host);
  return { controller, repository, snapshot, image, graphics, setActive: (next: boolean) => { active = next; } };
}
describe('published neighbor preview ownership', () => {
  it('exposes the already loaded snapshots and revisions without a separate guide request', async () => {
    const { controller, repository, snapshot } = harness();
    const before = controller.publishedNeighborRevision;
    await controller.refreshSurroundingRoomPreviews(1);
    expect(controller.publishedNeighborSnapshots).toEqual([snapshot]); expect(controller.publishedNeighborStatus).toBe('ready');
    expect(controller.publishedNeighborRevision).toBeGreaterThan(before); expect(repository.loadPublishedRoom).toHaveBeenCalledOnce();
  });
  it('keeps a missing known published snapshot unknown rather than calling it empty space', async () => {
    const { controller, repository } = harness(); repository.loadPublishedRoom.mockResolvedValue(null);
    await controller.refreshSurroundingRoomPreviews(1);
    expect(controller.publishedNeighborStatus).toBe('error'); expect(controller.publishedNeighborSnapshots).toEqual([]);
  });
  it('does not install late snapshots after reset or after the scene becomes inactive', async () => {
    for (const kind of ['reset', 'inactive']) {
      const { controller, repository, snapshot, setActive } = harness();
      let resolve!: (value: typeof snapshot) => void;
      repository.loadPublishedRoom.mockReturnValue(new Promise(done => { resolve = done; }));
      const load = controller.refreshSurroundingRoomPreviews(1); await Promise.resolve();
      if (kind === 'reset') controller.reset(); else setActive(false);
      resolve(snapshot); await load;
      expect(controller.publishedNeighborSnapshots).toEqual([]); expect(controller.publishedNeighborStatus).toBe('loading');
    }
  });
  it('releases prior preview snapshots on a load error', async () => {
    const { controller, repository, image } = harness(); await controller.refreshSurroundingRoomPreviews(1);
    repository.loadWorldWindow.mockRejectedValue(new Error('offline'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { await controller.refreshSurroundingRoomPreviews(1); expect(controller.publishedNeighborStatus).toBe('error'); expect(controller.publishedNeighborSnapshots).toEqual([]); expect(image.destroy).toHaveBeenCalled(); }
    finally { error.mockRestore(); }
  });
});
