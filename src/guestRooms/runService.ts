import { RANKED_RUN_TRACE_SCHEMA_VERSION } from '../runs/verificationTrace';
import type { RunFinishRequestBody } from '../runs/model';
import { GuestRunFinishQueue, type GuestRunQueuedFinish } from './runFinishQueue';
import { captureGuestRunIdentity, createGuestRunRepository, GuestRunApiError,
  type GuestRunRecoveryIdentity, type GuestRunRepository } from './runRepository';
import type { GuestRunStartBody, GuestRunStartResponse } from './runModel';
import { updateGuestRunClearStatus } from '../progression/guestRunProgress';

export const GUEST_RUN_PROGRESS_CHANGED_EVENT = 'wamp:guest-run-progress-changed';
export interface GuestRunSaveResult {
  clientRunId: string;
  attemptId: string | null;
  status: 'saved' | 'queued' | 'unverified';
  durable: boolean;
  reason: string | null;
}
export interface GuestRunSession {
  clientRunId: string;
  readonly progress: GuestRunSaveResult;
  /** Start the recorder immediately; bind its captured copy once the original start is acknowledged. */
  initialBinding: { verificationSchemaVersion: number; verificationNonce: string; snapshotHash: string };
  ready: Promise<GuestRunStartResponse | null>;
  finish(body: RunFinishRequestBody): Promise<GuestRunSaveResult>;
}
interface StartResult { binding: GuestRunStartResponse | null; error: unknown }
interface GuestRunServiceOptions {
  repository?: GuestRunRepository;
  queue?: GuestRunFinishQueue;
  identity?: () => GuestRunRecoveryIdentity;
  uuid?: () => string;
  now?: () => number;
  notify?: (result: GuestRunSaveResult) => void;
}

export class GuestRunService {
  private readonly repository: GuestRunRepository;
  private readonly queue: GuestRunFinishQueue;
  private readonly identity: () => GuestRunRecoveryIdentity;
  private readonly uuid: () => string;
  private readonly now: () => number;
  private readonly notify: (result: GuestRunSaveResult) => void;
  private readonly deliveries = new Map<string, Promise<GuestRunSaveResult>>();
  private flushing: Promise<GuestRunSaveResult[]> | null = null;

