import type Phaser from 'phaser';
import { AUTH_STATE_CHANGED_EVENT, getAuthDebugState } from '../../auth/client';
import { subscribeEditorUi } from '../../scenes/editor/uiEvents';
import { getActiveWorldId, WORLD_CONTEXT_CHANGED_EVENT } from '../../worlds/clientContext';
import type { WorldPublicationRequest } from '../../worlds/model';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import { WorldsRepository } from './repository';
interface Editor { getWorldPublicationState(): {roomId:string;draftUpdatedAt:string|null;dirty:boolean} }
export class EditorPublicationFeedback {
  private readonly repository=new WorldsRepository();
  private stop:(()=>void)|null=null;
  private identity='';private stamp:string|null=null;private generation=0;private pending=false;
  private result:WorldPublicationRequest|null=null;private error=false;private timer:ReturnType<typeof setTimeout>|null=null;
  constructor(private readonly game:Phaser.Game,private readonly doc:Document=document,private readonly win:Window=window){}
  init():void{
    this.stop=subscribeEditorUi(this.win,this.onChange);
    for(const event of [APP_MODE_CHANGED_EVENT,WORLD_CONTEXT_CHANGED_EVENT,AUTH_STATE_CHANGED_EVENT])this.win.addEventListener(event,this.onChange);
    this.win.addEventListener('focus',this.onFocus);this.doc.addEventListener('visibilitychange',this.onFocus);this.onChange();
  }
  destroy():void{this.stop?.();this.generation++;this.clearTimer();
    for(const event of [APP_MODE_CHANGED_EVENT,WORLD_CONTEXT_CHANGED_EVENT,AUTH_STATE_CHANGED_EVENT])this.win.removeEventListener(event,this.onChange);
    this.win.removeEventListener('focus',this.onFocus);this.doc.removeEventListener('visibilitychange',this.onFocus);this.render(null);
  }
  private target(){
    const auth=getAuthDebugState(),worldId=getActiveWorldId();
    if(this.doc.body.dataset.appMode!=='editor'||!worldId||!auth.authenticated||!auth.user||!this.game.scene.isActive('EditorScene'))return null;
    const state=(this.game.scene.getScene('EditorScene') as unknown as Editor).getWorldPublicationState();
    if(state.roomId.startsWith('world-seed:'))return null;
    return {...state,worldId,identity:`${worldId}:${auth.user.id}:${state.roomId}`};
  }
  private clearTimer(){if(this.timer)clearTimeout(this.timer);this.timer=null;}
  private readonly onFocus=()=>{if(this.doc.visibilityState!=='hidden')void this.refresh();else this.clearTimer();};
  private readonly onChange=()=>{
    const target=this.target();
    if(!target){this.generation++;this.identity='';this.result=null;this.pending=false;this.clearTimer();this.render(null);return;}
    const changed=target.identity!==this.identity;
    if(changed){this.generation++;this.result=null;this.pending=false;this.error=false;this.identity=target.identity;}
    const stampChanged=this.stamp!==target.draftUpdatedAt;this.stamp=target.draftUpdatedAt;
    this.render(target);
    if(changed||stampChanged)void this.refresh();
  };
  private async refresh(){
    const target=this.target();if(!target||this.pending||this.doc.visibilityState==='hidden')return;
    this.identity=target.identity;const generation=++this.generation;this.pending=true;this.error=false;this.clearTimer();
    try{const response=await this.repository.publications(target.worldId,{mine:true,roomId:target.roomId});
      if(generation!==this.generation||this.target()?.identity!==target.identity)return;
      this.result=response.requests[0]??null;
    }catch{if(generation===this.generation)this.error=true;}
    finally{if(generation===this.generation){this.pending=false;this.render(this.target());
      this.timer=setTimeout(()=>void this.refresh(),this.target()?.draftUpdatedAt!==target.draftUpdatedAt?0:30000);}}
  }
  private render(target:ReturnType<EditorPublicationFeedback['target']>){
    let text='';const request=this.result;
    if(target&&request){
      const changed=request.status==='pending'&&(target.dirty||target.draftUpdatedAt!==request.submittedDraftUpdatedAt);
      text=changed||request.status==='stale'?'Out of date: submit this draft again when ready.'
        :request.status==='pending'?'Waiting for World review. Editing this draft means you must submit it again.'
        :request.status==='approved'?'World review: Approved.'
        :`Needs changes${request.rejectionReason?`: ${request.rejectionReason}`:''}. Edit and submit again.`;
    }
    if(target&&this.error)text='World review status unavailable. Open My Worlds to check your requests.';
    for(const node of this.doc.querySelectorAll<HTMLElement>('[data-world-publication-status]')){
      if(node.textContent!==text)node.textContent=text;node.classList.toggle('hidden',!text);
    }
  }
}
