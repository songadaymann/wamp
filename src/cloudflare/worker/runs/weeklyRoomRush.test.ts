import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { HttpError } from '../core/http';
import type { RoomRushRunStartResponse, RoomRushRunSubmissionRequestBody } from '../../../runs/model';
const state = vi.hoisted(() => ({ user: 'p1' as string | null, memberships: [] as Array<{ roomId: string; expandedRoomId: string }> }));
vi.mock('../auth/request', async actual => ({ ...await actual<object>(),
  loadOptionalRequestAuth: async () => state.user ? { user: { id: state.user, displayName: state.user }, source: 'session' } : null,
  requireAuthenticatedRequestAuth: async () => {
    if (!state.user) throw new HttpError(401, 'Sign in');
    return { user: { id: state.user, displayName: state.user }, source: 'session' };
  },
}));
vi.mock('../expandedRooms/store', async actual => ({ ...await actual<object>(), loadPublishedExpandedRoomMembershipsInBounds: async () => state.memberships }));
import { buildRoomRushLeaderboardResponse, handleRoomRushLeaderboards, handleRoomRushRunStart, handleRoomRushRunSubmit, loadWeeklyRoomRushResponse } from './roomRushLeaderboards';
import { handleAdminWeeklyRoomRush, handleWeeklyRoomRush } from './weeklyRoomRushRoutes';
import { deleteWeeklyRoomRushPick, loadWeeklyRoomRushPick, saveWeeklyRoomRushPick, weeklyRoomRushPeriod } from './weeklyRoomRushStore';
import worker from '../../worker';

