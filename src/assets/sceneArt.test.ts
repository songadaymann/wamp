import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { getObjectById } from '../config';
import { createSceneObjectSprite, ensureBackgroundGroupLoaded, ensureSceneObjectTexturesLoaded, getSceneObjectTexture } from './sceneArt';
import { RoomPreviewArtLoader } from './roomArt';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';

function harness() {
  const loaded = new Set<string>();
  const events = new EventEmitter();
  const load = Object.assign(new EventEmitter(), { image: vi.fn(), atlas: vi.fn(), spritesheet: vi.fn(), start: vi.fn(), state: 0, update: vi.fn(), isLoading: () => true });
  const textures = { exists: (key: string) => loaded.has(key) };
  const sprite = { scene: {} as object | undefined, setAlpha: vi.fn(), setTexture: vi.fn() };
  let active = true;
  const gameEvents = new EventEmitter();
  const scene = { game: { events: gameEvents }, scene: { isActive: () => active }, textures, events, load, add: { sprite: vi.fn(() => sprite) } };
  return { scene: scene as never, sprite, loaded, events, load, gameEvents, sleep: () => { active = false; } };
}

vi.mock('./sceneAssetVersions', () => ({ installSceneAssetVersions: vi.fn() }));

const tree = getObjectById('tree_pack_oak_01')!;

describe('on-demand room art', () => {
  it('coalesces an entire tree family and background across concurrent callers', async () => {
    const h = harness();
    const calls = [ensureSceneObjectTexturesLoaded(h.scene, [tree.id, 'tree_pack_oak_02']), ensureSceneObjectTexturesLoaded(h.scene, [tree.id]), ensureBackgroundGroupLoaded(h.scene, 'desert'), ensureBackgroundGroupLoaded(h.scene, 'desert')];
    expect(h.load.atlas).toHaveBeenCalledOnce(); expect(h.load.image).toHaveBeenCalledTimes(3);
    h.loaded.add(getSceneObjectTexture(tree).key);
    for (const key of ['desert_far', 'desert_mid', 'desert_near']) h.loaded.add(key);
    h.load.emit('complete'); await Promise.all(calls);
    expect(h.load.listenerCount('complete')).toBe(0); expect(h.events.listenerCount('shutdown')).toBe(0);
  });

  it('keeps a shared request progressing after its source scene sleeps', async () => {
    const h = harness(); const request = ensureSceneObjectTexturesLoaded(h.scene, [tree.id]);
    h.gameEvents.emit('step'); expect(h.load.update).not.toHaveBeenCalled();
    h.sleep(); h.gameEvents.emit('step'); expect(h.load.update).toHaveBeenCalledOnce();
    const secondScene = { ...h.scene as object, textures: (h.scene as unknown as { textures: object }).textures };
    const shared = ensureSceneObjectTexturesLoaded(secondScene as never, [tree.id]);
    expect(h.load.atlas).toHaveBeenCalledOnce();
    h.loaded.add(getSceneObjectTexture(tree).key); h.load.emit('complete'); await Promise.all([request, shared]);
    expect(h.gameEvents.listenerCount('step')).toBe(0);
  });

  it('rejects a failed load, removes listeners, and allows a real retry', async () => {
    const h = harness(); const key = getSceneObjectTexture(tree).key;
    const first = ensureSceneObjectTexturesLoaded(h.scene, [tree.id]);
    h.load.emit('loaderror', { key }); await expect(first).rejects.toThrow('Failed to load');
    expect(h.load.listenerCount('complete')).toBe(0);
    const retry = ensureSceneObjectTexturesLoaded(h.scene, [tree.id]);
    expect(h.load.atlas).toHaveBeenCalledTimes(2);
    h.loaded.add(key); h.load.emit('complete'); await retry;
  });

  it('does not install late art into a destroyed sprite, and cancels a stopped loader', async () => {
    const h = harness(); const key = getSceneObjectTexture(tree).key;
    createSceneObjectSprite(h.scene, 42, 73, tree);
    expect(h.sprite.setAlpha).toHaveBeenCalledWith(0);
    h.sprite.scene = undefined; h.loaded.add(key); h.load.emit('complete');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.sprite.setTexture).not.toHaveBeenCalled();
    h.loaded.clear(); const request = ensureSceneObjectTexturesLoaded(h.scene, [tree.id]);
    h.events.emit('shutdown'); await expect(request).rejects.toThrow('cancelled');
    expect(h.load.listenerCount('loaderror')).toBe(0);
  });

  it('rejects requests made after shutdown without attaching a dead queue', async () => {
    const h = harness(); h.load.state = 4;
    await expect(ensureSceneObjectTexturesLoaded(h.scene, [tree.id])).rejects.toThrow('stopped');
    expect(h.load.atlas).not.toHaveBeenCalled(); expect(h.gameEvents.listenerCount('step')).toBe(0);
  });

  it('redraws a waiting preview once, and never redraws a reset preview', async () => {
    for (const reset of [false, true]) {
      const h = harness(); const redraw = vi.fn();
      const loader = new RoomPreviewArtLoader(h.scene, redraw);
      const room = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }); room.background = 'none';
      room.placedObjects = [{ id: tree.id, instanceId: 'oak', x: 100, y: 100 }];
      loader.ensure(room, true); loader.ensure(room, true); expect(h.load.atlas).toHaveBeenCalledOnce();
      if (reset) loader.reset();
      h.loaded.add(getSceneObjectTexture(tree).key); h.load.emit('complete');
      await vi.waitFor(() => expect(redraw).toHaveBeenCalledTimes(reset ? 0 : 1));
    }
  });
});
