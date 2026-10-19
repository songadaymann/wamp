import type Phaser from 'phaser';
import { isAssistRequested } from '../../settings/assistSettings';
import { hasCoopPressurePlates } from '../../placedObjects/coopPressurePlates';
import type { RoomSnapshot } from '../../persistence/roomModel';
import type { GoalRunState } from './goalRuns';
import type { ActiveExpandedRoomRunState } from './expandedRoomRuns';
import type { LoadedFullRoom } from './worldStreaming';
import type { LoadedRoomObject } from './liveObjects/model';
import { OverworldAssistRuntime } from './assistRuntime';
import { OverworldAssistSafeRespawn } from './assistSafeRespawn';
import { gameplayNow, installGameplayClock } from './gameplayClock';
interface AssistSetupHost {
  isPlaying(): boolean;
  hasLiveMode(): boolean;
  getRoomRun(): GoalRunState | null;
  getExpandedRun(): ActiveExpandedRoomRunState | null;
  getRoom(): LoadedFullRoom<LoadedRoomObject> | null;
  findRoom(id: string): LoadedFullRoom<LoadedRoomObject> | null;
  allRooms(): Iterable<LoadedFullRoom<LoadedRoomObject>>;
  getBody(): Phaser.Physics.Arcade.Body | null;
  getOrigin(room: RoomSnapshot): { x: number; y: number };
  clearTrace(): void;
  renderHud(): void;
  standingHeight: number;
}
/** Keeps per-scene assistance wiring outside the scene's orchestration code. */
export function createOverworldAssist(scene: Phaser.Scene, host: AssistSetupHost) {
  const noObjects: readonly never[] = [];
  const runtime = new OverworldAssistRuntime(scene, {
    available: () => host.isPlaying() && !host.hasLiveMode() && !host.getRoomRun()?.cooperative
      && !host.getExpandedRun()?.cooperative && !hasCoopPressurePlates(host.getRoom()?.room.placedObjects ?? noObjects),
    getRoomRun: host.getRoomRun, getExpandedRun: host.getExpandedRun, clearTrace: host.clearTrace, renderHud: host.renderHud,
  });
  const destroyClock = installGameplayClock(scene, () => runtime.speed);
  const safe = new OverworldAssistSafeRespawn({
    ...host, active: () => runtime.isActive(), now: () => gameplayNow(scene),
    owner: () => host.getExpandedRun() ?? host.getRoomRun() ?? host.getBody(),
  });
  return { runtime, safe, requestedForRun: () => isAssistRequested() && !host.hasLiveMode(), destroy: () => { safe.reset(); runtime.destroy(); destroyClock(); } };
}
