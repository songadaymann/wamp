import { getActiveWorldId, WORLD_CONTEXT_CHANGED_EVENT } from '../../worlds/clientContext';
import { AUTH_STATE_CHANGED_EVENT, getAuthDebugState } from '../../auth/client';
import { KEEP_PLAYING_CLEAR_EVENT, KEEP_PLAYING_REQUEST_EVENT, KEEP_PLAYING_RESET_EVENT, type KeepPlayingClear } from '../../progression/keepPlayingEvents';
import { loadGuestRunProgress } from '../../progression/guestRunProgress';
import { createRunRepository } from '../../runs/runRepository';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import { requestRoomSequenceStart } from './roomSequenceEvents';

export class KeepPlayingController {
  private clear: KeepPlayingClear | null = null;
  private readonly sessionClears=new Set<string>();
  private generation=0;
  private busy=false;
  private dismissed=false;
  private destroyed=false;
  private observer:MutationObserver|null=null;
  private readonly blockedKeys=new Set<string>();
  private readonly root;
  private readonly action;
  private readonly dismiss;
  private readonly status;
  constructor(private readonly beforeStart:()=>void,private readonly doc:Document=document,private readonly win:Window=window) {
    this.root=doc.getElementById('keep-playing');this.action=doc.getElementById('btn-keep-playing') as HTMLButtonElement|null;
    this.dismiss=doc.getElementById('btn-keep-playing-dismiss');this.status=doc.getElementById('keep-playing-status');
  }
  init():void {
    this.win.addEventListener(KEEP_PLAYING_RESET_EVENT,this.onReset);
    this.win.addEventListener(KEEP_PLAYING_CLEAR_EVENT,this.onClear);this.win.addEventListener(KEEP_PLAYING_REQUEST_EVENT,this.onRequest);
    this.win.addEventListener(AUTH_STATE_CHANGED_EVENT,this.onAuth);this.win.addEventListener(WORLD_CONTEXT_CHANGED_EVENT,this.onAuth);this.win.addEventListener(APP_MODE_CHANGED_EVENT,this.onMode);
    this.action?.addEventListener('click',this.onRequest);this.dismiss?.addEventListener('click',this.onDismiss);
    this.win.addEventListener('keydown',this.onKeydown,true);this.win.addEventListener('keyup',this.onKeyup,true);
    if(typeof MutationObserver!=='undefined') {
      this.observer=new MutationObserver(()=>{if(this.sequenceActive()||!this.inWorld()){this.generation++;this.busy=false;}this.render();});
      this.observer.observe(this.doc.body,{attributes:true,attributeFilter:['data-app-mode','data-room-sequence-active']});
      for(const element of this.doc.querySelectorAll('.history-modal, .pvp-modal, #auth-panel, #busy-overlay, #reward-sting-layer'))
        this.observer.observe(element,{attributes:true,attributeFilter:['class','aria-hidden']});
    }
    this.render();
  }
  destroy():void {
    this.destroyed=true;this.generation++;this.observer?.disconnect();
    this.win.removeEventListener(KEEP_PLAYING_RESET_EVENT,this.onReset);
    this.win.removeEventListener(KEEP_PLAYING_CLEAR_EVENT,this.onClear);this.win.removeEventListener(KEEP_PLAYING_REQUEST_EVENT,this.onRequest);
    this.win.removeEventListener(AUTH_STATE_CHANGED_EVENT,this.onAuth);this.win.removeEventListener(WORLD_CONTEXT_CHANGED_EVENT,this.onAuth);this.win.removeEventListener(APP_MODE_CHANGED_EVENT,this.onMode);
    this.action?.removeEventListener('click',this.onRequest);this.dismiss?.removeEventListener('click',this.onDismiss);
    this.win.removeEventListener('keydown',this.onKeydown,true);this.win.removeEventListener('keyup',this.onKeyup,true);this.render();
  }
  private readonly onClear=(event:Event)=>{
    const detail=(event as CustomEvent<KeepPlayingClear>).detail;
    if(!detail?.contentId)return;
    this.generation++;this.busy=false;this.clear=detail;this.dismissed=false;
    this.sessionClears.add(detail.contentId);
    while(this.sessionClears.size>100)this.sessionClears.delete(this.sessionClears.values().next().value!);
    if(this.status)this.status.textContent='';this.render();
  };
  private readonly onReset=()=>{this.generation++;this.busy=false;this.clear=null;this.render();};
  private readonly onAuth=()=>{this.generation++;this.busy=false;this.clear=null;this.sessionClears.clear();this.render();};
  private readonly onMode=()=>{if(!this.inWorld()){this.generation++;this.busy=false;}this.render();};
  private readonly onDismiss=()=>{this.dismissed=true;this.generation++;this.busy=false;this.dismiss?.blur();this.render();};
  private readonly onRequest=()=>{void this.startNext();};
  private inWorld():boolean {return !getActiveWorldId()&&['world','play-world'].includes(this.doc.body.dataset.appMode ?? '');}
  private sequenceActive():boolean {return this.doc.body.dataset.roomSequenceActive==='true';}
  private async startNext():Promise<void> {
    const clear=this.clear;if(!clear||this.busy||this.destroyed||!this.inWorld()||this.sequenceActive())return;
    const auth=getAuthDebugState(),identity=auth.user?.id ?? null,generation=++this.generation;
    const current=()=>!this.destroyed&&this.generation===generation&&this.clear===clear&&this.inWorld()&&!this.sequenceActive()
      && (getAuthDebugState().user?.id ?? null)===identity;
    this.busy=true;if(this.status)this.status.textContent='';this.render();
    try {
      const {findKeepPlayingDestination}=await import('../../runs/keepPlaying');
      if(!current())return;
      const runs=createRunRepository();
      const target=await findKeepPlayingDestination({clear,signedIn:auth.authenticated,local:loadGuestRunProgress().records,
        sessionClears:this.sessionClears,load:runs.loadRoomDiscovery.bind(runs),current});
      if(!current())return;
      if(!target){if(this.status)this.status.textContent='No unbeaten room found. Try Explore for more rooms.';return;}
      this.beforeStart();this.clear=null;
      requestRoomSequenceStart({mode:'play',kind:'explore',sourceLabel:'Keep playing',kickerLabel:'Keep playing',forceGoalIntro:true,
        entries:[{roomId:target.roomId,roomCoordinates:target.roomCoordinates,roomVersion:target.roomVersion,roomTitle:target.roomTitle,
          expandedRoomId:target.expandedRoom?.expandedRoomId,expandedRoomVersion:target.expandedRoom?.expandedRoomVersion,
          expandedRoomCellCount:target.expandedRoom?.cellCount,legacyCourseId:target.expandedRoom?.legacyCourseId}]});
    } catch {if(current()&&this.status)this.status.textContent='Could not find the next room. Tap Keep playing to retry.';}
    finally {if(this.generation===generation){this.busy=false;this.render();}}
  }
  private readonly onKeydown=(event:KeyboardEvent)=>{
    if(![' ','Enter'].includes(event.key)||!this.root?.contains(this.doc.activeElement))return;
    this.blockedKeys.add(event.code);event.preventDefault();event.stopImmediatePropagation();
    if(!event.repeat)(this.doc.activeElement as HTMLElement).click();
  };
  private readonly onKeyup=(event:KeyboardEvent)=>{
    if(this.blockedKeys.delete(event.code)){event.preventDefault();event.stopImmediatePropagation();}
  };
  private render():void {
    const blocked=this.doc.getElementById('auth-panel')?.classList.contains('menu-open')
      || Array.from(this.doc.querySelectorAll('.history-modal, .pvp-modal[aria-modal="true"], #busy-overlay, #reward-sting-layer'))
        .some(element=>!element.classList.contains('hidden')&&element.getAttribute('aria-hidden')!=='true');
    this.root?.classList.toggle('hidden',this.destroyed||!this.clear||this.dismissed||!this.inWorld()||this.sequenceActive()||Boolean(blocked));
    if(this.action){this.action.disabled=this.busy;this.action.textContent=this.busy?'Finding a room…':'Keep playing →';}
  }
}
