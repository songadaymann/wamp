import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import type { SharedRoomPreview } from './presenceProtocol';
import { RoomPreviewBroadcast } from './roomPreviewBroadcast';

function preview(roomId = '1,2', timestamp = 1000): SharedRoomPreview {
  const [x,y] = roomId.split(',').map(Number);
  return { roomId, roomCoordinates: {x,y}, snapshot: createDefaultRoomSnapshot(roomId,{x,y}),
    userId: 'builder', displayName: 'Builder', shardId: '0,0', timestamp };
}

describe('preview broadcast revisions and leases', () => {
  it('sends only changed rooms and detects equal newly parsed snapshots without a timestamp revision', () => {
    const broadcast = new RoomPreviewBroadcast(), a = preview(), b = preview('2,2');
    expect(broadcast.reconcile({'1,2':a,'2,2':b})).toHaveLength(2);
    const revision = broadcast.snapshot({'1,2':a})['1,2'].revision;
    expect(broadcast.reconcile({'1,2':{...a,timestamp:2000,snapshot:JSON.parse(JSON.stringify(a.snapshot))},'2,2':b})).toEqual([]);
    const changed = {...a,snapshot:{...a.snapshot,title:'changed'},timestamp:3000};
    const messages = broadcast.reconcile({'1,2':changed,'2,2':b});
    expect(messages).toEqual([{type:'preview:upsert',preview:expect.objectContaining({roomId:'1,2'})}]);
    if (messages[0].type === 'preview:upsert') expect(messages[0].preview.revision).not.toBe(revision);
  });
  it('join snapshots do not consume another viewer’s pending changes; removals happen once', () => {
    const broadcast = new RoomPreviewBroadcast(), a=preview();
    broadcast.reconcile({'1,2':a});
    const changed={...a,snapshot:{...a.snapshot,title:'new'}};
    const joined=broadcast.snapshot({'1,2':changed});
    expect(broadcast.reconcile({'1,2':changed})).toEqual([{type:'preview:upsert',preview:joined['1,2']}]);
    expect(broadcast.reconcile({})).toEqual([{type:'preview:remove',roomId:'1,2'}]);
    expect(broadcast.reconcile({})).toEqual([]);
    expect(broadcast.snapshot({'1,2':a})['1,2'].revision).not.toBe(joined['1,2'].revision);
  });
  it('refreshes leases cheaply, restoring full data when the previous lease could have expired', () => {
    const broadcast=new RoomPreviewBroadcast(), a=preview();
    broadcast.reconcile({'1,2':a});const revision=broadcast.snapshot({'1,2':a})['1,2'].revision;
    expect(broadcast.reconcile({'1,2':{...a,timestamp:61000}})).toEqual([
      {type:'preview:refresh',roomId:'1,2',revision,timestamp:61000}]);
    expect(broadcast.reconcile({'1,2':{...a,timestamp:181001}})[0]).toMatchObject({type:'preview:upsert',preview:{revision}});
    const otherOwner={...a,userId:'other',timestamp:182000};
    const next=broadcast.reconcile({'1,2':otherOwner});
    expect(next[0]).toMatchObject({type:'preview:upsert',preview:{userId:'other'}});
    if(next[0].type==='preview:upsert')expect(next[0].preview.revision).not.toBe(revision);
  });
});
