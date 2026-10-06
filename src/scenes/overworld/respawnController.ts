import type { CourseRoomRef } from '../../courses/model';
import type { RespawnCheckpoint, RespawnCheckpointReference } from '../../goals/respawnCheckpoints';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import type { OverworldPlayerEntities } from './playerLifecycle';

interface OverworldRespawnHost {
  getCheckpoint(): RespawnCheckpoint | null;
  getCourseStartRoom(): CourseRoomRef | null;
  getCurrentRoomCoordinates(): RoomCoordinates;
  getRoomSnapshot(coordinates: RoomCoordinates): RoomSnapshot | null;
  getPlayerEntities(): OverworldPlayerEntities | null;
  clearTransientPlayerState(): void;
  focusRoom(coordinates: RoomCoordinates): void;
  respawnPlayerToRoom(room: RoomSnapshot, entities: OverworldPlayerEntities): void;
  presentRespawn(): void;
  recordRespawn(reference: RespawnCheckpointReference): void;
  refreshAroundFromCache(coordinates: RoomCoordinates): void;
  destroyPlayer(): void;
  requestPlayerCreation(): void;
  refreshAround(coordinates: RoomCoordinates): Promise<boolean>;
  playRespawnSound(): void;
}

/** Shares current-room, course-start and touched-checkpoint respawn plumbing. */
export class OverworldRespawnController {
  private pendingReference: RespawnCheckpointReference | null = null;

  constructor(private readonly host: OverworldRespawnHost) {}

  respawnPlayer(): void {
    const checkpoint = this.host.getCheckpoint();
    const courseStart = this.host.getCourseStartRoom();
    const current = this.host.getCurrentRoomCoordinates();
    const coordinates = checkpoint?.roomCoordinates ?? courseStart?.coordinates ?? current;
    const needsFocus = courseStart !== null || coordinates.x !== current.x || coordinates.y !== current.y;
    const room = this.host.getRoomSnapshot(coordinates);
    const entities = this.host.getPlayerEntities();
    if (!needsFocus && (!room || !entities)) return;

    this.host.clearTransientPlayerState();
    if (needsFocus) this.host.focusRoom(coordinates);
    const reference: RespawnCheckpointReference = checkpoint
      ? { kind: checkpoint.kind, instanceId: checkpoint.instanceId, checkpointIndex: checkpoint.checkpointIndex }
      : { kind: 'start', instanceId: null, checkpointIndex: null };
    if (room && entities) {
      this.pendingReference = null;
      this.host.respawnPlayerToRoom(room, entities);
      this.host.presentRespawn();
      this.host.recordRespawn(reference);
      if (needsFocus) this.host.refreshAroundFromCache(coordinates);
    } else {
      this.pendingReference = reference;
      this.host.destroyPlayer(); this.host.requestPlayerCreation();
      void this.host.refreshAround(coordinates);
    }
    this.host.playRespawnSound();
  }

  handlePlayerCreated(): void {
    if (!this.pendingReference) return;
    const reference = this.pendingReference;
    this.pendingReference = null;
    this.host.recordRespawn(reference);
  }

  reset(): void {
    this.pendingReference = null;
  }
}
