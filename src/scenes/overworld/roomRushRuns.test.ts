import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { OverworldRoomRushRunController } from './roomRushRuns';
const room={...createDefaultRoomSnapshot('0,0',{x:0,y:0}),status:'published' as const,version:1};
describe('weekly Room Rush clock and finalization',()=>{
  it('counts wall time through pauses/background throttling and ends exactly once at five minutes',()=>{
    let clock=100;const controller=new OverworldRoomRushRunController(()=>clock);
    controller.startRun({difficulty:'hard',startRule:'weekly',eventWeek:'UTC-2026-41',startCoordinates:room.coordinates,returnCoordinates:room.coordinates,startRoom:room});
    clock+=1000;controller.tick(16);expect(controller.getCurrentRun()?.elapsedMs).toBe(1000);
    clock+=400000;expect(controller.tick(16).terminalResult).toBe('completed');
    expect(controller.getCurrentRun()).toMatchObject({elapsedMs:300000,result:'completed',eventWeek:'UTC-2026-41'});
    expect(controller.tick(16).terminalResult).toBeNull();expect(controller.recordDeath('late').changed).toBe(false);
  });
  it('includes network setup time, ends on the first death and resets the new attempt cleanly',()=>{
    let clock=1000;const controller=new OverworldRoomRushRunController(()=>clock);
    const options={difficulty:'hard' as const,startRule:'weekly' as const,startCoordinates:room.coordinates,returnCoordinates:room.coordinates,startRoom:room,elapsedBeforePlayMs:1500};
    controller.startRun(options);controller.tick(16);expect(controller.getCurrentRun()?.elapsedMs).toBe(1500);
    expect(controller.recordDeath('ouch').terminalResult).toBe('failed');expect(controller.getCurrentRun()?.deaths).toBe(1);
    clock+=2000;controller.startRun({...options,elapsedBeforePlayMs:0});controller.tick(16);expect(controller.getCurrentRun()).toMatchObject({deaths:0,elapsedMs:0,result:'active'});
  });
  it('keeps ordinary easy/hard clocks and deaths behavior unchanged',()=>{
    const controller=new OverworldRoomRushRunController(()=>100000);
    controller.startRun({difficulty:'easy',startRule:'selected',startCoordinates:room.coordinates,returnCoordinates:room.coordinates,startRoom:room});
    controller.tick(400000);expect(controller.recordDeath('ouch').terminalResult).toBeNull();
    expect(controller.getCurrentRun()).toMatchObject({elapsedMs:400000,deaths:1,result:'active',timeLimitMs:null});
  });
});
