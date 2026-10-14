import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultRoomSnapshot,
  getRoomSnapshotCloneCount,
} from '../persistence/roomModel';
import {
  WorldPresenceClient,
  resolveWorldPresenceGuestIdentity,
  type WorldPresenceRoomPreview,
  type WorldPresenceSnapshot,
} from './worldPresence';

type PresenceHarness = Record<string, unknown>;

describe('WorldPresenceClient room preview ownership', () => {
  it.each(['getter', 'read'] as const)('retains the guest recovery identity when the storage %s is blocked', kind => {
    const target = { location: { search: '' } };
    Object.defineProperty(target, 'localStorage', kind === 'getter' ? {
      get: () => { throw new Error('Blocked'); },
    } : { value: {
      getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Blocked'); },
    } });
    vi.stubGlobal('window', target);
    try {
      const first = resolveWorldPresenceGuestIdentity();
      expect(first.userId).toMatch(/^guest-/);
      expect(resolveWorldPresenceGuestIdentity().userId).toBe(first.userId);
    } finally { vi.unstubAllGlobals(); }
  });
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

  it('keeps snapshot identity for counts, lease refreshes and duplicate revisions, but owns changed data', () => {
    const harness=createHarness(vi.fn()), incoming={...createPreview(),revision:'epoch:1'};
    const before=getRoomSnapshotCloneCount();
    handle(harness,{type:'snapshot',peers:[],roomPopulations:{},roomEditors:{},roomPreviews:{[incoming.roomId]:incoming}});
    const original=getStoredPreview(harness,incoming.roomId);
    expect(getRoomSnapshotCloneCount()-before).toBe(1);
    handle(harness,{type:'populations',roomPopulations:{'5,7':2},roomEditors:{'5,7':1}});
    handle(harness,{type:'preview:refresh',roomId:incoming.roomId,revision:'epoch:1',timestamp:incoming.timestamp+1000});
    handle(harness,{type:'preview:upsert',preview:{...incoming,timestamp:incoming.timestamp+2000}});
    expect(getStoredPreview(harness,incoming.roomId).snapshot).toBe(original.snapshot);
    expect(getRoomSnapshotCloneCount()-before).toBe(1);
    handle(harness,{type:'preview:upsert',preview:{...incoming,revision:'epoch:2',snapshot:{...incoming.snapshot,title:'new'}}});
    const changed=getStoredPreview(harness,incoming.roomId);
    expect(changed.snapshot).not.toBe(original.snapshot);expect(changed.snapshot.title).toBe('new');
    expect(getRoomSnapshotCloneCount()-before).toBe(2);
    handle(harness,{type:'preview:refresh',roomId:incoming.roomId,revision:'epoch:1',timestamp:incoming.timestamp+9000});
    expect(getStoredPreview(harness,incoming.roomId).timestamp).toBe(changed.timestamp);
    handle(harness,{type:'preview:remove',roomId:incoming.roomId});
    expect((harness.roomPreviewsByShardId as Map<string,Map<string,unknown>>).get('0,0')?.size).toBe(0);
    callEmitSnapshot(harness);
  });

  it('uses complete snapshot baselines to remove missing rooms and retains old-server populations compatibility', () => {
    const harness=createHarness(vi.fn()), incoming={...createPreview(),revision:'epoch:1'};
    callReplaceRoomPreviews(harness,'0,0',{[incoming.roomId]:incoming});
    handle(harness,{type:'populations',roomPopulations:{},roomEditors:{},roomPreviews:{}});
    expect((harness.roomPreviewsByShardId as Map<string,Map<string,unknown>>).get('0,0')?.size).toBe(0);
    handle(harness,{type:'preview:upsert',preview:incoming});
    const owned=getStoredPreview(harness,incoming.roomId).snapshot;
    handle(harness,{type:'snapshot',peers:[],roomPopulations:{},roomEditors:{},roomPreviews:{[incoming.roomId]:incoming}});
    expect(getStoredPreview(harness,incoming.roomId).snapshot).toBe(owned);
    handle(harness,{type:'snapshot',peers:[],roomPopulations:{},roomEditors:{},roomPreviews:{}});
    expect((harness.roomPreviewsByShardId as Map<string,Map<string,unknown>>).get('0,0')?.size).toBe(0);
    callEmitSnapshot(harness);
  });

  it('negotiates preview deltas alongside the refreshed identity token', async () => {
    const harness=createHarness(vi.fn());harness.identityTokenProvider={getToken:async()=> 'signed-token'};
    const prototype=WorldPresenceClient.prototype as unknown as {getSocketQuery:()=>Promise<unknown>};
    expect(await prototype.getSocketQuery.call(harness)).toEqual({identityToken:'signed-token',previewDeltas:'1'});
  });
});

function handle(harness: PresenceHarness,message: unknown): void {
  const prototype=WorldPresenceClient.prototype as unknown as {handlePresenceMessage:(shardId:string,message:string)=>void};
  prototype.handlePresenceMessage.call(harness,'0,0',JSON.stringify(message));
}

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
