import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config/room';
import type { RespawnCheckpoint } from '../../goals/respawnCheckpoints';

export interface RespawnCheckpointScope {
  /** Run object identity, or the current room ID during free exploration. */
  owner: object | string;
  /** Some owners qualify a practice run in place instead of replacing it. */
  phase?: string;
  roomIds: readonly string[];
}

interface RespawnCheckpointHost {
  getScope(): RespawnCheckpointScope | null;
  onActivated(checkpoint: RespawnCheckpoint): void;
  onChanged(): void;
}

/** Keeps touched checkpoints local to one play session and its level. */
export class OverworldRespawnCheckpointController {
  private owner: RespawnCheckpointScope['owner'] | null = null;
  private phase: string | undefined;
  private readonly touched = new Set<string>();
  private checkpoint: RespawnCheckpoint | null = null;

  constructor(private readonly host: RespawnCheckpointHost) {}

  activate(checkpoint: RespawnCheckpoint): boolean {
    const scope = this.syncScope();
    if (!scope?.roomIds.includes(checkpoint.roomId) || !isValidCheckpoint(checkpoint)) return false;
    const key = checkpointKey(checkpoint);
    if (this.touched.has(key)) return false;
    this.touched.add(key);
    this.checkpoint = cloneCheckpoint(checkpoint);
    this.host.onActivated(cloneCheckpoint(checkpoint));
    this.host.onChanged();
    return true;
  }

  getCheckpoint(): RespawnCheckpoint | null {
    this.syncScope();
    return this.checkpoint ? cloneCheckpoint(this.checkpoint) : null;
  }

  isObjectReached(roomId: string, instanceId: string): boolean {
    this.syncScope();
    return this.touched.has(JSON.stringify(['object', roomId, instanceId]));
  }

  clear(): void {
    const changed = this.checkpoint !== null;
    this.owner = null;
    this.phase = undefined;
    this.checkpoint = null;
    this.touched.clear();
    if (changed) this.host.onChanged();
  }

  syncScope(): RespawnCheckpointScope | null {
    const scope = this.host.getScope();
    if (this.owner !== (scope?.owner ?? null) || this.phase !== scope?.phase) {
      const changed = this.checkpoint !== null;
      this.owner = scope?.owner ?? null;
      this.phase = scope?.phase;
      this.checkpoint = null;
      this.touched.clear();
      if (changed) this.host.onChanged();
    }
    return scope;
  }
}

function checkpointKey(checkpoint: RespawnCheckpoint): string {
  return JSON.stringify([checkpoint.kind, checkpoint.roomId,
    checkpoint.kind === 'object' ? checkpoint.instanceId : checkpoint.checkpointIndex]);
}

function isValidCheckpoint(checkpoint: RespawnCheckpoint): boolean {
  return Number.isFinite(checkpoint.x) && Number.isFinite(checkpoint.y)
    && checkpoint.x >= 0 && checkpoint.x <= ROOM_PX_WIDTH
    && checkpoint.y >= 0 && checkpoint.y <= ROOM_PX_HEIGHT
    && (checkpoint.kind === 'object'
      ? Boolean(checkpoint.instanceId) && checkpoint.checkpointIndex === null
      : typeof checkpoint.checkpointIndex === 'number'
        && Number.isSafeInteger(checkpoint.checkpointIndex) && checkpoint.checkpointIndex >= 0
        && checkpoint.instanceId === null);
}

function cloneCheckpoint(checkpoint: RespawnCheckpoint): RespawnCheckpoint {
  return { ...checkpoint, roomCoordinates: { ...checkpoint.roomCoordinates } };
}
