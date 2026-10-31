import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateComfortSettings } from '../../settings/comfortSettings';
beforeEach(()=>updateComfortSettings({clearedRoomChecks:true}));
vi.mock('phaser',()=>({default:{}}));
import { OverworldRoomCellController } from './roomCells';
function fixture(){
 const graphics=()=>({clear:vi.fn(),fillStyle:vi.fn(),fillRect:vi.fn(),setDepth:vi.fn(),destroy:vi.fn()});
 const layers=[graphics(),graphics(),graphics()],add=vi.fn(()=>layers[add.mock.calls.length-1]);
 let mode='browse',state='published',cleared=false,changed=()=>{};const unsubscribe=vi.fn();
 const controller=new OverworldRoomCellController({scene:{add:{graphics:add}},getWorldWindow:()=>({center:{x:0,y:0},radius:0}),getZoom:()=>0.2,
   getRoomOrigin:()=>({x:0,y:0}),getCellStateAt:()=>state,getRoomEditorCount:()=>0,getCurrentRoomCoordinates:()=>({x:0,y:0}),
   getSelectedCoordinates:()=>({x:0,y:0}),getMode:()=>mode,isRoomInActiveCourse:()=>false,getExpandedRoomIdAt:()=> 'expanded',
   hasFoundLostSong:()=>true,hasClearedRoom:()=>cleared,subscribeClearedRooms:(listener:()=>void)=>{changed=listener;return unsubscribe;}} as never);
 controller.create();return {controller,layers,add,unsubscribe,set:(values:{mode?:string;state?:string;cleared?:boolean})=>{
   mode=values.mode??mode;state=values.state??state;cleared=values.cleared??cleared;},changed:()=>changed()};
}
describe('shape-based personal cleared-room checks',()=>{
 it('hides checks by default and redraws immediately on toggle without losing progress',()=>{
   updateComfortSettings({clearedRoomChecks:false});
   const f=fixture();f.set({cleared:true});f.controller.redraw();
   expect(f.layers[1].fillStyle).not.toHaveBeenCalledWith(0xfff3d6,1);
   updateComfortSettings({clearedRoomChecks:true});
   expect(f.layers[1].fillStyle).toHaveBeenCalledWith(0xfff3d6,1);
   f.layers[1].fillStyle.mockClear();updateComfortSettings({clearedRoomChecks:false});
   expect(f.layers[1].fillStyle).not.toHaveBeenCalledWith(0xfff3d6,1);
   f.controller.destroy();
 });
 it('draws a high-contrast corner tick alongside the Lost Song frame, including Expanded cells',()=>{
   const f=fixture();f.set({cleared:true});f.controller.redraw();
   expect(f.layers[1].fillStyle).toHaveBeenCalledWith(0xfff3d6,1);
   expect(f.layers[1].fillStyle).toHaveBeenCalledWith(0xf4cc55,0.9);
   expect(f.layers[1].fillRect).toHaveBeenCalledWith(524,20,96,96);
   for(const [x,y] of [[0.14,0.44],[0.28,0.58],[0.42,0.44],[0.56,0.30],[0.70,0.16]])
     expect(f.layers[1].fillRect).toHaveBeenCalledWith(524+x*96,20+y*96,96*0.18,96*0.18);
 });
 it('redraws while the map is idle when personal progress changes and unsubscribes without allocating more graphics',()=>{
   const f=fixture();f.controller.redraw();expect(f.layers[1].fillStyle).not.toHaveBeenCalledWith(0xfff3d6,1);
   f.set({cleared:true});f.changed();expect(f.layers[1].fillStyle).toHaveBeenCalledWith(0xfff3d6,1);expect(f.add).toHaveBeenCalledTimes(3);
   f.controller.destroy();expect(f.unsubscribe).toHaveBeenCalledOnce();
 });
 it.each([{mode:'play',state:'published'},{mode:'browse',state:'draft'},{mode:'browse',state:'claimed_unpublished'}])('never marks a $mode/$state cell',options=>{
   const f=fixture();f.set({...options,cleared:true});f.controller.redraw();expect(f.layers[1].fillStyle).not.toHaveBeenCalledWith(0xfff3d6,1);
 });
});
