import { afterEach, expect, it, vi } from 'vitest';
import { installFakeDom } from '../testing/fakeDom';
import type { WorldDetail, WorldPublicationRequest } from '../../worlds/model';
import { WorldsController } from './controller';
vi.mock('../setup/sceneBridge', () => ({ getActiveOverworldScene: () => null }));
vi.mock('../../api/baseUrl', () => ({ getApiBaseUrl: () => 'https://api.example' }));
afterEach(() => vi.unstubAllGlobals());
const world={id:'world-one'} as WorldDetail;
const request=(id:string,status:WorldPublicationRequest['status'],reason:string|null=null):WorldPublicationRequest=>({id,worldId:world.id,roomId:'129,0',roomCoordinates:{x:129,y:0},roomTitle:'Review room',submittedByUserId:'builder',submittedByDisplayName:'Builder',submittedDraftUpdatedAt:'now',status,rejectionReason:reason,submittedAt:'2026-10-29',resolvedAt:null});
type Feedback={publicationsSection(world:WorldDetail,requests:WorldPublicationRequest[]):HTMLElement;submissionsSection(world:WorldDetail,requests:WorldPublicationRequest[]):HTMLElement};
it('sends the reviewer’s entered reason with Reject',async()=>{
 const dom=installFakeDom(),controller=new WorldsController({} as never),resolvePublication=vi.fn(async()=>({}));
 Object.assign(controller,{repository:{resolvePublication},runAndRefresh:async(action:()=>Promise<unknown>)=>action()});
 const section=(controller as unknown as Feedback).publicationsSection(world,[request('pending','pending')]);dom.doc.body.append(section as never);
 const textarea=section.querySelector('textarea')!;textarea.value='Please add a safe exit';expect(textarea.maxLength).toBe(500);
 [...section.querySelectorAll('button')].find(button=>button.textContent==='Reject')!.click();await dom.settle();
 expect(resolvePublication).toHaveBeenCalledWith(world.id,'pending','reject','Please add a safe exit');
});
it('shows the latest request for each room, including the reason and resubmission state',()=>{
 installFakeDom();const controller=new WorldsController({} as never);
 const section=(controller as unknown as Feedback).submissionsSection(world,[request('new','rejected','Add an exit'),request('old','pending'),{...request('stale','stale'),roomId:'130,0',roomTitle:'Changed room'}]);
 const texts=[...section.querySelectorAll('p')].map(el=>el.textContent);
 expect(texts).toEqual(['Needs changes: Add an exit','Out of date: open the room and submit again']);
 expect(section.querySelectorAll('button')).toHaveLength(2);
});
