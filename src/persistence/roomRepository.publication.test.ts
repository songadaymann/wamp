import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../api/baseUrl', () => ({ getApiBaseUrl: () => 'https://api.example' }));
import { createRoomRepository } from './roomRepository';
import { createDefaultRoomRecord, createRoomSummaryFromRecord } from './roomModel';
import { setActiveWorldId } from '../worlds/clientContext';
afterEach(() => { setActiveWorldId(null); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('returns the saved draft and a typed approval submission instead of an edit conflict', async () => {
 vi.stubEnv('VITE_ROOM_STORAGE_BACKEND','remote');setActiveWorldId('world-one');
 const saved=createDefaultRoomRecord('129,0',{x:129,y:0});saved.draft.updatedAt='2026-10-29T20:00:00.000Z';
 const submission={id:'request-one',status:'pending',submittedDraftUpdatedAt:saved.draft.updatedAt};
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({error:'World requires publication approval'},{status:403}))
  .mockResolvedValueOnce(Response.json({summary:createRoomSummaryFromRecord(saved),draft:saved.draft,published:null}))
  .mockResolvedValueOnce(Response.json({request:submission}));vi.stubGlobal('fetch',fetch);
 const result=await createRoomRepository().publish(saved.draft,{baseUpdatedAt:'old'});
 expect(result.draft.updatedAt).toBe(saved.draft.updatedAt);expect(result.published).toBeNull();expect(result.worldPublicationSubmission).toEqual(submission);
 expect(fetch.mock.calls.map(([url,init])=>[new URL(url).pathname,init.method])).toEqual([
  ['/api/rooms/129%2C0/publish','POST'],['/api/rooms/129%2C0/draft','PUT'],['/api/worlds/world-one/publication-requests','POST']]);
});

it('keeps the committed draft available when the review submission fails',async()=>{
 vi.stubEnv('VITE_ROOM_STORAGE_BACKEND','remote');setActiveWorldId('world-one');
 const saved=createDefaultRoomRecord('129,0',{x:129,y:0});saved.draft.updatedAt='2026-10-29T20:00:00.000Z';
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({error:'World requires publication approval'},{status:403}))
  .mockResolvedValueOnce(Response.json({summary:createRoomSummaryFromRecord(saved),draft:saved.draft,published:null}))
  .mockRejectedValueOnce(new TypeError('offline')));
 await expect(createRoomRepository().publish(saved.draft,{baseUpdatedAt:'old'})).rejects.toMatchObject({savedDraft:{draft:{updatedAt:saved.draft.updatedAt}},message:expect.stringContaining('submission failed')});
});
