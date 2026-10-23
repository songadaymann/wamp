import {
  SWORDSMAN_EDGE_WARMUP_PORTAL_BUDGET_MS,
  SWORDSMAN_EDGE_WARMUP_SPAWN_BUDGET_MS,
} from '../liveObjects/swordsmanEdgeWarmupLoader';
import type { OverworldCompositionPorts } from './ports';

type RoomArrivalHost = Pick<OverworldCompositionPorts, 'liveObjectController' | 'worldStreamingController'>;

/**
 * Finishes the arrival room's Sword Hunter jump warm-up as the player spawns, respawns or takes a
 * portal into it (F302). A prepared room's commit job can spawn the player, so the finish runs
 * outside frame work, whose time it would otherwise be charged to, yet always before the room's
 * hunters first plan in the next frame's live-object update.
 */
export function finishRoomWarmupForArrival(
  host: RoomArrivalHost,
  roomId: string,
  arrival: 'spawn' | 'portal',
): void {
  const budgetMs = arrival === 'portal'
    ? SWORDSMAN_EDGE_WARMUP_PORTAL_BUDGET_MS
    : SWORDSMAN_EDGE_WARMUP_SPAWN_BUDGET_MS;
  host.worldStreamingController.runOutsideFrameWork(
    () => host.liveObjectController.swordsmanEdgeWarmup.finishRoom(roomId, budgetMs),
  );
}
