import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunFinishRequestBody } from '../runs/model';
import { resolveGuestRecoveryToken } from './identity';
import { GUEST_RUN_FINISH_KEY_PREFIX, GuestRunFinishQueue, type GuestRunQueuedFinish } from './runFinishQueue';
import { createGuestRunRepository, GuestRunApiError, type GuestRunRecoveryIdentity, type GuestRunRepository } from './runRepository';
import { GuestRunService, type GuestRunSaveResult } from './runService';
import type { GuestRunStartBody, GuestRunStartResponse } from './runModel';

vi.mock('../presence/worldPresence', () => ({ resolveWorldPresenceGuestIdentity: () => ({ userId: 'guest-test' }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
class MemoryStorage implements Storage {
  readonly entries = new Map<string, string>();
  blocked = false;
  get length(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); }
  getItem(key: string): string | null { return this.entries.get(key) ?? null; }
  key(index: number): string | null { return [...this.entries.keys()][index] ?? null; }
  removeItem(key: string): void { this.entries.delete(key); }
  setItem(key: string, value: string): void { if (this.blocked) throw Error('Quota'); this.entries.set(key, value); }
}
const identity: GuestRunRecoveryIdentity = { guestUserId: 'guest-test', recoveryToken: 'a'.repeat(64) };
const target = { contentType: 'room' as const, contentId: '0,0', version: 1 };
function id(index = 1): string { return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`; }
function binding(start: GuestRunStartBody = { ...target, clientRunId: id() }): GuestRunStartResponse {
  return { ...start, attemptId: id(900), startedAt: new Date(0).toISOString(), verificationSchemaVersion: 1,
    verificationNonce: 'server-nonce', snapshotHash: 'server-hash' };
}
function finishBody(): RunFinishRequestBody {
  return { result: 'completed', elapsedMs: 1000, deaths: 0, collectiblesCollected: 0,
    enemyCollectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0,
    verificationTrace: { schemaVersion: 1, verificationNonce: 'pending', snapshotHash: 'pending', traceDurationMs: 1000,
      inputEvents: [{ atMs: 0, control: 'moveX', value: 1 }], roomTransitions: [],
      breadcrumbs: [{ atMs: 0, roomX: 0, roomY: 0, x: 64, y: 64, vx: 0, vy: 0, grounded: true }],
      goalEvents: [{ atMs: 1000, type: 'reach_exit', actor: 'player', roomId: '0,0', roomX: 0, roomY: 0,
        x: 64, y: 64, instanceId: null, checkpointIndex: null }] } };
}
function entry(index = 1, createdAt = 1000): GuestRunQueuedFinish {
  return { schemaVersion: 1, start: { ...target, clientRunId: id(index) }, identity: { ...identity },
    body: finishBody(), binding: binding({ ...target, clientRunId: id(index) }), createdAt };
}
function repository(): GuestRunRepository {
  return {
    start: vi.fn(async body => binding(body)), findStart: vi.fn(async clientRunId => binding({ ...target, clientRunId })),
    finish: vi.fn(async (attemptId: string) => ({ attemptId, result: 'completed' as const, verificationStatus: 'passed' as const, verificationReason: null, saved: true })),
    listPending: vi.fn(async () => ({ clears: [], totalClears: 0 })),
    claim: vi.fn(async claimId => ({ claimId, clearsSaved: 0, pxpAwarded: 0, remainingClears: 0 })),
    listClaimed: vi.fn(async () => ({ clears: [], totalClears: 0 })),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const storage = new MemoryStorage(); const queue = new GuestRunFinishQueue(storage, () => 1000);
  const repo = repository(); const notify = vi.fn<(result: GuestRunSaveResult) => void>();
  const service = new GuestRunService({ repository: repo, queue, identity: () => identity, uuid: () => id(), now: () => 1000, notify });
  return { storage, queue, repo, notify, service };
}

describe('guest run capture and durable delivery', () => {
  it('keeps the initial movement and quick-clear event while the original start is pending', async () => {
    const { service, queue, repo } = setup(); const pending = deferred<GuestRunStartResponse>();
    vi.mocked(repo.start).mockReturnValue(pending.promise);
    const session = service.begin(target); const body = finishBody(); const completed = session.finish(body);
    expect(queue.list()).toHaveLength(1); expect(repo.finish).not.toHaveBeenCalled();
    body.verificationTrace!.goalEvents[0].x = 9999; body.verificationTrace!.inputEvents.length = 0;
    expect(session.finish({ ...body, deaths: 99 })).toBe(completed);
    pending.resolve(binding()); expect(await completed).toMatchObject({ status: 'saved', durable: true });
    expect(repo.start).toHaveBeenCalledTimes(1); expect(repo.finish).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.finish).mock.calls[0][1].verificationTrace).toMatchObject({
      verificationNonce: 'server-nonce', snapshotHash: 'server-hash',
      inputEvents: [{ atMs: 0, control: 'moveX', value: 1 }], goalEvents: [{ x: 64 }],
    });
    expect(body.verificationTrace!.verificationNonce).toBe('pending'); expect(queue.list()).toEqual([]);
  });
  it('recovers a lost start response by reading the original attempt, without creating a later start', async () => {
    const { service, repo } = setup(); vi.mocked(repo.start).mockRejectedValue(new TypeError('Connection lost'));
    const completed = await service.begin(target).finish(finishBody());
    expect(completed.status).toBe('saved'); expect(repo.findStart).toHaveBeenCalledWith(id(), identity);
    expect(repo.start).toHaveBeenCalledTimes(1);
  });
  it('a second tab can recover a trace saved before the original start acknowledgement', async () => {
    const { service, repo, storage } = setup(); const pending = deferred<GuestRunStartResponse>();
    vi.mocked(repo.start).mockReturnValue(pending.promise);
    const first = service.begin(target).finish(finishBody());
    const otherRepo = repository(); const other = new GuestRunService({ repository: otherRepo,
      queue: new GuestRunFinishQueue(storage, () => 1000) });
    expect((await other.flush())[0].status).toBe('saved'); expect(otherRepo.start).not.toHaveBeenCalled();
    pending.resolve(binding()); expect((await first).status).toBe('saved');
    expect(vi.mocked(repo.finish).mock.calls[0][1]).toEqual(vi.mocked(otherRepo.finish).mock.calls[0][1]);
  });
  it('retries the exact captured payload after a lost finish acknowledgement and reload', async () => {
    const { service, repo, storage, queue } = setup();
    vi.mocked(repo.finish).mockRejectedValue(new TypeError('Response lost after commit'));
    expect(await service.begin(target).finish(finishBody())).toMatchObject({ status: 'queued', durable: true });
    const sent = vi.mocked(repo.finish).mock.calls[0][1]; expect(queue.list()).toHaveLength(1);
    const nextRepo = repository(); const next = new GuestRunService({ repository: nextRepo,
      queue: new GuestRunFinishQueue(storage, () => 1000) });
    expect((await next.flush())[0].status).toBe('saved');
    expect(vi.mocked(nextRepo.finish).mock.calls[0][1]).toEqual(sent); expect(nextRepo.start).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
  });
  it('keeps the run recovery identity even if auth or another tab changes the current identity', async () => {
    const { repo, queue } = setup(); let current = { ...identity };
    const service = new GuestRunService({ repository: repo, queue, identity: () => current, uuid: () => id() });
    const session = service.begin(target); current = { guestUserId: 'guest-other', recoveryToken: 'b'.repeat(64) };
    await session.finish(finishBody()); expect(repo.finish).toHaveBeenCalledWith(id(900), expect.any(Object), identity);
  });
  it('does not turn a rejected verification into saved progress', async () => {
    const { service, repo, queue, notify } = setup(); vi.mocked(repo.finish).mockResolvedValue({
      attemptId: id(900), result: 'completed', saved: false, verificationStatus: 'failed', verificationReason: 'goal_missing' });
    expect(await service.begin(target).finish(finishBody())).toMatchObject({ status: 'unverified', durable: false, reason: 'goal_missing' });
    expect(queue.list()).toEqual([]); expect(notify.mock.calls.some(([result]) => result.status === 'saved')).toBe(false);
  });
  it.each([400, 401, 403, 404, 409, 410])('drops an unrecoverable finish HTTP %s without losing another pending clear', async status => {
    const { service, repo, queue } = setup(); queue.put(entry(2));
    vi.mocked(repo.finish).mockRejectedValue(new GuestRunApiError(status, 'Rejected'));
    expect((await service.begin(target).finish(finishBody())).status).toBe('unverified');
    expect(queue.list().map(entry => entry.start.clientRunId)).toEqual([id(2)]);
  });
  it.each([408, 425, 429, 500, 503])('retains a retryable finish HTTP %s', async status => {
    const { service, repo, queue } = setup(); vi.mocked(repo.finish).mockRejectedValue(new GuestRunApiError(status, 'Retry'));
    expect(await service.begin(target).finish(finishBody())).toMatchObject({ status: 'queued', durable: true });
    expect(queue.list()).toHaveLength(1);
  });
  it('never creates a server attempt for a wholly offline clear on reconnect', async () => {
    const { repo, storage } = setup(); let now = 1000;
    const queue = new GuestRunFinishQueue(storage, () => now);
    const service = new GuestRunService({ repository: repo, queue, identity: () => identity, uuid: () => id(), now: () => now });
    vi.mocked(repo.start).mockRejectedValue(new TypeError('Offline'));
    vi.mocked(repo.findStart).mockRejectedValue(new GuestRunApiError(404, 'No original start'));
    expect((await service.begin(target).finish(finishBody())).status).toBe('queued');
    now += 120001; expect((await service.flush())[0].status).toBe('unverified');
    expect(queue.list()).toEqual([]); expect(repo.start).toHaveBeenCalledTimes(1); expect(repo.finish).not.toHaveBeenCalled();
  });
  it('handles an abandoned start rejection even when no finish is requested', async () => {
    const { service, repo } = setup(); vi.mocked(repo.start).mockRejectedValue(new GuestRunApiError(404, 'Private'));
    expect(await service.begin(target).ready).toBeNull();
    expect((await service.begin(target).finish(finishBody())).status).toBe('unverified'); expect(repo.findStart).not.toHaveBeenCalled();
  });
  it('rejects a recovered binding for another target', async () => {
    const { service, repo } = setup(); vi.mocked(repo.start).mockResolvedValue({ ...binding(), contentId: 'other' });
    expect((await service.begin(target).finish(finishBody())).status).toBe('unverified'); expect(repo.finish).not.toHaveBeenCalled();
  });
  it('coalesces flushing and bounds each batch to ten attempts', async () => {
    const { service, repo, queue } = setup(); for (let index = 1; index <= 12; index++) queue.put(entry(index));
    const first = service.flush(); expect(service.flush()).toBe(first);
    expect(await first).toHaveLength(10); expect(repo.finish).toHaveBeenCalledTimes(10); expect(queue.list()).toHaveLength(2);
  });
  it('reports a volatile retry truthfully when browser storage is blocked', async () => {
    const { service, repo, storage, queue } = setup(); storage.blocked = true;
    vi.mocked(repo.finish).mockRejectedValue(new TypeError('Offline'));
    expect(await service.begin(target).finish(finishBody())).toMatchObject({ status: 'queued', durable: false });
    expect(queue.list()).toHaveLength(1); expect((await service.flush())[0]).toMatchObject({ status: 'queued', durable: false });
  });
});

describe('guest finish storage and recovery identity', () => {
  it('preserves pending keys owned by other tabs and unrelated browser data', () => {
    const storage = new MemoryStorage(); storage.setItem('other-feature', 'preserve');
    const first = new GuestRunFinishQueue(storage, () => 1000); const second = new GuestRunFinishQueue(storage, () => 1000);
    first.put(entry(1)); second.put(entry(2)); expect(first.list()).toHaveLength(2);
    first.remove(id(1)); expect(second.list().map(entry => entry.start.clientRunId)).toEqual([id(2)]);
    expect(storage.getItem('other-feature')).toBe('preserve');
  });
  it('does not evict unacknowledged clears when the queue is full', () => {
    const storage = new MemoryStorage(); const queue = new GuestRunFinishQueue(storage, () => 1000);
    for (let index = 1; index <= 50; index++) expect(queue.put(entry(index))).toBe(true);
    expect(queue.put(entry(51))).toBe(false); expect(queue.has(id(51))).toBe(false); expect(queue.list()).toHaveLength(50);
  });
  it('bounds capture bytes without removing an earlier clear', () => {
    const queue = new GuestRunFinishQueue(new MemoryStorage(), () => 1000); queue.put(entry(1));
    const large = entry(2); large.body.verificationTrace!.verificationNonce = 'x'.repeat(3 * 1024 * 1024);
    expect(queue.put(large)).toBe(false); expect(queue.list()).toHaveLength(1);
  });
  it('removes malformed or expired own entries and keeps healthy and unrelated records', () => {
    const storage = new MemoryStorage(); const queue = new GuestRunFinishQueue(storage, () => 1000);
    queue.put(entry()); storage.setItem('other-feature', 'preserve');
    storage.setItem(GUEST_RUN_FINISH_KEY_PREFIX + id(2), '{}');
    storage.setItem(GUEST_RUN_FINISH_KEY_PREFIX + id(3), JSON.stringify({ ...entry(3), createdAt: -1 }));
    expect(queue.list().map(entry => entry.start.clientRunId)).toEqual([id()]); expect(storage.length).toBe(2);
  });
  it('retains one recovery token for blocked and unavailable storage', () => {
    const storage = new MemoryStorage(); storage.blocked = true;
    const token = resolveGuestRecoveryToken(storage); expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(resolveGuestRecoveryToken(storage)).toBe(token);
    expect(resolveGuestRecoveryToken(null)).toBe(resolveGuestRecoveryToken(null));
  });
});

describe('guest API transport', () => {
  it('omits cookies for guest requests and includes cookies only for account claim/history', async () => {
    const fetcher = vi.fn(async (_url: string, _options: RequestInit & { headers: Headers }) => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetcher);
    const repo = createGuestRunRepository('https://api.test');
    await repo.start({ ...target, clientRunId: id() }, identity); await repo.findStart(id(), identity);
    await repo.finish(id(900), finishBody(), identity); await repo.listPending(identity);
    await repo.claim(id(800), identity); await repo.listClaimed();
    expect(fetcher.mock.calls.map(([, options]) => options.credentials)).toEqual(['omit', 'omit', 'omit', 'omit', 'include', 'include']);
    expect(fetcher.mock.calls[0][1].headers.get('X-Guest-Recovery-Token')).toBe(identity.recoveryToken);
    expect(fetcher.mock.calls[5][1].headers.has('X-Guest-Recovery-Token')).toBe(false);
    expect(fetcher.mock.calls.every(([, options]) => options.signal instanceof AbortSignal)).toBe(true);
  });
  it('retains the HTTP status and server error without logging identity secrets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Try again later.' }), { status: 429 })));
    await expect(createGuestRunRepository('https://api.test').findStart(id(), identity))
      .rejects.toMatchObject({ status: 429, message: 'Try again later.' });
  });
});
