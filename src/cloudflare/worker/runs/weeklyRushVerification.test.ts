import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import { RankedRunTraceRecorder } from '../../../scenes/overworld/rankedRunTraceRecorder';
import type { RoomRushRouteStepRecord } from '../../../runs/model';
import { verifyWeeklyRushTrace } from './verification';
const binding={verificationNonce:'weekly-test-nonce',verificationSnapshotHash:'weekly-test-hash'};
const rooms=[0,1,2].map(x=>createDefaultRoomSnapshot(`${x},0`,{x,y:0}));
const frame=(x:number,roomX=0)=>({roomCoordinates:{x:roomX,y:0},x,y:256,vx:640,vy:0,grounded:true,horizontalInput:1,verticalInput:0,jumpPressed:false});
function fixture(){
 const recorder=new RankedRunTraceRecorder();recorder.start('room',{verificationSchemaVersion:1,verificationNonce:binding.verificationNonce,snapshotHash:binding.verificationSnapshotHash},frame(64));
 for(const x of [200,360,520])recorder.recordFrame(250,frame(x));recorder.recordFrame(250,frame(40,1));
 const route:RoomRushRouteStepRecord[]=[0,1].map((x,i)=>({routeIndex:i,roomId:`${x},0`,coordinates:{x,y:0},uniqueVisitIndex:i+1}));
 return {trace:recorder.buildTrace(1000)!,binding,startRoom:rooms[0],rooms,route,elapsedMs:1300,deaths:0};
}
describe('weekly ranked Rush route evidence',()=>{
 it('accepts a complete bound movement path and derives the actual visited room sequence',()=>{
  expect(verifyWeeklyRushTrace(fixture())).toMatchObject({status:'passed',summary:{rooms:2,transitions:1}});
 });
 it.each(['nonce','snapshot','route','teleport','gap','clock','respawn','death','start'])( 'rejects invalid %s evidence',kind=>{
  const f=fixture();
  if(kind==='nonce')f.trace.verificationNonce='another-start';
  if(kind==='snapshot')f.trace.snapshotHash='another-room';
  if(kind==='route')f.route.push({routeIndex:2,roomId:'2,0',coordinates:{x:2,y:0},uniqueVisitIndex:3});
  if(kind==='teleport')f.trace.breadcrumbs[1].x=9000;
  if(kind==='gap'){f.trace.traceDurationMs=4000;f.elapsedMs=4000;f.trace.breadcrumbs[1].atMs=2000;}
  if(kind==='clock')f.elapsedMs=0;
  if(kind==='respawn')f.trace.respawnEvents=[{} as never];
  if(kind==='death')f.deaths=1;
  if(kind==='start')f.trace.breadcrumbs[0].roomX=1;
  expect(verifyWeeklyRushTrace(f).status).toBe('failed');
 });
 it('uses the existing frame-position slack at a same-frame boundary crossing',()=>{
  const f=fixture();f.trace.breadcrumbs[f.trace.breadcrumbs.length-1]={...f.trace.breadcrumbs.at(-1)!,roomX:0,x:630};
  f.trace.roomTransitions[0].x=5;
  expect(verifyWeeklyRushTrace(f).status).toBe('passed');
 });
 it('rejects negative local offsets that would disguise a remote room as a nearby point',()=>{
  const f=fixture();f.trace.roomTransitions[0].x=-560;
  expect(verifyWeeklyRushTrace(f).status).toBe('failed');
 });
 it('rejects invented room transitions around a stationary breadcrumb path',()=>{
  const f=fixture();for(const p of f.trace.breadcrumbs){p.roomX=0;p.x=64;}
  expect(verifyWeeklyRushTrace(f).status).toBe('failed');
 });
});