const NOW = '2026-10-08T23:00:00.000Z', WEEK = 'UTC-2026-41';
let f: ReturnType<typeof fixture>;
const headers = { Origin: 'https://wamp.land', 'Content-Type': 'application/json' };
const request = (path: string, body?: unknown, extra: Record<string, string> = {}) => new Request(`https://api.wamp.land${path}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body),
});
beforeEach(() => { f = fixture(); f.env.ADMIN_API_KEY = 'test-weekly-admin'; state.user = 'p1'; state.memberships = []; vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { f.sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); });
const pick = () => saveWeeklyRoomRushPick(f.env, { openingMonday: '2026-10-05', roomId: '0,0' });
async function start(extra: object = {}): Promise<RoomRushRunStartResponse> {
  return await (await handleRoomRushRunStart(request('/api/room-rush/runs/start', {
    difficulty: 'hard', startRule: 'weekly', eventWeek: WEEK, startRoomVersion: 1, startCoordinates: { x: 0, y: 0 }, ...extra,
  }), f.env)).json() as RoomRushRunStartResponse;
}
function submission(start: RoomRushRunStartResponse, extra: object = {}): RoomRushRunSubmissionRequestBody {
  return { startId: start.startId, clientRunId: start.clientRunId, difficulty: start.difficulty, startRule: start.startRule,
    result: 'completed', elapsedMs: 1000, deaths: 0, visitedRoomIds: ['0,0'],
    route: [{ routeIndex: 0, roomId: '0,0', coordinates: { x: 0, y: 0 }, uniqueVisitIndex: 1 }],
    startCoordinates: { x: 0, y: 0 }, finishCoordinates: { x: 0, y: 0 }, ...extra };
}
const finish = (body: RoomRushRunSubmissionRequestBody) => handleRoomRushRunSubmit(request('/api/room-rush/runs', body), f.env);
function ranked(id: string, user: string, week: string | null, rooms: number, elapsed = 10000) {
  f.sqlite.prepare(`INSERT INTO room_rush_runs (attempt_id,client_run_id,user_id,user_display_name,difficulty,start_rule,result,
    unique_rooms,elapsed_ms,deaths,start_room_id,start_x,start_y,finish_room_id,finish_x,finish_y,route_json,finished_at,created_at,event_week)
    VALUES (?,?,?,?,?,?, 'completed',?,?,0,'0,0',0,0,'0,0',0,0,'[]',?,?,?)`)
    .run(id,id,user,user,'hard',week ? 'weekly' : 'selected',rooms,elapsed,NOW,NOW,week);
}

describe('manual weekly Room Rush configuration', () => {
  it('rejects a co-op weekly pick and pauses new starts when the picked room republishes with one', async () => {
    await pick();
    const snapshot = { ...f.record.published!, placedObjects: [{ id: 'floor_trigger', instanceId: 'coop', x: 88, y: 296, coopPlate: true }] };
    f.sqlite.prepare('UPDATE rooms SET published_json=? WHERE id=\'0,0\'').run(JSON.stringify(snapshot));
    expect(await loadWeeklyRoomRushResponse(f.env)).toMatchObject({ pick: { available: false } });
    await expect(start()).rejects.toMatchObject({ status: 409 });
    await expect(saveWeeklyRoomRushPick(f.env, { openingMonday: '2026-10-12', roomId: '0,0' })).rejects.toMatchObject({ status: 400 });
  });

  it('dispatches the real admin endpoint before the general admin handler and exposes the fresh public event', async () => {
    const url=new URL('https://api.wamp.land/api/admin/room-rush/weekly');
    const response=await worker.fetch(new Request(url,{method:'PUT',headers:{...headers,'x-admin-key':'test-weekly-admin'},body:JSON.stringify({openingMonday:'2026-10-05',roomId:'0,0'})}),f.env);
    expect(response.status).toBe(200);const admin=await response.json() as {weeks:Array<{pick:unknown}>};
    expect(admin.weeks[0]).toMatchObject({pick:{roomId:'0,0'}});
    const publicResponse=await worker.fetch(request('/api/room-rush/weekly'),f.env);
    expect(publicResponse.status).toBe(200);expect(await publicResponse.json()).toMatchObject({pick:{available:true}});
  });
  it('starts inactive, uses no-store reads and requires admin key/trusted origin for changing a pick', async () => {
    const response = await handleWeeklyRoomRush(request('/api/room-rush/weekly'), f.env);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ pick: null, period: { weekKey: WEEK }, timeLimitMs: 300000, previousWinners: [] });
    await expect(start()).rejects.toMatchObject({ status: 409 });
    const url = new URL('https://api.wamp.land/api/admin/room-rush/weekly');
    await expect(handleAdminWeeklyRoomRush(new Request(url), url, f.env)).rejects.toMatchObject({ status: 403 });
    await expect(handleAdminWeeklyRoomRush(new Request(url, { method: 'PUT', headers: { 'x-admin-key': 'test-weekly-admin', Origin: 'https://evil.example' }, body: '{}' }), url, f.env)).rejects.toMatchObject({ status: 403 });
    const saved = await handleAdminWeeklyRoomRush(new Request(url, { method: 'PUT', headers: { ...headers, 'x-admin-key': 'test-weekly-admin' }, body: JSON.stringify({ openingMonday: '2026-10-05', roomId: '0,0' }) }), url, f.env);
    expect((await saved.json() as { weeks: unknown[] }).weeks).toHaveLength(5);
  });
  it('shares Monday UTC/ISO week identity across Sunday, DST and the year boundary', () => {
    for (const [at, week, monday] of [
      ['2026-10-04T23:59:59.999Z','UTC-2026-40','2026-09-28'],
      ['2026-10-05T00:00:00.000Z',WEEK,'2026-10-05'],
      ['2026-11-01T06:30:00.000Z','UTC-2026-44','2026-10-26'],
      ['2027-01-01T00:00:00.000Z','UTC-2026-53','2026-12-28'],
    ]) expect(weeklyRoomRushPeriod(new Date(at))).toMatchObject({ weekKey: week, startsAt: `${monday}T00:00:00.000Z` });
  });
  it('bounds scheduling, rejects unpublished/expanded rooms and leaves future picks inactive today', async () => {
    for (const date of ['2026-10-06','2026-09-28','2026-11-09','2026-02-30']) await expect(saveWeeklyRoomRushPick(f.env,{ openingMonday: date, roomId: '0,0' })).rejects.toMatchObject({ status: 400 });
    await expect(saveWeeklyRoomRushPick(f.env,{ openingMonday: '2026-10-05', roomId: '1,0' })).rejects.toMatchObject({ status: 400 });
    state.memberships = [{ roomId: '0,0', expandedRoomId: 'course:fixture' }]; await expect(pick()).rejects.toMatchObject({ status: 400 }); state.memberships = [];
    await saveWeeklyRoomRushPick(f.env,{ openingMonday: '2026-10-12', roomId: '0,0' });
    expect((await loadWeeklyRoomRushPick(f.env)).pick).toBeNull();
    await deleteWeeklyRoomRushPick(f.env,'2026-10-12');expect(f.sqlite.prepare('SELECT COUNT(*) n FROM room_rush_weeks').get()).toMatchObject({ n: 0 });
  });
  it('locks the exact picked version atomically at a ranked start; changed/missing rooms pause starts without losing standings', async () => {
    await pick(); await start();
    await expect(pick()).rejects.toMatchObject({ status: 409 });await expect(deleteWeeklyRoomRushPick(f.env,'2026-10-05')).rejects.toMatchObject({ status: 409 });
    const updated = { ...f.record.published!, version: 2 }; f.sqlite.prepare('UPDATE rooms SET published_json=?').run(JSON.stringify(updated));
    expect((await loadWeeklyRoomRushPick(f.env)).pick).toMatchObject({ roomVersion: 1, available: false });
    await expect(start()).rejects.toMatchObject({ status: 409 });
    ranked('prior','p1',WEEK,3);expect((await buildRoomRushLeaderboardResponse(f.env,'hard','weekly',25,null,WEEK)).entries).toHaveLength(1);
    f.sqlite.prepare('UPDATE rooms SET published_json=NULL').run();expect((await loadWeeklyRoomRushPick(f.env)).pick?.available).toBe(false);
  });
});

describe('weekly ranked starts, timing and idempotent results', () => {
  it('does not issue a start or lock an obsolete pick when publication changes between validation and its atomic write', async () => {
    await pick();
    const original=f.env.DB.batch.bind(f.env.DB);
    vi.spyOn(f.env.DB,'batch').mockImplementationOnce(async queries=>{
      f.sqlite.prepare('UPDATE rooms SET published_json=?').run(JSON.stringify({...f.record.published!,version:2}));
      return original(queries);
    });
    await expect(start()).rejects.toMatchObject({status:409});
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM room_rush_run_starts').get()).toMatchObject({n:0});
    expect(f.sqlite.prepare('SELECT locked_at FROM room_rush_weeks').get()).toMatchObject({locked_at:null});
  });
  it('requires the picked week/version/room and Hard mode and keeps ordinary starts at two hours', async () => {
    await pick();for (const extra of [{ difficulty: 'easy' },{ eventWeek: 'UTC-2026-40' },{ startRoomVersion: 2 }]) await expect(start(extra)).rejects.toMatchObject({ status: 409 });
    const weekly = await start();expect(Date.parse(weekly.expiresAt)-Date.parse(weekly.startedAt)).toBe(300000);expect(weekly.eventWeek).toBe(WEEK);
    const regular = await start({ startRule: 'selected', eventWeek: null });expect(Date.parse(regular.expiresAt)-Date.parse(regular.startedAt)).toBe(7200000);expect(regular.eventWeek).toBeUndefined();
    state.user = null;await expect(start()).rejects.toMatchObject({ status: 401 });
  });
  it('stores one atomic result through parallel uncertain-reply retries and never lets another account reuse its start', async () => {
    await pick();const s=await start();vi.advanceTimersByTime(1000);
    const responses = await Promise.all([finish(submission(s)),finish(submission(s))]);
    const replies = await Promise.all(responses.map(response=>response.json()));expect(replies.map(reply=>reply.saved).sort()).toEqual([false,true]);
    expect(new Set(replies.map(reply=>reply.attemptId)).size).toBe(1);
    expect(f.sqlite.prepare('SELECT COUNT(*) n,event_week FROM room_rush_runs').get()).toMatchObject({ n: 1,event_week: WEEK });
    state.user='p2';await expect(finish(submission(s))).rejects.toMatchObject({ status: 400 });
  });
  it('rejects deaths inconsistent with Hard results, forged elapsed time and nonadjacent/unpublished routes', async () => {
    await pick();const s=await start();
    for (const body of [submission(s,{ deaths: 1 }),submission(s,{ result: 'failed',deaths: 0 }),submission(s,{ elapsedMs: 300001 })]) await expect(finish(body)).rejects.toMatchObject({ status: 400 });
    const badRoute=[{ routeIndex: 0,roomId: '0,0',coordinates:{x:0,y:0},uniqueVisitIndex:1},{routeIndex:1,roomId:'2,0',coordinates:{x:2,y:0},uniqueVisitIndex:2}];
    await expect(finish(submission(s,{ route: badRoute,finishCoordinates:{x:2,y:0} }))).rejects.toMatchObject({ status: 400 });
    badRoute[1]={...badRoute[1],roomId:'1,0',coordinates:{x:1,y:0}};await expect(finish(submission(s,{route:badRoute,finishCoordinates:{x:1,y:0}}))).rejects.toMatchObject({ status: 400 });
  });
  it('enforces the five-minute wall window with only a ten-second delivery grace and clamps the elapsed tie-break', async () => {
    await pick();const s=await start();vi.advanceTimersByTime(300001);
    const response=await finish(submission(s,{elapsedMs:300000}));expect(response.status).toBe(201);
    expect(f.sqlite.prepare('SELECT elapsed_ms FROM room_rush_runs').get()).toMatchObject({elapsed_ms:300000});
    const another=await start();vi.advanceTimersByTime(310000);await expect(finish(submission(another,{elapsedMs:300000}))).rejects.toMatchObject({ status:400 });
  });
  it('stops offering starts in the last five minutes and rolls to a separately chosen next week', async () => {
    await pick();await saveWeeklyRoomRushPick(f.env,{openingMonday:'2026-10-12',roomId:'0,0'});
    vi.setSystemTime(new Date('2026-10-11T23:55:01Z'));expect((await loadWeeklyRoomRushPick(f.env)).pick?.available).toBe(false);await expect(start()).rejects.toMatchObject({status:409});
    vi.setSystemTime(new Date('2026-10-12T00:00:00Z'));expect((await loadWeeklyRoomRushPick(f.env)).period.weekKey).toBe('UTC-2026-42');
    await expect(start()).rejects.toMatchObject({status:409});expect((await start({eventWeek:'UTC-2026-42'})).eventWeek).toBe('UTC-2026-42');
  });
  it('bounds restart bursts and preserves a finalization retry after the window closes', async () => {
    await pick();const s=await start();for(let n=1;n<12;n++) await start();await expect(start()).rejects.toMatchObject({status:429});
    vi.advanceTimersByTime(1000);await finish(submission(s));vi.advanceTimersByTime(999999);
    expect(await (await finish(submission(s))).json()).toMatchObject({ saved:false });
  });
});

describe('separate weekly rankings and previous winners', () => {
  it('takes one best run per player, isolates ordinary/old weeks and retains an off-list viewer rank', async () => {
    ranked('p1-slow','p1',WEEK,3,10000);ranked('p1-best','p1',WEEK,4,9000);ranked('p2','p2',WEEK,4,5000);ranked('p3','p3',WEEK,1);
    ranked('ordinary','p1',null,999);ranked('old','p3','UTC-2026-40',999);
    const board=await buildRoomRushLeaderboardResponse(f.env,'hard','weekly',1,'p1',WEEK);
    expect(board.entries.map(entry=>entry.attemptId)).toEqual(['p2']);expect(board.viewerBest).toMatchObject({rank:2,attemptId:'p1-best'});expect(board.eventWeek).toBe(WEEK);
    expect((await buildRoomRushLeaderboardResponse(f.env,'hard','selected',25,null)).entries[0]?.attemptId).toBe('ordinary');
    const response=await loadWeeklyRoomRushResponse(f.env);expect(response.previousWinners.map(entry=>entry.attemptId)).toEqual(['old']);
    const url=new URL('https://api.wamp.land/api/leaderboards/room-rush?mode=hard:weekly');const publicResponse=await handleRoomRushLeaderboards(request(url.pathname+url.search),url,f.env);
    expect(publicResponse.headers.get('Cache-Control')).toBe('private, no-store');expect(await publicResponse.json()).toMatchObject({weekly:{period:{weekKey:WEEK}},modes:[{eventWeek:WEEK}]});
  });
});
