import { ROOM_PREVIEW_TTL_MS } from './constructionPreviewRuntime';
import type { RoomPreviewDeltaMessage, SharedRoomPreview, VersionedSharedRoomPreview } from './presenceProtocol';

const REFRESH_INTERVAL_MS = ROOM_PREVIEW_TTL_MS / 2;

/** Full join snapshots and coalesced deltas share revisions, but separate delivery state. */
export class RoomPreviewBroadcast {
  private readonly epoch = crypto.randomUUID();
  private sequence = 0;
  private readonly versions = new Map<string, VersionedSharedRoomPreview>();
  private readonly serialized = new WeakMap<SharedRoomPreview['snapshot'], string>();
  private readonly delivered = new Map<string, VersionedSharedRoomPreview>();

  snapshot(previews: Record<string, SharedRoomPreview>): Record<string, VersionedSharedRoomPreview> {
    return Object.fromEntries(Object.entries(previews).map(([roomId, preview]) => {
      const previous = this.versions.get(roomId);
      const revision = previous && this.sameContent(previous, preview)
        ? previous.revision : `${this.epoch}:${++this.sequence}`;
      const next = { ...preview, revision };
      this.versions.set(roomId, next);
      return [roomId, next];
    }));
  }

  reconcile(previews: Record<string, SharedRoomPreview>): RoomPreviewDeltaMessage[] {
    const next = this.snapshot(previews);
    const messages: RoomPreviewDeltaMessage[] = [];
    for (const roomId of this.delivered.keys()) {
      if (!(roomId in next)) {
        messages.push({ type: 'preview:remove', roomId });
        this.delivered.delete(roomId);
      }
    }
    for (const [roomId, preview] of Object.entries(next)) {
      const previous = this.delivered.get(roomId);
      if (!previous || previous.revision !== preview.revision
        || preview.timestamp - previous.timestamp > ROOM_PREVIEW_TTL_MS) {
        // A client may already have expired an old lease; restore the full snapshot.
        messages.push({ type: 'preview:upsert', preview });
        this.delivered.set(roomId, preview);
      } else if (preview.timestamp - previous.timestamp >= REFRESH_INTERVAL_MS) {
        messages.push({ type: 'preview:refresh', roomId, revision: preview.revision, timestamp: preview.timestamp });
        this.delivered.set(roomId, preview);
      }
    }
    for (const roomId of this.versions.keys()) if (!(roomId in next)) this.versions.delete(roomId);
    return messages;
  }

  private sameContent(left: SharedRoomPreview, right: SharedRoomPreview): boolean {
    return left.userId === right.userId && left.displayName === right.displayName
      && left.shardId === right.shardId && left.roomCoordinates.x === right.roomCoordinates.x
      && left.roomCoordinates.y === right.roomCoordinates.y
      && (left.snapshot === right.snapshot || this.serialize(left.snapshot) === this.serialize(right.snapshot));
  }

  private serialize(snapshot: SharedRoomPreview['snapshot']): string {
    let serialized = this.serialized.get(snapshot);
    if (serialized === undefined) {
      serialized = JSON.stringify(snapshot);
      this.serialized.set(snapshot, serialized);
    }
    return serialized;
  }
}
