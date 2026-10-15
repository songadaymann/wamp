import {describe,expect,it} from 'vitest';
import {createDefaultRoomSnapshot} from '../../../persistence/roomModel';
import {createDefaultRoomGoal,type RoomGoal} from '../../../goals/roomGoals';
import {POLICE_PATROLMAN_OBJECT_ID} from '../../../enemies/policeEnemy';
import {RankedRunTraceRecorder,type RankedRunTraceFrameInput} from '../../../scenes/overworld/rankedRunTraceRecorder';
import {verifyRoomRunTrace} from './verification';
const binding={verificationNonce:'test-bound-nonce',verificationSnapshotHash:'test-bound-snapshot'};
const clientBinding={verificationNonce:binding.verificationNonce,snapshotHash:binding.verificationSnapshotHash,verificationSchemaVersion:1};
const frame:RankedRunTraceFrameInput={roomCoordinates:{x:0,y:0},x:64,y:256,vx:0,vy:0,grounded:true,horizontalInput:0,verticalInput:0,jumpPressed:false};
async function verify(goal:RoomGoal,events:Array<'collectible'|'enemy'|'checkpoint'|'finish'|'reach_exit'>=[]){
 const room={...createDefaultRoomSnapshot(),spawnPoint:{x:64,y:256},goal};
 room.placedObjects=[{id:'coin_gold',instanceId:'coin-1',x:64,y:256},{id:POLICE_PATROLMAN_OBJECT_ID,instanceId:'enemy-1',x:64,y:240}];
 const trace=new RankedRunTraceRecorder();trace.start('room',clientBinding,frame);
 for(let step=0;step<4;step++)trace.recordFrame(250,frame);
 for(const type of events)trace.recordGoalEvent({type,actor:'player',roomId:room.id,roomX:0,roomY:0,x:64,y:256,instanceId:type==='collectible'?'coin-1':type==='enemy'?'enemy-1':null,checkpointIndex:type==='checkpoint'?0:null});
 return verifyRoomRunTrace({room,trace:trace.buildTrace(1000)!,binding,elapsedMs:1000,deaths:0});
}
describe('goal verification routing compatibility',()=>{
 it.each([
  ['reach_exit',{issue:'missing_exit'}],
  ['collect_target',{issue:'collect_target_shortfall',requiredCount:3,collectedCount:0}],
  ['defeat_all',{issue:'defeat_all_shortfall',requiredCount:1,defeatedCount:0}],
  ['checkpoint_sprint',{issue:'missing_finish'}],
 ] as const)('retains %s failure details',async(type,summary)=>{const result=await verify(createDefaultRoomGoal(type));expect(result.status,JSON.stringify(result)).toBe('failed');expect(result.reason).toBe('trace_goal');expect(result.summary).toMatchObject(summary);});
 it.each(['collect_race','survival','npc_quest'] as const)('retains %s routing without an extra marker rule',async type=>{const result=await verify(createDefaultRoomGoal(type));expect(result.status,JSON.stringify(result)).toBe('passed');});
 it('accepts a bound exit event and rejects an exit event away from the authored exit',async()=>{
  const goal={type:'reach_exit' as const,exit:{x:64,y:256},timeLimitMs:null};expect((await verify(goal,['reach_exit'])).status).toBe('passed');
  expect((await verify({...goal,exit:{x:320,y:256}},['reach_exit'])).summary).toMatchObject({issue:'missing_exit'});
 });
 it('retains collectible and enemy counts after verified events',async()=>{
  const collect=await verify({type:'collect_target',requiredCount:1,timeLimitMs:null},['collectible']);expect(collect.status,JSON.stringify(collect)).toBe('passed');expect(collect.derivedMetrics.collectiblesCollected).toBe(1);
  const enemy=await verify(createDefaultRoomGoal('defeat_all'),['enemy']);expect(enemy.status,JSON.stringify(enemy)).toBe('passed');expect(enemy.derivedMetrics.enemiesDefeated).toBe(1);
 });
 it('retains checkpoint shortfall, finish ordering and metrics',async()=>{
  const goal={type:'checkpoint_sprint' as const,checkpoints:[{x:64,y:256}],finish:{x:64,y:256},timeLimitMs:null};
  expect((await verify(goal)).summary).toMatchObject({issue:'checkpoint_shortfall',requiredCount:1,reachedCount:0});
  expect((await verify(goal,['checkpoint'])).summary).toMatchObject({issue:'missing_finish'});
  const result=await verify(goal,['checkpoint','finish']);expect(result.status,JSON.stringify(result)).toBe('passed');expect(result.derivedMetrics.checkpointsReached).toBe(1);
 });
 it('retains NPC Give shortfall and completion checks and Escort completion',async()=>{
  const goal={type:'npc_quest' as const,questType:'give' as const,npcInstanceId:null,requiredCount:1,durationMs:30000,destination:null,timeLimitMs:null};
  expect((await verify(goal)).summary).toMatchObject({issue:'npc_give_shortfall',requiredCount:1,collectedCount:0});
  expect((await verify(goal,['collectible'])).summary).toMatchObject({issue:'npc_quest_missing_completion'});
  expect((await verify(goal,['collectible','finish'])).status).toBe('passed');
  expect((await verify({...goal,questType:'escort'})).summary).toMatchObject({issue:'npc_quest_missing_completion'});
 });
 it.each(['king_of_the_hill','toString','constructor','__proto__'])('fails closed for unregistered %s goals',async type=>{
  const result=await verify({type,timeLimitMs:null} as unknown as RoomGoal);expect(result.status).toBe('failed');expect(result.summary).toMatchObject({issue:'unverified_goal_type',goalType:type});
 });
 const nonStringTypes: Array<{ label: string; value: unknown }> = [
  {label:'missing',value:undefined},{label:'null',value:null},{label:'number',value:0},
  {label:'object',value:{}},{label:'non-coercible object',value:{toString:null}},
 ];
 for (const {label,value} of nonStringTypes) {
  it(`retains rejection of a ${label} goal type`,async()=>{
   const result=await verify({type:value,timeLimitMs:null} as unknown as RoomGoal);expect(result.status).toBe('failed');expect(result.summary.issue).toBe('unverified_goal_type');expect(result.summary.goalType).toEqual(value??null);
  });
 }
});
