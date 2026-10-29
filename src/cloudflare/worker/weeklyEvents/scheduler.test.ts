import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTOMATIC_BUILD_PROMPTS } from '../../../buildPrompts/automaticPromptBank';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import { fixture } from '../activity/testDatabase';
import { deleteBuildPrompt, saveBuildPrompt, validatePromptInput } from '../buildPrompts/store';
import { refreshPlayableContentIndexForRoom } from '../playableContentIndex/store';
import { deleteWeeklyRoomRushPick, saveWeeklyRoomRushPick } from '../runs/weeklyRoomRushStore';
import { scheduleWeeklyEvents } from './scheduler';
import { rankAutomaticRushCandidates } from './rush';
const NOW='2026-10-29T12:00:00.000Z', CURRENT='2026-10-26T00:00:00.000Z', NEXT='2026-11-02T00:00:00.000Z';
let f:ReturnType<typeof fixture>;
beforeEach(async()=>{f=fixture();
  for(const [x,y] of [[0,0],[1,0],[-1,0],[0,1]]) {
    const room={...createDefaultRoomSnapshot(`${x},${y}`,{x,y}),version:1,status:'published' as const,publishedAt:'2026-09-01T00:00:00.000Z'};
    f.sqlite.prepare(`INSERT INTO rooms(id,x,y,draft_json,published_json,last_published_by_user_id,last_published_by_display_name)
      VALUES(?,?,?,?,?,'builder','Builder') ON CONFLICT(id) DO UPDATE SET published_json=excluded.published_json,
      last_published_by_user_id='builder',last_published_by_display_name='Builder'`).run(room.id,x,y,JSON.stringify(room),JSON.stringify(room));
    f.sqlite.prepare('INSERT OR IGNORE INTO room_versions(room_id,version,snapshot_json,created_at) VALUES(?,1,?,?)').run(room.id,JSON.stringify(room),'2026-09-01T00:00:00.000Z');
    await refreshPlayableContentIndexForRoom(f.env,room.id);
  }
});
afterEach(()=>f.sqlite.close());
const rows=(table:string)=>f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY starts_at`).all() as Array<Record<string,unknown>>;

describe('hourly weekly event prefill',()=>{
  it('fills this week and next Monday, then stays idempotent across repeated and concurrent ticks',async()=>{
    const results=await Promise.all([scheduleWeeklyEvents(f.env,NOW),scheduleWeeklyEvents(f.env,NOW)]);
    expect(results.reduce((sum,r)=>sum+r.prompts,0)).toBe(2);
    expect(results.reduce((sum,r)=>sum+r.rushes,0)).toBe(2);
    for(const table of ['build_prompts','room_rush_weeks']) {
      expect(rows(table)).toHaveLength(2);
      expect(rows(table).map(r=>r.starts_at)).toEqual([CURRENT,NEXT]);
      expect(rows(table).every(r=>r.picked_by==='automatic')).toBe(true);
    }
    expect(await scheduleWeeklyEvents(f.env,NOW)).toEqual({rushes:0,prompts:0});
    expect(rows('build_prompts')[0].automatic_prompt_key).not.toBe(rows('build_prompts')[1].automatic_prompt_key);
  });

  it('preserves manual picks and prompt edits, including a manual edit of an automatic slug',async()=>{
    await scheduleWeeklyEvents(f.env,NOW);
    await saveWeeklyRoomRushPick(f.env,{openingMonday:'2026-10-26',roomId:'0,0'},new Date(NOW));
    const prompt=rows('build_prompts')[0];
    await saveBuildPrompt(f.env,{slug:String(prompt.slug),title:'Owner choice',constraint:'A manually chosen theme.',startsAt:CURRENT},NOW);
    await scheduleWeeklyEvents(f.env,NOW);
    expect(rows('room_rush_weeks')[0]).toMatchObject({start_room_id:'0,0',picked_by:'admin'});
    expect(rows('build_prompts')[0]).toMatchObject({title:'Owner choice',picked_by:'admin',automatic_prompt_key:null});
  });

  it('keeps deliberate deletions empty and lets a later manual save override the suppression',async()=>{
    await scheduleWeeklyEvents(f.env,NOW);
    await deleteWeeklyRoomRushPick(f.env,'2026-10-26',new Date(NOW));
    await deleteBuildPrompt(f.env,String(rows('build_prompts')[0].slug));
    expect(await scheduleWeeklyEvents(f.env,NOW)).toEqual({rushes:0,prompts:0});
    expect(rows('room_rush_weeks').map(r=>r.starts_at)).toEqual([NEXT]);
    expect(rows('build_prompts').map(r=>r.starts_at)).toEqual([NEXT]);
    await saveWeeklyRoomRushPick(f.env,{openingMonday:'2026-10-26',roomId:'0,0'},new Date(NOW));
    await saveBuildPrompt(f.env,{slug:'owner-week',title:'Owner week',constraint:'A new manual theme.',startsAt:CURRENT},NOW);
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM weekly_event_suppressions').get()).toMatchObject({n:0});
  });

  it('repairs an unlocked automatic stale room but never rewrites a locked or manual week',async()=>{
    await scheduleWeeklyEvents(f.env,NOW);
    const selected=rows('room_rush_weeks')[0];
    const room=JSON.parse(String((f.sqlite.prepare('SELECT published_json FROM rooms WHERE id=?').get(String(selected.start_room_id)) as {published_json:string}).published_json));
    room.version=2;
    f.sqlite.prepare('UPDATE rooms SET published_json=? WHERE id=?').run(JSON.stringify(room),String(selected.start_room_id));
    f.sqlite.prepare('INSERT INTO room_versions(room_id,version,snapshot_json,created_at) VALUES(?,2,?,?)').run(String(selected.start_room_id),JSON.stringify(room),NOW);
    await refreshPlayableContentIndexForRoom(f.env,String(selected.start_room_id));
    expect((await scheduleWeeklyEvents(f.env,NOW)).rushes).toBe(1);
    const repaired=rows('room_rush_weeks')[0];
    if(repaired.start_room_id===selected.start_room_id)expect(repaired.room_version).toBe(2);
    f.sqlite.prepare('UPDATE room_rush_weeks SET locked_at=? WHERE starts_at=?').run(NOW,CURRENT);
    f.sqlite.prepare('UPDATE rooms SET published_json=NULL WHERE id=?').run(String(repaired.start_room_id));
    expect((await scheduleWeeklyEvents(f.env,NOW)).rushes).toBe(0);
    expect(rows('room_rush_weeks')[0]).toMatchObject({...repaired,locked_at:NOW});
  });

  it('rotates the 26 valid starter themes before repeating and preserves UTC weeks through DST/year changes',async()=>{
    expect(AUTOMATIC_BUILD_PROMPTS).toHaveLength(26);
    expect(new Set(AUTOMATIC_BUILD_PROMPTS.map(p=>p.key)).size).toBe(26);
    for(const p of AUTOMATIC_BUILD_PROMPTS)expect(()=>validatePromptInput({slug:p.key,title:p.title,constraint:p.constraint,startsAt:CURRENT})).not.toThrow();
    for(let i=0;i<27;i+=1)await scheduleWeeklyEvents(f.env,new Date(Date.parse(NOW)+i*7*86400000).toISOString());
    const prompts=rows('build_prompts');
    expect(new Set(prompts.slice(0,26).map(p=>p.automatic_prompt_key)).size).toBe(26);
    expect(prompts[26].automatic_prompt_key).toBe(prompts[0].automatic_prompt_key);
    expect(prompts.some(p=>p.starts_at==='2027-01-04T00:00:00.000Z')).toBe(true);
  });

  it('can schedule prompts without inventing a Rush pick when no public solo rooms qualify',async()=>{
    f.sqlite.exec('UPDATE rooms SET published_json=NULL; DELETE FROM playable_content_index;');
    expect(await scheduleWeeklyEvents(f.env,NOW)).toEqual({rushes:0,prompts:2});
    expect(rows('room_rush_weeks')).toHaveLength(0);
  });
});

describe('Rush selection policy',()=>{
  it('is deterministic, avoids recent repeats when possible and keeps older choices as a fallback',()=>{
    const base={room_version:1,x:0,y:0,title:'Room',quality:4,published_at:'2026-01-01',neighbors:3,staff:0,builder_last_picked:null};
    const candidates=[{...base,room_id:'0,0',last_picked:'2026-10-19'}, {...base,room_id:'1,0',last_picked:null}];
    const ranked=rankAutomaticRushCandidates(candidates,CURRENT);
    expect(ranked.map(r=>r.room_id)).toEqual(['1,0','0,0']);
    expect(rankAutomaticRushCandidates([...candidates].reverse(),CURRENT)).toEqual(ranked);
  });
});
