import { AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT, getAuthDebugState } from '../../auth/client';
import { GUEST_ACCOUNT_PROGRESS_EVENT } from '../../guestRooms/runClaimService';
import { GUEST_RUN_PROGRESS_CHANGED_EVENT } from '../../guestRooms/runService';
import { replaceClearedRooms } from '../../progression/clearedRooms';
import { POST_RUN_GUEST_CLAIM_REQUEST_EVENT, POST_RUN_RATING_REQUEST_EVENT, type PostRunRatingRequestDetail } from '../../progression/postRunRatingEvents';
import { getActiveWorldId, WORLD_CONTEXT_CHANGED_EVENT } from '../../worlds/clientContext';
import { APP_READY_EVENT } from '../appFeedback';

/** Progress loads after boot; map cells consume only the small synchronous personal cache. */
export function setupClearedRoomProgress():()=>void {
  const counter=document.getElementById('world-cleared-rooms');
  let alive=true,generation=0,identity:string|null|undefined,unsubscribe:(()=>void)|null=null;
  let service:import('../../progression/clearedRoomService').ClearedRoomService|null=null;
  let loading:Promise<import('../../progression/clearedRoomService').ClearedRoomService>|null=null;
  const render=()=>{
    if(!counter||!service)return;
    const state=service.snapshot();counter.textContent=`Cleared ${state.total}`;
    counter.title=state.status||(state.guest?'Map checks mark rooms cleared on this device. Rooms may have changed since your clear.'
      :'Map checks mark rooms cleared before, including the completed version’s Expanded cells. Rooms may have changed.');
    counter.classList.toggle('hidden',Boolean(getActiveWorldId())||(!state.total&&!state.status));
  };
  const sync=async(force=false,detail?:PostRunRatingRequestDetail)=>{
    const userId=getAuthDebugState().user?.id??null;
    if(identity!==userId){identity=userId;generation++;replaceClearedRooms([]);counter?.classList.add('hidden');}
    if(document.body.dataset.appReady!=='true'||getActiveWorldId()){render();return;}
    const expected=generation;
    try {
      loading??=import('../../progression/clearedRoomService').then(module=>module.getClearedRoomService());
      const loaded=await loading;if(!alive||expected!==generation)return;
      if(!service){service=loaded;unsubscribe=service.subscribe(render);}
      if(detail&&userId===null){await service.setUser(null);if(!alive||expected!==generation)return;service.rememberGuest(detail);}
      await service.setUser(userId,force);if(alive)render();
    }catch {if(alive&&counter){counter.title='Map progress could not load. Return to retry.';loading=null;}}
  };
  const onSync=()=>{void sync();};
  const onProgress=(event:Event)=>{void sync(true,event.type===POST_RUN_GUEST_CLAIM_REQUEST_EVENT?(event as CustomEvent<PostRunRatingRequestDetail>).detail:undefined);};
  const onStorage=()=>{if(identity===null)void sync(true);};
  const passive=[AUTH_STATE_CHANGED_EVENT,AUTH_SESSION_REFRESHED_EVENT,APP_READY_EVENT,WORLD_CONTEXT_CHANGED_EVENT,'focus'];
  const progress=[POST_RUN_RATING_REQUEST_EVENT,POST_RUN_GUEST_CLAIM_REQUEST_EVENT,GUEST_RUN_PROGRESS_CHANGED_EVENT,GUEST_ACCOUNT_PROGRESS_EVENT];
  for(const name of passive)window.addEventListener(name,onSync);
  for(const name of progress)window.addEventListener(name,onProgress);
  window.addEventListener('storage',onStorage);void sync();
  return ()=>{alive=false;generation++;unsubscribe?.();
    for(const name of passive)window.removeEventListener(name,onSync);
    for(const name of progress)window.removeEventListener(name,onProgress);
    window.removeEventListener('storage',onStorage);
  };
}
