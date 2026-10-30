import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import type { RoomRushRunStartResponse } from '../../runs/model';
import { verifyWeeklyRushTrace } from '../../cloudflare/worker/runs/verification';
import { OverworldRoomRushModeController } from './roomRushMode';
import type { OverworldRoomRushResultController } from './roomRushResults';

const mocks=vi.hoisted(()=>({start:vi.fn()}));
vi.mock('../../auth/client',()=>({getAuthDebugState:()=>({authenticated:true})}));
vi.mock('../../runs/runRepository',()=>({createRunRepository:()=>({startRoomRushRun:mocks.start})}));
vi.mock('../../worlds/clientContext',()=>({getActiveWorldId:()=>null}));
vi.mock('../../navigation/worldNavigation',()=>({setFocusedCoordinatesInUrl:vi.fn()}));
vi.mock('../../runs/weeklyRoomRushRepository',()=>({loadWeeklyRoomRush:async()=>({period:{weekKey:'UTC-2026-44'},pick:{available:true,coordinates:{x:0,y:0},roomVersion:1}})}));

beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));vi.clearAllMocks();});
afterEach(()=>vi.useRealTimers());
function fixture(){
 const rooms=[0,1].map(x=>({...createDefaultRoomSnapshot(`${x},0`,{x,y:0}),version:1,status:'published' as const}));
 let frame={roomCoordinates:{x:0,y:0},x:64,y:256,vx:640,vy:0,grounded:true,horizontalInput:1,verticalInput:0,jumpPressed:false};
 const start:RoomRushRunStartResponse={startId:'server-start',clientRunId:'server-run',difficulty:'hard',startRule:'weekly',startCoordinates:{x:0,y:0},
   startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),verificationSchemaVersion:1,
   verificationNonce:'server-nonce',snapshotHash:'server-hash'};
 mocks.start.mockResolvedValue(start);
 let mode='inspect'; const showResult=vi.fn();
 const host={getMode:()=>mode,setMode:(value:string)=>{mode=value;},setCameraMode:vi.fn(),getSelectedCoordinates:()=>({x:0,y:0}),
   setSelectedCoordinates:vi.fn(),setCurrentRoomCoordinates:vi.fn(),getInspectZoom:()=>1,setInspectZoom:vi.fn(),setBrowseInspectZoom:vi.fn(),
   getFitZoomForRoom:()=>1,setShouldCenterCamera:vi.fn(),setShouldRespawnPlayer:vi.fn(),isWithinLoadedRoomBounds:()=>true,
   refreshAround:async()=>true,refreshAroundIfNeededOrFromCache:vi.fn(),getRoomSnapshotForCoordinates:(c:{x:number;y:number})=>rooms[c.x]??null,
   getExpandedRoomIdAt:()=>null,isMultiCellExpandedRoomAt:()=>false,resetPlaySession:vi.fn(),clearTouchGestureState:vi.fn(),
   clearCurrentGoalRun:vi.fn(),clearRoomGoalIntroState:vi.fn(),syncScenePauseState:vi.fn(),syncModeRuntime:vi.fn(),syncAppMode:vi.fn(),
   showTransientStatus:vi.fn(),renderHud:vi.fn(),isDeathPending:()=>false,getTraceFrame:()=>frame};
 const controller=new OverworldRoomRushModeController(host as ConstructorParameters<typeof OverworldRoomRushModeController>[0],
   {showResult,reset:vi.fn()} as unknown as OverworldRoomRushResultController);
 return {controller,rooms,start,showResult,host,setFrame:(x:number,roomX=0)=>{frame={...frame,x,roomCoordinates:{x:roomX,y:0}};}};
}

describe('weekly Rush client trace lifecycle',()=>{
 it('records a real start, room boundary and terminal snapshot that the server verifier accepts',async()=>{
  const f=fixture();expect(await f.controller.start({difficulty:'hard',startRule:'weekly'})).toBe(true);
  expect(f.host.getMode()).toBe('play');
  expect(f.host.refreshAroundIfNeededOrFromCache).toHaveBeenCalledWith({x:0,y:0},{preferCachedWindow:true,refreshLeaderboards:false});
  f.controller.tick(0);
  for(const x of [200,360,520]){vi.advanceTimersByTime(250);f.setFrame(x);f.controller.tick(250);}
  vi.advanceTimersByTime(250);f.setFrame(40,1);f.controller.recordVisit(f.rooms[1]);f.controller.tick(250);f.controller.end();
  const run=f.controller.getCurrentRun()!;
  expect(run.verificationTrace?.verificationNonce).toBe(f.start.verificationNonce);
  expect(run.route).toHaveLength(2);
  expect(verifyWeeklyRushTrace({trace:run.verificationTrace!,binding:{verificationNonce:f.start.verificationNonce!,verificationSnapshotHash:f.start.snapshotHash!},
    startRoom:f.rooms[0],rooms:f.rooms,route:run.route,elapsedMs:run.elapsedMs,deaths:run.deaths}).status).toBe('passed');
  expect(f.showResult).toHaveBeenCalledOnce();
  const saved=run.verificationTrace;f.controller.reset();expect(saved?.roomTransitions).toHaveLength(1);
 });
 it('records the one terminal Hard death and never adds a respawn to a ranked weekly result',async()=>{
  const f=fixture();await f.controller.start({difficulty:'hard',startRule:'weekly'});f.controller.tick(0);
  vi.advanceTimersByTime(250);f.controller.tick(250);expect(f.controller.recordDeath('Hit')).toBe(true);
  const run=f.controller.getCurrentRun()!;
  expect(run.verificationTrace?.deathEvents).toHaveLength(1);
  expect(run.verificationTrace?.respawnEvents??[]).toHaveLength(0);
  expect(verifyWeeklyRushTrace({trace:run.verificationTrace!,binding:{verificationNonce:f.start.verificationNonce!,verificationSnapshotHash:f.start.snapshotHash!},
    startRoom:f.rooms[0],rooms:f.rooms,route:run.route,elapsedMs:run.elapsedMs,deaths:run.deaths}).status).toBe('passed');
 });
});
