import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot } from '../../../courses/model';
import { RankedRunTraceRecorder, type RankedRunTraceFrameInput } from '../../../scenes/overworld/rankedRunTraceRecorder';
import worker from '../../worker';
import type { D1Database, D1PreparedStatement } from '../core/types';
import { HttpError } from '../core/http';
import { publishRoomAs, workerApi, type WorkerApi } from '../core/workerApi.testSupport';
import { awardRunDailyClear } from '../progression/store';
import { loadOrBackfillUserProgress } from '../progression/progressRows';
import { loadRoomRankingRecord } from '../rooms/rankingRecord';
import { awaitInOrder, readAhead } from './finishReplay';

// A real timer, whatever a test fakes.
const later = setTimeout;
const ROUND_WINDOW_MS = 25;

/**
 * Counts the database waits a request makes in a row before it replies (F333). Each D1 call is held
 * until a short window after the first one of a round queued, then every queued call runs as one
 * round. Calls made together (Promise.all, one batch) share a round; a call that needs an earlier
 * one's answer can only queue after that round, so it lands in a later one whatever the window. The
 * window only has to outlast the non-database steps between calls made together (hashing a session
 * token), with room to spare on a busy test machine.
 */
function countRounds(db: D1Database) {
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  let round = 0;
  let queued: Array<() => void> = [];
  const calls: Array<{ round: number; sql: string }> = [];
  const short = (sql: string) => sql.replace(/\s+/g, ' ').trim().slice(0, 70);
  const wait = (sql: string) => new Promise<void>((resolve) => {
    if (queued.length === 0) {
      later(() => {
        round += 1;
        const ready = queued; queued = [];
        for (const run of ready) run();
      }, ROUND_WINDOW_MS);
    }
    queued.push(() => { calls.push({ round, sql }); resolve(); });
  });
  db.prepare = (sql: string) => {
    const statement = prepare(sql);
    const first = statement.first.bind(statement);
    const all = statement.all.bind(statement);
    statement.first = async <T>() => { await wait(short(sql)); return first<T>(); };
    statement.all = async <T>() => { await wait(short(sql)); return all<T>(); };
    return statement;
  };
  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    await wait(`batch[${statements.map((statement) => short((statement as unknown as { sql: string }).sql).slice(0, 40)).join(' | ')}]`);
    return batch<T>(statements);
  };
  return { calls, get round() { return round; } };
}

/** Calls the API and reports the round its reply resolved in, and every D1 call by round. */
async function measure(api: WorkerApi, path: string, options: Parameters<WorkerApi['call']>[1]) {
  const counter = countRounds(api.env.DB);
  const fetch = worker.fetch.bind(worker);
  let rounds = -1;
  const spy = vi.spyOn(worker, 'fetch').mockImplementation(async (...args) => {
    const response = await fetch(...args);
    rounds = counter.round;
    return response;
  });
  const response = await api.call(path, options);
  spy.mockRestore();
  const listing = counter.calls.map((call) => `${call.round > rounds ? 'after reply ' : ''}${call.round}: ${call.sql}`).join('\n');
  return { response, rounds, listing: `${path} replied after round ${rounds}\n${listing}` };
}

const FRAME_MS = 1000 / 60;
const frame = (x: number): RankedRunTraceFrameInput => ({
  roomCoordinates: { x: 1, y: 0 }, x, y: 256, vx: 0, vy: 0, grounded: true,
  horizontalInput: 0, verticalInput: 0, jumpPressed: false,
});
/** Walks room 1,0 from its spawn to its exit, as the client records it. */
function walkToExit(kind: 'room' | 'course', binding: { verificationNonce: string; snapshotHash: string }) {
  const recorder = new RankedRunTraceRecorder();
  recorder.start(kind, { ...binding, verificationSchemaVersion: 1 }, frame(320));
  for (let index = 1; index <= 36; index += 1) recorder.recordFrame(FRAME_MS, frame(320 + (280 * index) / 36));
  recorder.recordGoalEvent({ type: 'reach_exit', actor: 'player', roomId: '1,0', roomX: 1, roomY: 0, x: 600, y: 256, instanceId: null, checkpointIndex: null });
  const elapsedMs = 36 * FRAME_MS;
  return { result: 'completed', elapsedMs: Math.round(elapsedMs), deaths: 0, collectiblesCollected: 0, enemyCollectiblesCollected: 0,
    enemiesDefeated: 0, checkpointsReached: 0, verificationTrace: recorder.buildTrace(elapsedMs)! };
}

