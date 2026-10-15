import {describe,it,expect,vi} from 'vitest';
vi.mock('phaser',()=>({default:{Math:{Distance:{Between:(x1:number,y1:number,x2:number,y2:number)=>{const dx=x1-x2,dy=y1-y2;return Math.sqrt(dx*dx+dy*dy);}}}}}));
vi.mock('../../auth/client',()=>({getAuthDebugState:()=>({authenticated:false,source:null,user:null})}));
vi.mock('../../persistence/roomRepository',()=>({createRoomRepository:()=>({})}));
vi.mock('../../progression/postRunRatingEvents',()=>({requestPostRunGuestClaim:vi.fn(),requestPostRunRating:vi.fn()}));
vi.mock('../../progression/rewardStings',async importOriginal=>({...await importOriginal<typeof import('../../progression/rewardStings')>(),notifyRewardStings:vi.fn()}));
import {createDefaultRoomSnapshot} from '../../persistence/roomModel';
import type {RoomGoal} from '../../goals/roomGoals';
import {OverworldGoalRunController} from './goalRuns';
import {OverworldObjectiveController} from './objectiveController';
type ControllerConstructor=new(host:ConstructorParameters<typeof OverworldObjectiveController>[0],options:{goalTouchRadius:number})=>Pick<OverworldObjectiveController,'update'>;
export interface Input {goal:RoomGoal;entry?:'spawn'|'transition';result?:'active'|'completed'|'failed';nextIndex?:number;collected?:number;body?:{center:{x:number;y:number};bottom:number}|null;player?:boolean;suspended?:boolean;otherRoom?:boolean;npc?:{instanceId:string|null;name:string;alive:boolean;x:number;y:number}|null;delta?:number;}
export function setup(input:Input,Controller:ControllerConstructor=OverworldObjectiveController){
 const trace:unknown[][]=[];const goals=new OverworldGoalRunController({playerHeight:14,runRepository:{startRun:vi.fn(),finishRun:vi.fn(),loadRoomLeaderboard:vi.fn().mockResolvedValue(null),loadGlobalLeaderboard:vi.fn().mockResolvedValue(null)} as never,getScore:()=>0,getAuthenticated:()=>false,getAuthSource:()=>'session',getAuthDisplayName:()=>null,countRoomObjectsByCategory:()=>5,getNowIso:()=>'2026-10-15T00:00:00Z'});
 goals.syncRunForRoom({...createDefaultRoomSnapshot(),status:'published',spawnPoint:{x:64,y:256},goal:input.goal},input.entry??'spawn');const run=goals.getCurrentRun()!;Object.assign(run,{result:input.result??'active',nextCheckpointIndex:input.nextIndex??0,checkpointsReached:input.nextIndex??0,collectiblesCollected:input.collected??0});
 const spies={qualify:vi.spyOn(goals,'qualifyPracticeRunAt'),tick:vi.spyOn(goals,'tick'),checkpoint:vi.spyOn(goals,'recordCheckpointReached'),npcTarget:vi.spyOn(goals,'resolveNpcTarget'),escort:vi.spyOn(goals,'recordNpcReachedDestination'),give:vi.spyOn(goals,'recordGiveReturned'),complete:vi.spyOn(goals,'markCompleted')};
 const body=input.body===undefined?{center:{x:64,y:249},bottom:256}:input.body;
 const host={goalRunController:goals,getActiveCourseRun:()=>null,getPlayer:()=>input.player===false?null:{x:64,y:243},getPlayerBody:()=>body,getCurrentRoomCoordinates:()=>input.otherRoom?{x:1,y:0}:{x:0,y:0},getPlayerEffectOrigin:()=>({x:64,y:243}),toWorldGoalPoint:(_coords:unknown,p:{x:number;y:number})=>{trace.push(['world-point',p]);return p;},toWorldCoursePoint:(p:unknown)=>p,resetChallengeStateForCurrentRun:()=>trace.push(['reset']),getRoomNpcState:(...args:unknown[])=>{trace.push(['npc-state',...args]);return input.npc??null;},setRoomNpcsVictorious:(...args:unknown[])=>trace.push(['victorious',...args]),showTransientStatus:(...args:unknown[])=>trace.push(['status',...args]),redrawGoalMarkers:()=>trace.push(['markers']),activateRespawnCheckpoint:(...args:unknown[])=>trace.push(['respawn',...args]),playGoalFx:(...args:unknown[])=>trace.push(['fx',...args]),finalizeActiveCourseRun:(...args:unknown[])=>trace.push(['course-final',...args]),recordRankedGoalEvent:(...args:unknown[])=>trace.push(['event',...args])};
 const controller=new Controller(host as never,{goalTouchRadius:12});return {goals,run,trace,spies,controller,update:()=>controller.update(input.delta??1,input.suspended??false),snapshot:()=>({run,trace,calls:Object.fromEntries(Object.entries(spies).map(([k,s])=>[k,s.mock.calls]))})};
}

describe('room objective boundary contracts',()=>{
 it('records a checkpoint before permitting an overlapping finish on the next update',()=>{
  const h=setup({goal:{type:'checkpoint_sprint',checkpoints:[{x:64,y:256}],finish:{x:64,y:256},timeLimitMs:null}});h.update();expect(h.run.result).toBe('active');expect(h.run.nextCheckpointIndex).toBe(1);expect(h.trace.filter(t=>t[0]==='event').map(t=>(t[1] as {type:string}).type)).toEqual(['checkpoint']);h.update();expect(h.run.result).toBe('completed');expect(h.trace.filter(t=>t[0]==='event').map(t=>(t[1] as {type:string}).type)).toEqual(['checkpoint','finish']);expect(h.trace.find(t=>t[0]==='respawn')).toEqual(['respawn',{roomId:h.run.roomId,x:64,y:256},0]);
 });
 it('advances a suspended clock but prevents qualification and touching an exit',()=>{
  const h=setup({goal:{type:'reach_exit',exit:{x:64,y:256},timeLimitMs:null},suspended:true,delta:5});h.update();expect(h.run).toMatchObject({result:'active',elapsedMs:5});expect(h.spies.qualify).not.toHaveBeenCalled();expect(h.trace).toEqual([]);
 });
 it('requires collected Give items and keeps the inclusive52px return boundary',()=>{
  const goal={type:'npc_quest',questType:'give',npcInstanceId:null,durationMs:30000,requiredCount:2,destination:null,timeLimitMs:null} as const,npc={instanceId:'npc',name:'Test NPC',alive:true,x:116,y:249};
  const before=setup({goal,npc,collected:1});before.update();expect(before.run.result).toBe('active');const at=setup({goal,npc,collected:2});at.update();expect(at.run).toMatchObject({result:'completed',completionMessage:'Delivery complete.',npcTargetInstanceId:'npc'});const outside=setup({goal,npc:{...npc,x:116.0001},collected:2});outside.update();expect(outside.run.result).toBe('active');
 });
 it('leaves active room objectives alone without a player, body or matching room',()=>{
  for(const conditions of [{player:false},{body:null},{otherRoom:true}]){const h=setup({goal:{type:'reach_exit',exit:{x:64,y:256},timeLimitMs:null},...conditions});h.update();expect(h.run.result).toBe('active');expect(h.trace).toEqual([]);}
 });
});
