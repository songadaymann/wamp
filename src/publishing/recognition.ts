import { getActiveWorldId, WORLD_CONTEXT_CHANGED_EVENT } from '../worlds/clientContext';
import { apiRequest } from '../api/request';
import { AUTH_STATE_CHANGED_EVENT } from '../auth/client';
import { APP_MODE_CHANGED_EVENT } from '../ui/appMode';
import { requestBusyConfirmation } from '../ui/appFeedback';
interface Recognition { targetKey:string;version:number;featured:boolean;roomOfTheDay:boolean }
export async function confirmPublishRecognition(options:{targetKey:string;version:number;userId:string|null;
  label?:string;current:()=>boolean;signal:AbortSignal;events?:EventTarget}):Promise<boolean> {
  if(options.signal.aborted||!options.current())return false;
  if(!options.userId||options.version<1||getActiveWorldId()||options.targetKey.startsWith('room:world-seed:'))return true;
  const events=options.events??window,abort=new AbortController();
  const cancel=()=>abort.abort();
  for(const name of [AUTH_STATE_CHANGED_EVENT,APP_MODE_CHANGED_EVENT,WORLD_CONTEXT_CHANGED_EVENT,'pagehide'])events.addEventListener(name,cancel);
  const signal=AbortSignal.any([options.signal,abort.signal]);
  try {
    let message='';
    try {
      const state=await apiRequest<Recognition>(`/api/me/publish-recognition?${new URLSearchParams({targetKey:options.targetKey,version:String(options.version)})}`,
        {cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
      if(!options.current()||signal.aborted)return false;
      if(state.targetKey!==options.targetKey||state.version!==options.version||typeof state.featured!=='boolean'||typeof state.roomOfTheDay!=='boolean')throw new Error('Invalid recognition response');
      if(state.featured)message='Featured reviews apply to this exact version. Republishing will remove this room from Featured.';
      if(state.roomOfTheDay)message+=`${message?' ':''}Republishing will make today’s Room of the Day unavailable.`;
      if(!message)return true;
      message+=' This also applies to title or music changes.';
    }catch {
      if(!options.current()||signal.aborted)return false;
      message='Could not check this version’s recognition. Republishing ends any existing Featured or Room of the Day selection, including after title or music changes.';
    }
    const accepted=await requestBusyConfirmation('Publish a new version?',options.label?`${options.label}: ${message}`:message,{confirmLabel:'Publish new version',signal});
    return accepted&&options.current()&&!signal.aborted;
  }finally {for(const name of [AUTH_STATE_CHANGED_EVENT,APP_MODE_CHANGED_EVENT,WORLD_CONTEXT_CHANGED_EVENT,'pagehide'])events.removeEventListener(name,cancel);}
}