const roomGoal = { type: 'reach_exit' as const, exit: { x: 600, y: 256 }, timeLimitMs: null };
const GUEST = { 'X-Guest-User-Id': 'guest-rounds', 'X-Guest-Recovery-Token': 'r'.repeat(40) };
let api: WorkerApi;
let player: string;
let builder: string;
let clock = 0;
const advance = (ms: number) => { clock += ms; vi.setSystemTime(clock); };
const count = (sql: string, ...values: string[]) => Number((api.sqlite.prepare(sql).get(...values) as { n: number }).n);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = Date.parse('2026-10-04T18:00:00.000Z');
  vi.setSystemTime(clock);
  api = workerApi();
  builder = await api.signIn('builder');
  player = await api.signIn('p1');
  await publishRoomAs(api, builder, 1, 0, { spawnPoint: { x: 320, y: 256 }, goal: roomGoal });
  // The steady state: a player who has played before (a progress row) and a room whose version facts
  // are stored. A player's first finish ever also backfills that row, and a room's first ranked read
  // stores its facts, which add a few waits once.
  await loadOrBackfillUserProgress(api.env, 'p1');
  await loadRoomRankingRecord(api.env, '1,0', { x: 1, y: 0 });
});
afterEach(() => { api.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function startRoomRun() {
  const start = await api.call('/api/runs/start', { session: player, body: { roomId: '1,0', roomCoordinates: { x: 1, y: 0 }, roomVersion: 1, goal: roomGoal } });
  expect(start.status).toBe(200);
  const body = walkToExit('room', start.body);
  advance(body.elapsedMs + 50);
  return { attemptId: start.body.attemptId as string, body };
}

async function startExpandedRoomRun() {
  await api.setBuilderCaps('builder', { expandedRoomCellLimit: 4 });
  const cell = (x: number) => ({ roomId: `${x},0`, coordinates: { x, y: 0 }, roomVersion: 1, roomTitle: null });
  const goal = { type: 'reach_exit', exit: { roomId: '1,0', x: 600, y: 256 }, timeLimitMs: null };
  const path = `/api/expanded-rooms/${encodeURIComponent('course:er')}`;
  expect((await api.call('/api/expanded-rooms', { session: builder, body: { ...createDefaultCourseSnapshot('er'),
    roomRefs: [cell(0), cell(1)], title: 'Two Rooms', startPoint: { roomId: '1,0', x: 320, y: 256 }, goal } })).status).toBe(200);
  expect((await api.call(`${path}/publish`, { method: 'POST', session: builder })).status).toBe(200);
  const start = await api.call(`${path}/runs/start`, { session: player, body: { expandedRoomVersion: 1, goal } });
  expect(start.status).toBe(200);
  const { enemyCollectiblesCollected: _, ...body } = walkToExit('course', start.body);
  advance(body.elapsedMs + 50);
  return { attemptId: start.body.attemptId as string, body };
}

async function startRoomRush() {
  const start = await api.call('/api/room-rush/runs/start', { session: player,
    body: { difficulty: 'easy', startRule: 'selected', startCoordinates: { x: 0, y: 0 }, startRoomVersion: 1 } });
  expect(start.status).toBe(201);
  advance(5_000);
  return { startId: start.body.startId, clientRunId: start.body.clientRunId, difficulty: 'easy', startRule: 'selected',
    result: 'completed', elapsedMs: 4_000, deaths: 0, visitedRoomIds: ['0,0', '1,0'],
    route: [{ routeIndex: 0, roomId: '0,0', coordinates: { x: 0, y: 0 }, uniqueVisitIndex: 1 },
      { routeIndex: 1, roomId: '1,0', coordinates: { x: 1, y: 0 }, uniqueVisitIndex: 2 }],
    startCoordinates: { x: 0, y: 0 }, finishCoordinates: { x: 1, y: 0 } };
}

async function startGuestRun() {
  const start = await api.call('/api/guest-runs/start', { headers: GUEST,
    body: { clientRunId: '00000000-0000-4000-8000-000000000333', contentType: 'room', contentId: '1,0', version: 1 } });
  expect(start.status).toBe(200);
  const body = walkToExit('room', start.body);
  advance(body.elapsedMs + 50);
  return { attemptId: start.body.attemptId as string, body };
}

// These pin how many database waits in a row each finish makes before it answers. Before F333 they
// were room 17 (resend 4), Expanded Room 23, Room Rush 9 and guest 5. A change that adds a wait fails
// here, and the failure lists every D1 call by round so the new one is easy to find. If it's needed,
// raise the number and say why in the commit; when a change removes one, lower it.
describe('database waits before a finish answers (F333)', () => {
  it('room: a verified first clear', async () => {
    const { attemptId, body } = await startRoomRun();
    const { response, rounds, listing } = await measure(api, `/api/runs/${attemptId}/finish`, { session: player, body });
    expect(response.status).toBe(204);
    expect(rounds, listing).toBe(7);
    expect(api.sqlite.prepare('SELECT verification_status AS status FROM room_runs WHERE attempt_id = ?').get(attemptId)).toEqual({ status: 'passed' });
    expect(count("SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'p1' AND event_type = 'room_clear_first'")).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM run_verification_audit WHERE attempt_id = ?', attemptId)).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM run_ghosts WHERE attempt_id = ?', attemptId)).toBe(1);
  });

  it('room: a resend of a counted clear', async () => {
    const { attemptId, body } = await startRoomRun();
    expect((await api.call(`/api/runs/${attemptId}/finish`, { session: player, body })).status).toBe(204);
    const { response, rounds, listing } = await measure(api, `/api/runs/${attemptId}/finish`, { session: player, body });
    expect(response.status).toBe(204);
    expect(rounds, listing).toBe(3);
  });

  it('Expanded Room: a verified first clear', async () => {
    const { attemptId, body } = await startExpandedRoomRun();
    const { response, rounds, listing } = await measure(api, `/api/expanded-room-runs/${attemptId}/finish`, { session: player, body });
    expect(response.status).toBe(204);
    expect(rounds, listing).toBe(11);
    expect(api.sqlite.prepare('SELECT verification_status AS status FROM expanded_room_runs WHERE attempt_id = ?').get(attemptId)).toEqual({ status: 'passed' });
    expect(count("SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'p1' AND event_type = 'course_clear_first'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM run_settlements WHERE attempt_kind = 'expanded_room' AND attempt_id = ?", attemptId)).toBe(1);
  });

  it('Room Rush: a saved run', async () => {
    const submission = await startRoomRush();
    const { response, rounds, listing } = await measure(api, '/api/room-rush/runs', { session: player, body: submission });
    expect(response).toMatchObject({ status: 201, body: { saved: true } });
    expect(rounds, listing).toBe(5);
  });

  it('guest: a verified clear', async () => {
    const { attemptId, body } = await startGuestRun();
    const { response, rounds, listing } = await measure(api, `/api/guest-runs/${attemptId}/finish`, { headers: GUEST, body });
    expect(response).toMatchObject({ status: 200, body: { saved: true, verificationStatus: 'passed' } });
    expect(rounds, listing).toBe(4);
  });
});

