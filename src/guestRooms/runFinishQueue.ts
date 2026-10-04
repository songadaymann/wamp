import type { RunFinishRequestBody } from '../runs/model';
import { normalizeRankedRunVerificationTrace } from '../runs/verificationTrace';
import type { GuestRunRecoveryIdentity } from './runRepository';
import type { GuestRunStartBody, GuestRunStartResponse } from './runModel';

export const GUEST_RUN_FINISH_KEY_PREFIX = 'wamp_guest_run_finish_v1:';
const MAX_ENTRIES = 50;
const MAX_BYTES = 3 * 1024 * 1024;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export interface GuestRunQueuedFinish {
  schemaVersion: 1;
  start: GuestRunStartBody;
  identity: GuestRunRecoveryIdentity;
  body: RunFinishRequestBody;
  binding: GuestRunStartResponse | null;
  createdAt: number;
}

export function guestRunQueueStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/** One key per attempt avoids losing another tab's pending clear during a whole-list rewrite. */
export class GuestRunFinishQueue {
  private readonly volatile = new Map<string, GuestRunQueuedFinish>();
  constructor(private readonly storage: Storage | null = guestRunQueueStorage(), private readonly now = Date.now) {}

  list(): GuestRunQueuedFinish[] {
    const entries = new Map(this.volatile);
    try {
      const keys: string[] = [];
      for (let i = 0; i < (this.storage?.length ?? 0); i += 1) {
        const key = this.storage?.key(i);
        if (key?.startsWith(GUEST_RUN_FINISH_KEY_PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        const raw = this.storage?.getItem(key);
        const entry = raw ? parseEntry(raw, key, this.now()) : null;
        if (entry) { if (!entries.has(entry.start.clientRunId)) entries.set(entry.start.clientRunId, entry); }
        else this.storage?.removeItem(key);
      }
    } catch { /* The current tab can still retry its volatile entries. */ }
    for (const [id, entry] of entries) {
      if (entry.createdAt < this.now() - RETENTION_MS) { entries.delete(id); this.remove(id); }
    }
    return [...entries.values()].sort((a, b) => a.createdAt - b.createdAt).slice(0, MAX_ENTRIES);
  }

  put(entry: GuestRunQueuedFinish): boolean {
    const entries = this.list().filter(other => other.start.clientRunId !== entry.start.clientRunId);
    const raw = JSON.stringify(entry);
    const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
    if (entries.length >= MAX_ENTRIES || bytes(raw) + entries.reduce((sum, other) => sum + bytes(JSON.stringify(other)), 0) > MAX_BYTES) return false;
    try {
      if (this.storage) {
        this.storage.setItem(GUEST_RUN_FINISH_KEY_PREFIX + entry.start.clientRunId, raw);
        this.volatile.delete(entry.start.clientRunId);
        return true;
      }
    } catch { /* Keep this session's copy when storage is blocked or full. */ }
    this.volatile.set(entry.start.clientRunId, entry);
    return false;
  }

  has(clientRunId: string): boolean { return this.list().some(entry => entry.start.clientRunId === clientRunId); }
  isDurable(clientRunId: string): boolean {
    try { return Boolean(this.storage?.getItem(GUEST_RUN_FINISH_KEY_PREFIX + clientRunId)); } catch { return false; }
  }
  remove(clientRunId: string): void {
    this.volatile.delete(clientRunId);
    try { this.storage?.removeItem(GUEST_RUN_FINISH_KEY_PREFIX + clientRunId); } catch { /* An acknowledged retry is idempotent. */ }
  }
}

function parseEntry(raw: string, key: string, now: number): GuestRunQueuedFinish | null {
  if (raw.length > MAX_BYTES) return null;
  try {
    const entry = JSON.parse(raw) as GuestRunQueuedFinish;
    const start = entry?.start;
    const identity = entry?.identity;
    const body = entry?.body;
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (entry.schemaVersion !== 1 || !number(entry.createdAt) || entry.createdAt > now + 60_000
      || entry.createdAt < now - RETENTION_MS
      || !start || !/^[a-f0-9-]{36}$/i.test(start.clientRunId) || key !== GUEST_RUN_FINISH_KEY_PREFIX + start.clientRunId
      || !['room', 'course', 'expanded_room'].includes(start.contentType)
      || typeof start.contentId !== 'string' || !start.contentId || start.contentId.length > 128
      || !Number.isSafeInteger(start.version) || start.version < 1
      || !identity || !/^guest-[A-Za-z0-9_-]{1,74}$/.test(identity.guestUserId)
      || !/^[A-Za-z0-9_-]{32,160}$/.test(identity.recoveryToken)
      || !body || !['completed', 'failed', 'abandoned'].includes(body.result)
      || ![body.elapsedMs, body.deaths, body.collectiblesCollected, body.enemyCollectiblesCollected,
        body.enemiesDefeated, body.checkpointsReached].every(number)
      || (body.verificationTrace != null && !normalizeRankedRunVerificationTrace(body.verificationTrace))) return null;
    // The binding is recovered from the server when absent or damaged; it never creates a new start.
    if (entry.binding && (entry.binding.clientRunId !== start.clientRunId || !entry.binding.attemptId
      || !entry.binding.verificationNonce || !entry.binding.snapshotHash)) entry.binding = null;
    return entry;
  } catch { return null; }
}
