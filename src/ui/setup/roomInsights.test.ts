import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomInsightsController } from './roomInsights';
import { emptyInsightSummary, type RoomInsightsResponse } from '../../insights/model';
class Element extends EventTarget {
 classes=new Set(['hidden']);children:Element[]=[];textContent='';value='';checked=false;disabled=false;isConnected=true;
 attributes=new Map<string,string>();constructor(public id=''){super();}
 classList={add:(v:string)=>this.classes.add(v),remove:(v:string)=>this.classes.delete(v),contains:(v:string)=>this.classes.has(v),
  toggle:(v:string,force?:boolean)=>{const enabled=force??!this.classes.has(v);if(enabled)this.classes.add(v);else this.classes.delete(v);return enabled;}};
 setAttribute(k:string,v:string){this.attributes.set(k,v);}replaceChildren(...c:Element[]){this.children=c;}append(...c:Element[]){this.children.push(...c);}
 focus=vi.fn();click(){this.dispatchEvent(new Event('click'));}closest(){return this;}getClientRects(){return [{}];}querySelectorAll(){return [];}
}
class Emitter extends EventTarget {on(name:string,fn:()=>void){this.addEventListener(name,fn);}off(name:string,fn:()=>void){this.removeEventListener(name,fn);}emit(name:string){this.dispatchEvent(new Event(name));}}
const opened:RoomInsightsController[]=[];afterEach(()=>{for(const c of opened.splice(0))c.destroy();vi.unstubAllGlobals();});
const tick=async()=>{for(let n=0;n<15;n++)await Promise.resolve();};
const result=():RoomInsightsResponse=>({target:{contentType:'room',contentId:'0,0',version:3},title:'Changed layout',cells:[{x:0,y:0}],
 summary:{...emptyInsightSummary(),attempts:2,uniquePlayers:2,completions:1,clearRate:0.5,medianClearMs:9000,averageDeaths:2,totalDeaths:4,mappedAttempts:2,mappedDeaths:4},
 deathMap:[{roomX:0,roomY:0,tileX:6,tileY:9,deaths:4}],deathMapTruncated:false,equivalentVersions:[3],versionGrouping:'matching',
 comparison:{target:{contentType:'room',contentId:'0,0',version:2},title:'Previous layout',cells:[{x:0,y:0}],
 summary:{...emptyInsightSummary(),attempts:4,uniquePlayers:3,completions:4,clearRate:1,medianClearMs:2000,averageDeaths:0.5,totalDeaths:2,mappedAttempts:4,mappedDeaths:2},
 deathMap:[{roomX:0,roomY:0,tileX:4,tileY:9,deaths:2}],deathMapTruncated:false,equivalentVersions:[1,2],versionGrouping:'matching'}});
function fixture(){
 const elements=new Map<string,Element>(),get=(id:string)=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id)!;};
 const doc=Object.assign(new EventTarget(),{body:{dataset:{appMode:'editor'}},activeElement:null,getElementById:get,createElement:()=>new Element()});
 const win=new EventTarget(),events=new Emitter(),state={version:3};
 const scene={events,getRoomInsightsTarget:()=>({contentType:'room',contentId:'0,0',version:state.version}),setRoomDeathMap:vi.fn(),clearRoomDeathMap:vi.fn()};
 const game={scene:{isActive:(key:string)=>key==='EditorScene',getScene:()=>scene}},load=vi.fn(async()=>result());
 vi.stubGlobal('HTMLElement',Element);vi.stubGlobal('HTMLButtonElement',Element);vi.stubGlobal('Element',Element);
 const controller=new RoomInsightsController(game as never,doc as unknown as Document,win as unknown as Window,load);controller.init();opened.push(controller);
 const open=()=>{const event=new Event('click');Object.defineProperty(event,'target',{value:get('insights-open')});doc.dispatchEvent(event);};
 const select=(v:string)=>{get('room-insights-map-version').value=v;get('room-insights-map-version').dispatchEvent(new Event('change'));};
 const toggle=()=>{get('room-insights-map').checked=true;get('room-insights-map').dispatchEvent(new Event('change'));};
 return{get,doc,win,state,scene,load,controller,open,select,toggle};
}
describe('matching-version insights comparison',()=>{
 it('shows both metric groups and switches the live editor map without leaving stale points',async()=>{
  const f=fixture();f.open();await tick();expect(f.get('room-insights-selected-versions').textContent).toContain('v3');
  expect(f.get('room-insights-previous-versions').textContent).toContain('v1, v2');expect(f.get('room-insights-previous').classes.has('hidden')).toBe(false);
  expect(f.get('room-insights-metrics').children[0].children[1].textContent).toBe('2');expect(f.get('room-insights-previous-metrics').children[0].children[1].textContent).toBe('4');
  f.toggle();expect(f.scene.setRoomDeathMap).toHaveBeenLastCalledWith(result().deathMap);f.select('previous');
  expect(f.scene.setRoomDeathMap).toHaveBeenLastCalledWith(result().comparison!.deathMap);expect(f.get('editor-death-map-version').textContent).toContain('v2');
  expect(f.get('room-insights-coverage').textContent).toContain('v2: 2 of 2');
  f.get('btn-room-insights-close').click();f.open();await tick();expect(f.get('room-insights-map-version').value).toBe('previous');
  expect(f.scene.setRoomDeathMap).toHaveBeenLastCalledWith(result().comparison!.deathMap);
 });
 it('clears a selected previous map when switching to a version without locations',async()=>{
  const f=fixture(),data=result();data.deathMap=[];data.summary.mappedAttempts=0;f.load.mockResolvedValue(data);f.open();await tick();
  expect(f.get('room-insights-map').disabled).toBe(true);f.select('previous');f.toggle();expect(f.scene.setRoomDeathMap).toHaveBeenCalledOnce();
  f.select('current');expect(f.get('room-insights-map').checked).toBe(false);expect(f.get('editor-death-map-key').classes.has('hidden')).toBe(true);
 });
 it('discards late responses and removes maps when the editor version or lifetime changes',async()=>{
  const f=fixture();let finish!:(value:RoomInsightsResponse)=>void;f.load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));f.open();
  f.state.version=4;f.win.dispatchEvent(new Event('editor-ui-refresh'));finish(result());await tick();expect(f.get('room-insights-modal').classes.has('hidden')).toBe(true);
  expect(f.get('room-insights-metrics').children).toHaveLength(0);f.state.version=3;f.open();await tick();f.toggle();f.scene.events.emit('sleep');
  expect(f.get('editor-death-map-key').classes.has('hidden')).toBe(true);expect(f.scene.clearRoomDeathMap).toHaveBeenCalled();
 });
 it('keeps older/exact responses usable and disables editor overlays in public profile views',async()=>{
  const f=fixture(),data=result();delete data.comparison;delete data.equivalentVersions;delete data.versionGrouping;f.load.mockResolvedValue(data);
  f.win.dispatchEvent(new CustomEvent('room-insights-open',{detail:{contentType:'room',contentId:'0,0',version:3}}));await tick();
  expect(f.get('room-insights-selected-versions').textContent).toBe('Exact published v3');expect(f.get('room-insights-previous').classes.has('hidden')).toBe(true);
  expect(f.get('room-insights-map-version-label').classes.has('hidden')).toBe(true);expect(f.get('room-insights-map').disabled).toBe(true);
 });
});
