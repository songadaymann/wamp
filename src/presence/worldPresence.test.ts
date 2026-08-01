import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultRoomSnapshot,
  getRoomSnapshotCloneCount,
} from '../persistence/roomModel';
import {
  WorldPresenceClient,
  type WorldPresenceRoomPreview,
  type WorldPresenceSnapshot,
} from './worldPresence';

type PresenceHarness = Record<string, unknown>;

describe('WorldPresenceClient room preview ownership', () => {
  it('clones changed wire ingress once and re-emits its owned snapshot without cloning', () => {
    const onSnapshot = vi.fn<(snapshot: WorldPresenceSnapshot) => void>();
    const harness = createHarness(onSnapshot);
    const incoming = createPreview();
    const cloneCountBeforeIngress = getRoomSnapshotCloneCount();

    callReplaceRoomPreviews(harness, '0,0', { [incoming.roomId]: incoming });

    expect(getRoomSnapshotCloneCount() - cloneCountBeforeIngress).toBe(1);
    const stored = getStoredPreview(harness, incoming.roomId);
    expect(stored.snapshot).not.toBe(incoming.snapshot);
    incoming.snapshot.title = 'mutated outside client';
    incoming.snapshot.tileData.terrain[0][0] = 99;
    expect(stored.snapshot.title).toBe('wire ingress');
    expect(stored.snapshot.tileData.terrain[0][0]).toBe(-1);

    const cloneCountBeforeEmits = getRoomSnapshotCloneCount();
    for (let emission = 0; emission < 10; emission += 1) {
      callEmitSnapshot(harness);
      const emitted = onSnapshot.mock.calls.at(-1)?.[0].roomPreviews[incoming.roomId];
      expect(emitted?.snapshot).toBe(stored.snapshot);
    }

    expect(getRoomSnapshotCloneCount()).toBe(cloneCountBeforeEmits);
  });
});

function createPreview(): WorldPresenceRoomPreview {
  const snapshot = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
  snapshot.title = 'wire ingress';
  return {
    roomId: snapshot.id,
    roomCoordinates: { ...snapshot.coordinates },
    snapshot,
    timestamp: Date.now(),
    userId: 'remote-user',
    displayName: 'Remote Builder',
    shardId: '0,0',
  };
}

function createHarness(onSnapshot: (snapshot: WorldPresenceSnapshot) => void): PresenceHarness {
  return Object.assign(Object.create(WorldPresenceClient.prototype) as PresenceHarness, {
    options: {
      identity: { userId: 'local-user' },
      onSnapshot,
    },
    connectedShards: new Set<string>(),
    desiredShardIds: new Set<string>(),
    roomPopulationsByShardId: new Map(),
    roomEditorsByShardId: new Map(),
    roomPreviewsByShardId: new Map(),
    ghostsByConnectionId: new Map(),
    localPresence: null,
    localRoomPreview: null,
    pendingSnapshotEmit: false,
    snapshotEmitTimer: null,
    lastSnapshotEmittedAt: 0,
  });
}

function callReplaceRoomPreviews(
  harness: PresenceHarness,
  shardId: string,
  previews: Record<string, WorldPresenceRoomPreview>,
): void {
  const prototype = WorldPresenceClient.prototype as unknown as {
    replaceRoomPreviews(
      targetShardId: string,
      next: Record<string, WorldPresenceRoomPreview>,
    ): void;
  };
  prototype.replaceRoomPreviews.call(harness, shardId, previews);
}

function callEmitSnapshot(harness: PresenceHarness): void {
  const prototype = WorldPresenceClient.prototype as unknown as {
    emitSnapshot(): void;
  };
  prototype.emitSnapshot.call(harness);
}

function getStoredPreview(harness: PresenceHarness, roomId: string): WorldPresenceRoomPreview {
  const previewsByShard = harness.roomPreviewsByShardId as Map<
    string,
    Map<string, WorldPresenceRoomPreview>
  >;
  const preview = previewsByShard.get('0,0')?.get(roomId);
  if (!preview) throw new Error('Expected owned room preview.');
  return preview;
}
