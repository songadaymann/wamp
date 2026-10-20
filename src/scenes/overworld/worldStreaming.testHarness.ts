import {
  OverworldFullRoomPresenter,
  type FullRoomPresenterOptions,
} from './fullRoomPresenter';
import { OverworldWorldStreamingController } from './worldStreaming';

/**
 * Partial scheduler fixtures skip the controller constructor. Install its required
 * presenter explicitly, with live fixture ports and independently replaceable
 * presenter methods. No production dependency is optional for these tests.
 */
export function createWorldStreamingHarness(): ReturnType<
  typeof Object.create
> {
  const harness = Object.create(OverworldWorldStreamingController.prototype);
  const options: FullRoomPresenterOptions<unknown, unknown> = {
    get scene() {
      return harness.options.scene;
    },
    getRoomOrigin: (...args) => harness.options.getRoomOrigin(...args),
    getPlayer: () => harness.options.getPlayer?.() ?? null,
    shouldCollidePlayerWithTerrainTile: (tile) =>
      harness.options.shouldCollidePlayerWithTerrainTile?.(tile) ?? true,
    createLiveObjects: (room) => harness.options.createLiveObjects(room),
    destroyLiveObjects: (...args) =>
      harness.options.destroyLiveObjects(...args),
    destroyEdgeWalls: (room) => harness.options.destroyEdgeWalls(room),
    setLiveObjectsDormant: (...args) =>
      harness.options.setLiveObjectsDormant?.(...args),
    setLiveObjectWorldCollisionTargetDormant: (...args) =>
      harness.options.setLiveObjectWorldCollisionTargetDormant?.(...args),
    buildScopedRoomTextureKey: (...args) =>
      harness.buildScopedRoomTextureKey(...args),
    buildFullRoomArtifactKey: (...args) =>
      harness.buildFullRoomArtifactKey(...args),
    getCustomRoomTileTextureKey: (room) =>
      harness.getCustomRoomTileTextureKey(room),
    isDestroyed: () => harness.destroyed,
    measure: (label, callback) => harness.measure(label, callback),
  };
  const presenter = new OverworldFullRoomPresenter(options);
  Object.defineProperty(harness, 'fullRoomPresenter', {
    get: () => presenter,
    set: (overrides: Partial<OverworldFullRoomPresenter>) =>
      Object.assign(presenter, overrides),
    configurable: true,
  });
  return harness;
}
