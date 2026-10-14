import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { PresenceServerHarness, createTestConstructionPreviewToken, testIdentity,
  sendPresence, presencePayload, sendRoomPreview, roomPreviewPayload, clearRoomPreview } from './presenceServer.testHarness';

let harness: PresenceServerHarness;
afterEach(()=>harness?.dispose());

async function setup() {
  harness=new PresenceServerHarness();
  const editor=await harness.connect('editor',{previewDeltas:true});
  const viewer=await harness.connect('viewer',{previewDeltas:true});
  const legacy=await harness.connect('legacy');
  const chat=await harness.connect('chat',{channel:'room-chat'});
  sendPresence(harness,editor,presencePayload({mode:'edit'}));await harness.advance(250);
  for(const connection of [editor,viewer,legacy,chat])connection.clearMessages();
  const token=await createTestConstructionPreviewToken(testIdentity('editor'),{x:1,y:2});
  const snapshot=createDefaultRoomSnapshot('1,2',{x:1,y:2});
  sendRoomPreview(harness,editor,roomPreviewPayload({token,snapshot}));
  await harness.waitUntilPreviewStored('preview:1,2');await harness.advance(250);
  return {editor,viewer,legacy,chat,token,snapshot};
}

describe('negotiated preview deltas',()=>{
  it('keeps full playable data in one upsert, counts-only traffic thereafter, and legacy maps',async()=>{
    const {editor,viewer,legacy,chat,token,snapshot}=await setup();
    const messages=viewer.messages<Record<string,unknown>>();
    expect(messages.filter(m=>m.type==='preview:upsert')).toHaveLength(1);
    expect(messages.find(m=>m.type==='preview:upsert')).toMatchObject({preview:{snapshot:{tileData:snapshot.tileData}}});
    expect(messages.find(m=>m.type==='populations')).not.toHaveProperty('roomPreviews');
    expect(JSON.stringify(messages)).not.toContain(token);
    expect(legacy.messages<Record<string,unknown>>().find(m=>m.type==='populations')).toHaveProperty('roomPreviews.1,2');
    expect(chat.messages()).toEqual([]);
    viewer.clearMessages();legacy.clearMessages();
    sendPresence(harness,editor,presencePayload({mode:'edit',roomX:1,roomY:2}));
    const mover=await harness.connect('mover',{previewDeltas:true});
    sendPresence(harness,mover,presencePayload({roomX:2,roomY:2}));await harness.advance(250);
    expect(viewer.messages<Record<string,unknown>>().filter(m=>String(m.type).startsWith('preview:'))).toEqual([]);
    expect(viewer.messages<Record<string,unknown>>().find(m=>m.type==='populations')).not.toHaveProperty('roomPreviews');
    const joined=await harness.connect('joined',{previewDeltas:true});
    expect(joined.messages<Record<string,unknown>>().find(m=>m.type==='snapshot')).toHaveProperty('roomPreviews.1,2.revision');
    await harness.advance(250);
    expect(joined.messages<Record<string,unknown>>().filter(m=>m.type==='preview:upsert')).toEqual([]);
  });
  it('changes, clears and disconnects only the affected room',async()=>{
    const {editor,viewer,token,snapshot}=await setup();viewer.clearMessages();
    sendRoomPreview(harness,editor,roomPreviewPayload({token,snapshot:{...snapshot,title:'changed'}}));
    await harness.waitUntil(()=>harness.room.storage.peek<{snapshot:{title:string}}>('preview:1,2')?.snapshot.title==='changed','changed preview');
    await harness.advance(250);
    expect(viewer.messages<Record<string,unknown>>().filter(m=>m.type==='preview:upsert')).toHaveLength(1);
    viewer.clearMessages();clearRoomPreview(harness,editor);await harness.advance(250);
    expect(viewer.messages<Record<string,unknown>>().filter(m=>m.type==='preview:remove')).toEqual([{type:'preview:remove',roomId:'1,2'}]);
    sendRoomPreview(harness,editor,roomPreviewPayload({token,snapshot}));await harness.waitUntilPreviewStored('preview:1,2');await harness.advance(250);
    viewer.clearMessages();harness.close(editor);await harness.advance(250);
    expect(viewer.messages<Record<string,unknown>>().filter(m=>m.type==='preview:remove')).toEqual([{type:'preview:remove',roomId:'1,2'}]);
  });
  it('refreshes unchanged active previews without retransferring their room',async()=>{
    const {editor,viewer}=await setup();viewer.clearMessages();await harness.advance(60000);
    const mover=await harness.connect('mover',{previewDeltas:true});
    sendPresence(harness,mover,presencePayload({roomX:3}));await harness.advance(250);
    expect(viewer.messages<Record<string,unknown>>().filter(m=>m.type==='preview:upsert')).toEqual([]);
    expect(viewer.messages<Record<string,unknown>>().filter(m=>m.type==='preview:refresh')).toHaveLength(1);
    viewer.clearMessages();sendPresence(harness,editor,presencePayload({mode:'browse'}));await harness.advance(250);
    expect(viewer.messages<Record<string,unknown>>().filter(m=>m.type==='preview:remove')).toHaveLength(1);
  });
  it('restores persisted previews after server restart and removes them on expiry',async()=>{
    await setup();await harness.reactivate();
    const reconnect=await harness.connect('reconnect',{previewDeltas:true});
    expect(reconnect.messages<Record<string,unknown>>().find(m=>m.type==='snapshot')).toHaveProperty('roomPreviews.1,2.snapshot');
    reconnect.clearMessages();await harness.advance(120001);
    const late=await harness.connect('late',{previewDeltas:true});
    expect(late.messages<Record<string,unknown>>().find(m=>m.type==='snapshot')).toMatchObject({roomPreviews:{}});
    expect(reconnect.messages<Record<string,unknown>>().filter(m=>m.type==='preview:remove')).toEqual([{type:'preview:remove',roomId:'1,2'}]);
  });
  it('coalesces changes and cuts repeated population payload bytes without transferring snapshots',async()=>{
    const {editor,viewer,legacy,token,snapshot}=await setup();viewer.clearMessages();legacy.clearMessages();
    for(const title of ['first','last']){
      sendRoomPreview(harness,editor,roomPreviewPayload({token,snapshot:{...snapshot,title}}));
      await harness.waitUntil(()=>harness.room.storage.peek<{snapshot:{title:string}}>('preview:1,2')?.snapshot.title===title,title);
    }
    await harness.advance(250);
    expect(viewer.messages<Record<string,unknown>>().filter(m=>m.type==='preview:upsert')).toHaveLength(1);
    expect(viewer.messages<Record<string,unknown>>().find(m=>m.type==='preview:upsert')).toMatchObject({preview:{snapshot:{title:'last'}}});
    const mover=await harness.connect('mover',{previewDeltas:true});await harness.advance(250);
    viewer.clearMessages();legacy.clearMessages();
    for(let i=0;i<12;i++){sendPresence(harness,mover,presencePayload({roomX:i%2+2}));await harness.advance(250);}
    const filtered=(sent:string[])=>sent.filter(s=>JSON.parse(s).type==='populations');
    const bytes=(sent:string[])=>filtered(sent).reduce((sum,s)=>sum+new TextEncoder().encode(s).length,0);
    expect(filtered(viewer.sent)).toHaveLength(12);
    expect(bytes(viewer.sent)).toBeLessThan(bytes(legacy.sent)/20);
    expect(viewer.messages<Record<string,unknown>>().filter(m=>String(m.type).startsWith('preview:'))).toEqual([]);
  });
});
