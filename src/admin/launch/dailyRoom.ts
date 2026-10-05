import { createAdminApiClient } from '../adminApiClient';
import type { DailyResponse } from '../../daily/model';
export function setupDailyAdmin(getAdminKey: () => string, doc: Document = document) {
  const client=createAdminApiClient(getAdminKey);
  const status=doc.getElementById('daily-admin-status'),form=doc.getElementById('daily-admin-form');
  const input=doc.getElementById('daily-admin-coordinates') as HTMLInputElement | null;
  const submit=doc.getElementById('daily-admin-choose') as HTMLButtonElement | null;
  let generation=0,busy=false;
  const render=(response:DailyResponse) => {
    if(status)status.textContent=response.pick ? `${response.date}: ${response.pick.title} by ${response.pick.builderDisplayName} · ${response.pick.coordinates.x},${response.pick.coordinates.y} · v${response.pick.version}` : `${response.date}: no eligible community level yet.`;
  };
  const refresh=async () => {
    const current=++generation;
    if(!getAdminKey()) { if(status)status.textContent='Use your admin key to view today’s pick.'; if(submit)submit.disabled=true; return; }
    try { const response=await client.request<DailyResponse>('/api/admin/daily');if(current===generation)render(response); }
    catch(error) { if(current===generation && status)status.textContent=error instanceof Error ? error.message : 'Daily pick could not load.'; }
    finally { if(current===generation && submit)submit.disabled=false; }
  };
  form?.addEventListener('submit',async event=>{
    event.preventDefault();if(busy || !getAdminKey() || !input)return;
    const match=/^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(input.value);
    if(!match) {if(status)status.textContent='Enter room coordinates as x,y.';return;}
    busy=true;if(submit)submit.disabled=true;const current=++generation;
    try {
      const response=await client.request<DailyResponse>('/api/admin/daily',{method:'PUT',body:JSON.stringify({roomId:`${Number(match[1])},${Number(match[2])}`})});
      if(current===generation)render(response);
    } catch(error) {if(current===generation && status)status.textContent=error instanceof Error ? error.message : 'Pick was not saved.';}
    finally {busy=false;if(current===generation && submit)submit.disabled=false;}
  });
  void refresh();
  return {refresh};
}
