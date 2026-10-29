import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installFakeDom, FakeEvent } from '../testing/fakeDom';
const source=vi.hoisted(()=>({userId:'builder',worldId:'world-one' as string|null,load:vi.fn()}));
vi.mock('../../api/baseUrl',()=>({getApiBaseUrl:()=>''}));
vi.mock('../../auth/client',()=>({AUTH_STATE_CHANGED_EVENT:'auth-state-changed',getAuthDebugState:()=>({authenticated:!!source.userId,user:source.userId?{id:source.userId}:null})}));
vi.mock('../../worlds/clientContext',()=>({WORLD_CONTEXT_CHANGED_EVENT:'wamp:world-context-changed',getActiveWorldId:()=>source.worldId}));
vi.mock('./repository',()=>({WorldsRepository:class{publications=source.load;}}));
import { EditorPublicationFeedback } from './editorPublicationFeedback';
const opened:EditorPublicationFeedback[]=[];
beforeEach(()=>{vi.useFakeTimers();source.userId='builder';source.worldId='world-one';source.load.mockReset();});
afterEach(()=>{for(const item of opened.splice(0))item.destroy();vi.useRealTimers();vi.unstubAllGlobals();});
const pending=(stamp='saved')=>({id:'request',status:'pending',submittedDraftUpdatedAt:stamp,rejectionReason:null});
function setup(){
 const dom=installFakeDom();dom.settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};const node=dom.element('div',{'data-world-publication-status':'',class:'hidden'});dom.doc.body.append(node);dom.doc.body.dataset.appMode='editor';
 const state={roomId:'129,0',draftUpdatedAt:'saved',dirty:false};
 const game={scene:{isActive:()=>true,getScene:()=>({getWorldPublicationState:()=>state})}};
 const controller=new EditorPublicationFeedback(game as never,dom.doc as unknown as Document,dom.win as unknown as Window);opened.push(controller);
 const refresh=()=>dom.win.invoke(Object.assign(new FakeEvent('editor-ui-refresh'),{detail:{}}),'target');
 return {dom,node,state,controller,refresh};
}
it('keeps review status visible and warns when editing requires resubmission',async()=>{
 source.load.mockResolvedValue({requests:[pending()]});const f=setup();f.controller.init();await f.dom.settle();
 expect(source.load).toHaveBeenCalledWith('world-one',{mine:true,roomId:'129,0'});expect(f.node.textContent).toContain('Waiting');
 f.state.dirty=true;f.refresh();expect(f.node.textContent).toContain('Out of date');
 f.state.draftUpdatedAt='resubmitted';f.state.dirty=false;source.load.mockResolvedValue({requests:[pending('resubmitted')]});f.refresh();await f.dom.settle();expect(f.node.textContent).toContain('Waiting');
 source.load.mockResolvedValue({requests:[{...pending(),status:'rejected',rejectionReason:'Add an exit'}]});f.dom.win.invoke(new FakeEvent('focus'),'target');await f.dom.settle();expect(f.node.textContent).toContain('Needs changes: Add an exit');
});
it('discards the old account’s delayed result and hides status outside the editor',async()=>{
 let finish!:(value:unknown)=>void;source.load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({requests:[]});
 const f=setup();f.controller.init();source.userId='other';f.dom.win.invoke(new FakeEvent('auth-state-changed'),'target');await f.dom.settle();
 finish({requests:[{...pending(),status:'rejected',rejectionReason:'Private reason'}]});await f.dom.settle();expect(f.node.textContent).toBe('');
 f.dom.doc.body.dataset.appMode='world';f.refresh();await vi.advanceTimersByTimeAsync(60000);expect(source.load).toHaveBeenCalledTimes(2);expect(f.node.classList.contains('hidden')).toBe(true);
});
it('recovers from unavailable status and does not poll a hidden tab',async()=>{
 source.load.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({requests:[{...pending(),status:'approved'}]});const f=setup();f.controller.init();await f.dom.settle();expect(f.node.textContent).toContain('unavailable');
 f.dom.win.invoke(new FakeEvent('focus'),'target');await f.dom.settle();expect(f.node.textContent).toContain('Approved');
 Object.defineProperty(f.dom.doc,'visibilityState',{value:'hidden',configurable:true});f.dom.doc.dispatchEvent(new FakeEvent('visibilitychange'));await vi.advanceTimersByTimeAsync(60000);expect(source.load).toHaveBeenCalledTimes(2);
});