describe('finish steps that now share a wait (F333)', () => {
  it('awaitInOrder waits for every step, then throws the first failure in argument order', async () => {
    const finished: string[] = [];
    const step = (name: string, ms: number, fail = false) => new Promise<string>((resolve, reject) => later(() => {
      finished.push(name);
      if (fail) reject(new Error(name)); else resolve(name);
    }, ms));
    await expect(awaitInOrder([step('a', 1), Promise.resolve(2), null])).resolves.toEqual(['a', 2, null]);
    finished.length = 0;
    // The later step fails first, the earlier one fails after: the earlier one is thrown, once both are done.
    await expect(awaitInOrder([step('slow', 8, true), step('fast', 1, true), step('ok', 4)])).rejects.toThrow('slow');
    expect(finished).toEqual(['fast', 'ok', 'slow']);
  });

  it('readAhead leaves a failed read for whoever awaits it, without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const read = readAhead(Promise.reject(new Error('D1 unavailable')));
    await new Promise((resolve) => later(resolve, 5));
    await expect(read).rejects.toThrow('D1 unavailable');
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it.each(['/api/runs/missing/finish', '/api/expanded-room-runs/missing/finish'])(
    '%s rejects a signed-out finish without reading the database', async (path) => {
      const prepare = vi.spyOn(api.env.DB, 'prepare');
      const headersCases: Array<Record<string, string>> = [{}, { Authorization: 'Basic invalid' }, { Cookie: 'ep_session=' }];
      for (const headers of headersCases) {
        expect((await api.call(path, { body: {}, headers })).status).toBe(401);
      }
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it.each(['room', 'expanded room'] as const)(
    '%s preserves the audit error when the parallel settlement read also fails', async (kind) => {
      const { attemptId, body } = await (kind === 'room' ? startRoomRun() : startExpandedRoomRun());
      const table = kind === 'room' ? 'room_runs' : 'expanded_room_runs';
      const prefix = kind === 'room' ? '/api/runs/' : '/api/expanded-room-runs/';
      const prepare = api.env.DB.prepare.bind(api.env.DB);
      const batch = api.env.DB.batch.bind(api.env.DB);
      let finalized = false;
      vi.spyOn(console, 'error').mockImplementation(() => {});
      api.env.DB.prepare = (sql) => {
        const statement = prepare(sql);
        if (finalized && sql.includes('FROM ' + table)) {
          statement.first = async () => { throw new HttpError(404, 'Settlement reload failed.'); };
        }
        return statement;
      };
      api.env.DB.batch = async <T>(statements: D1PreparedStatement[]) => {
        const sql = statements.map((statement) => (statement as unknown as { sql: string }).sql);
        if (sql.some((query) => query.includes('INTO run_verification_audit'))) {
          throw new HttpError(503, 'Verification audit unavailable.');
        }
        const results = await batch<T>(statements);
        if (sql.some((query) => query.includes('UPDATE ' + table))) finalized = true;
        return results;
      };
      expect(await api.call(prefix + attemptId + '/finish', { session: player, body }))
        .toMatchObject({ status: 503, body: { error: 'Verification audit unavailable.' } });
    },
  );

  it('a failed verification audit still fails the finish, and the resend awards nothing twice', async () => {
    const { attemptId, body } = await startRoomRun();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const batch = api.env.DB.batch.bind(api.env.DB);
    let failed = false;
    api.env.DB.batch = async <T>(statements: D1PreparedStatement[]) => {
      if (!failed && statements.some((statement) => (statement as unknown as { sql: string }).sql.includes('INTO run_verification_audit'))) {
        failed = true;
        throw new Error('D1 unavailable');
      }
      return batch<T>(statements);
    };
    expect((await api.call(`/api/runs/${attemptId}/finish`, { session: player, body })).status).toBe(500);
    // The reward step shared the audit's wait, so it finished; the client's retry replays the clear.
    advance(1_000);
    expect((await api.call(`/api/runs/${attemptId}/finish`, { session: player, body })).status).toBe(204);
    expect(count("SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'p1' AND event_type = 'room_clear_first'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM point_events WHERE event_type = 'run_finalized' AND source_key = ?", attemptId)).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM run_settlements WHERE attempt_kind = 'room' AND attempt_id = ?", attemptId)).toBe(1);
    expect(count(`SELECT (SELECT total_pxp FROM user_progress WHERE user_id = 'p1') = (SELECT SUM(amount) FROM pxp_events WHERE user_id = 'p1') AS n`)).toBe(1);
  });

  it('a daily clear by a player with no progress row yet lands in the totals it creates', async () => {
    api.sqlite.prepare(`INSERT INTO daily_rooms (date,target_key,target_type,content_id,version,room_id,room_version,room_x,room_y,title,
      builder_user_id,builder_display_name,goal_json,cell_count,picked_by,picked_at)
      VALUES ('2026-10-04','room:1,0','room','1,0',1,'1,0',1,1,0,'Room 1,0','builder','builder',?,1,'automatic',?)`).run(JSON.stringify(roomGoal), '2026-10-04T00:00:00.000Z');
    expect(count("SELECT COUNT(*) AS n FROM user_progress WHERE user_id = 'p2'")).toBe(0);
    await awardRunDailyClear(api.env, { result: 'completed', verificationStatus: 'passed', userId: 'p2' },
      { type: 'room', id: '1,0', version: 1 }, '2026-10-04T18:00:00.000Z');
    expect(count("SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'p2' AND event_type = 'daily_clear'")).toBe(1);
    expect(count(`SELECT (SELECT total_pxp FROM user_progress WHERE user_id = 'p2') = (SELECT SUM(amount) FROM pxp_events WHERE user_id = 'p2') AS n`)).toBe(1);
    // Another room on the same day earns nothing.
    await awardRunDailyClear(api.env, { result: 'completed', verificationStatus: 'passed', userId: 'p3' },
      { type: 'room', id: '0,0', version: 1 }, '2026-10-04T18:00:00.000Z');
    expect(count("SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'p3'")).toBe(0);
  });

  it('two Room Rush submissions of one run save it once and both answer with its attempt', async () => {
    const submission = await startRoomRush();
    const [first, second] = await Promise.all([
      api.call('/api/room-rush/runs', { session: player, body: submission }),
      api.call('/api/room-rush/runs', { session: player, body: submission }),
    ]);
    expect([first.body.saved, second.body.saved].sort()).toEqual([false, true]);
    expect(first.body.attemptId).toBe(second.body.attemptId);
    expect(count('SELECT COUNT(*) AS n FROM room_rush_runs WHERE client_run_id = ?', submission.clientRunId)).toBe(1);
  });

  it('a duplicate Room Rush submit whose lookups reach the database after the original commits answers saved: false', async () => {
    const submission = await startRoomRush();
    // Hold the duplicate's start lookup until the original has committed, as D1 may order two
    // concurrent requests. Were the start and the saved-Rush reads split again, only the start read
    // would be held, and the saved-Rush read would run before the original saved it.
    const hold = api.holdNextQuery(/FROM room_rush_run_starts\s+WHERE start_id = \?/);
    const duplicate = api.call('/api/room-rush/runs', { session: player, body: submission });
    await hold.held;
    const original = await api.call('/api/room-rush/runs', { session: player, body: submission });
    hold.release();
    expect(original).toMatchObject({ status: 201, body: { saved: true } });
    expect(await duplicate).toMatchObject({ status: 200, body: { saved: false, attemptId: original.body.attemptId } });
  });

  it('a duplicate Room Rush submit that sees its start used but not the saved Rush checks again before a 409', async () => {
    const submission = await startRoomRush();
    const original = await api.call('/api/room-rush/runs', { session: player, body: submission });
    // The view a split read could give: the start read after the original committed, the saved-Rush read before.
    const batch = api.env.DB.batch.bind(api.env.DB);
    api.env.DB.batch = async <T>(statements: D1PreparedStatement[]) => {
      const results = await batch<T>(statements);
      const lookup = statements.some((statement) => /FROM room_rush_run_starts/.test((statement as unknown as { sql: string }).sql));
      return lookup ? [results[0], { results: [] } as T] : results;
    };
    expect(await api.call('/api/room-rush/runs', { session: player, body: submission }))
      .toMatchObject({ status: 200, body: { saved: false, attemptId: original.body.attemptId } });
    // A used start that no saved Rush holds is still finalized elsewhere.
    api.sqlite.prepare('DELETE FROM room_rush_runs WHERE client_run_id = ?').run(submission.clientRunId);
    expect(await api.call('/api/room-rush/runs', { session: player, body: submission }))
      .toMatchObject({ status: 409, body: { error: 'Room Rush run start has already been finalized.' } });
  });

  it('an unpublished Room Rush room still answers 400 when the Expanded Room read fails beside it', async () => {
    const submission = await startRoomRush();
    const prepare = api.env.DB.prepare.bind(api.env.DB);
    api.env.DB.prepare = (sql: string) => {
      const statement = prepare(sql);
      if (sql.includes('FROM expanded_room_cells')) statement.all = async () => { throw new Error('D1 unavailable'); };
      return statement;
    };
    const route = [submission.route[0], { routeIndex: 1, roomId: '-1,0', coordinates: { x: -1, y: 0 }, uniqueVisitIndex: 2 }];
    expect(await api.call('/api/room-rush/runs', { session: player,
      body: { ...submission, route, visitedRoomIds: ['0,0', '-1,0'], finishCoordinates: { x: -1, y: 0 } } }))
      .toMatchObject({ status: 400, body: { error: 'Room Rush routes can only include published rooms.' } });
  });

  it('an Expanded Room version without a goal still answers 409 when its course record read fails beside it', async () => {
    const { attemptId, body } = await startExpandedRoomRun();
    api.sqlite.prepare("UPDATE courses SET published_json = json_remove(published_json, '$.goal') WHERE id = 'er'").run();
    const batch = api.env.DB.batch.bind(api.env.DB);
    api.env.DB.batch = async <T>(statements: D1PreparedStatement[]) => {
      if (statements.some((statement) => (statement as unknown as { sql: string }).sql.includes('FROM course_versions'))) {
        throw new Error('D1 unavailable');
      }
      return batch<T>(statements);
    };
    expect(await api.call(`/api/expanded-room-runs/${attemptId}/finish`, { session: player, body }))
      .toMatchObject({ status: 409, body: { error: 'This expanded room version no longer has a leaderboard goal.' } });
  });

  it('two different guest finishes of one run: one counts, the other is told it lost', async () => {
    const { attemptId, body } = await startGuestRun();
    const [cleared, failed] = await Promise.all([
      api.call(`/api/guest-runs/${attemptId}/finish`, { headers: GUEST, body }),
      api.call(`/api/guest-runs/${attemptId}/finish`, { headers: GUEST, body: { ...body, result: 'failed', verificationTrace: null } }),
    ]);
    const statuses = [cleared.status, failed.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = cleared.status === 409 ? cleared : failed;
    expect(loser.body.error ?? loser.body.message).toMatch(/already finished/);
    expect(count("SELECT COUNT(*) AS n FROM guest_run_attempts WHERE attempt_id = ? AND result <> 'active'", attemptId)).toBe(1);
  });
});