  constructor(options: GuestRunServiceOptions = {}) {
    this.repository = options.repository ?? createGuestRunRepository();
    this.queue = options.queue ?? new GuestRunFinishQueue();
    this.identity = options.identity ?? captureGuestRunIdentity;
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
    this.now = options.now ?? Date.now;
    this.notify = options.notify ?? (result => {
      updateGuestRunClearStatus(result);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GUEST_RUN_PROGRESS_CHANGED_EVENT, { detail: result }));
    });
  }

  begin(target: Omit<GuestRunStartBody, 'clientRunId'>): GuestRunSession {
    const start = { ...target, clientRunId: this.uuid() };
    const identity = { ...this.identity() };
    // Handle rejection immediately, even when the player abandons without submitting a result.
    const pendingStart: Promise<StartResult> = this.repository.start(start, identity)
      .then(binding => ({ binding, error: null }), error => ({ binding: null, error }));
    let finished: Promise<GuestRunSaveResult> | null = null;
    let progress: GuestRunSaveResult = { clientRunId: start.clientRunId, attemptId: null, status: 'queued', durable: false, reason: null };
    return {
      clientRunId: start.clientRunId,
      get progress() { return { ...progress }; },
      initialBinding: { verificationSchemaVersion: RANKED_RUN_TRACE_SCHEMA_VERSION,
        verificationNonce: `pending-${start.clientRunId}`, snapshotHash: 'pending-guest-start' },
      ready: pendingStart.then(result => result.binding),
      finish: body => {
        if (finished) return finished;
        // Freeze before any await: restarting, exiting play or a second recorder must not change this trace.
        const copy = JSON.parse(JSON.stringify(body)) as RunFinishRequestBody;
        copy.finishedAt ??= new Date(this.now()).toISOString();
        const entry: GuestRunQueuedFinish = { schemaVersion: 1, start, identity, body: copy,
          binding: null, createdAt: this.now() };
        const durable = this.queue.put(entry);
        progress = this.result(entry, 'queued', durable, null);
        this.notify(progress);
        finished = this.deliver(entry, durable, pendingStart).then(result => { progress = result; return result; });
        return finished;
      },
    };
  }

  flush(): Promise<GuestRunSaveResult[]> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const results: GuestRunSaveResult[] = [];
      for (const entry of this.queue.list().slice(0, 10)) results.push(await this.deliver(entry, this.queue.isDurable(entry.start.clientRunId)));
      return results;
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private deliver(entry: GuestRunQueuedFinish, durable: boolean, pendingStart?: Promise<StartResult>): Promise<GuestRunSaveResult> {
    const existing = this.deliveries.get(entry.start.clientRunId);
    if (existing) return existing;
    const delivery = this.send(entry, durable, pendingStart).then(result => { this.notify(result); return result; })
      .finally(() => { this.deliveries.delete(entry.start.clientRunId); });
    this.deliveries.set(entry.start.clientRunId, delivery);
    return delivery;
  }

  private async send(entry: GuestRunQueuedFinish, durable: boolean, pendingStart?: Promise<StartResult>): Promise<GuestRunSaveResult> {
    try {
      if (pendingStart) {
        const start = await pendingStart;
        if (start.binding) entry.binding = start.binding;
        else if (terminal(start.error)) {
          this.queue.remove(entry.start.clientRunId);
          return this.result(entry, 'unverified', false, 'Replay to save a verified clear.');
        }
      }
      // Read-only recovery ensures an offline clear cannot create a brand-new server start after completion.
      entry.binding ??= await this.repository.findStart(entry.start.clientRunId, entry.identity);
      if (entry.binding.clientRunId !== entry.start.clientRunId || entry.binding.contentType !== entry.start.contentType
        || entry.binding.contentId !== entry.start.contentId || entry.binding.version !== entry.start.version) {
        throw new GuestRunApiError(409, 'The saved start belongs to another run.');
      }
      if (this.queue.has(entry.start.clientRunId)) durable = this.queue.put(entry);
      const body = { ...entry.body, verificationTrace: entry.body.verificationTrace ? {
        ...entry.body.verificationTrace, schemaVersion: entry.binding.verificationSchemaVersion,
        verificationNonce: entry.binding.verificationNonce, snapshotHash: entry.binding.snapshotHash,
      } : null };
      const response = await this.repository.finish(entry.binding.attemptId, body, entry.identity);
      this.queue.remove(entry.start.clientRunId);
      return this.result(entry, response.saved ? 'saved' : 'unverified', response.saved,
        response.saved ? null : response.verificationReason ?? 'not_completed');
    } catch (error) {
      // A lookup can briefly precede the original in-flight start's commit. Keep that capture for a retry.
      const missingStart = error instanceof GuestRunApiError && error.status === 404 && !entry.binding;
      if ((terminal(error) && !missingStart) || (missingStart && this.now() - entry.createdAt > 120_000)) {
        this.queue.remove(entry.start.clientRunId);
        return this.result(entry, 'unverified', false, 'Replay to save a verified clear.');
      }
      return this.result(entry, this.queue.has(entry.start.clientRunId) ? 'queued' : 'unverified', durable,
        'Waiting for a connection to save this clear.');
    }
  }

  private result(entry: GuestRunQueuedFinish, status: GuestRunSaveResult['status'], durable: boolean, reason: string | null): GuestRunSaveResult {
    return { clientRunId: entry.start.clientRunId, attemptId: entry.binding?.attemptId ?? null, status, durable, reason };
  }
}

let guestRunService: GuestRunService | null = null;
export function getGuestRunService(): GuestRunService {
  return guestRunService ??= new GuestRunService();
}

function terminal(error: unknown): boolean {
  return error instanceof GuestRunApiError && error.status >= 400 && error.status < 500
    && ![408, 425, 429].includes(error.status);
}
