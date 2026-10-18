import type { PartyKitShardHeartbeat } from '../admin/model';

export const SHARD_HEARTBEAT_INTERVAL_MS = 60_000;
const CHANGE_COALESCE_MS = 3_000;

interface AlarmStorage {
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

/** Persisted alarms permit hibernation; no in-memory interval or delayed callback stays alive. */
export class ShardHeartbeatScheduler {
  private lastSentAt: number | null = null;
  private pending = Promise.resolve();

  constructor(private readonly options: {
    storage: AlarmStorage;
    enabled: () => boolean;
    snapshot: () => PartyKitShardHeartbeat;
    send: (snapshot: PartyKitShardHeartbeat) => Promise<void>;
  }) {}

  changed(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.options.enabled()) { await this.cancel(); return; }
      const now = Date.now();
      if (this.lastSentAt !== null && now < this.lastSentAt + CHANGE_COALESCE_MS) {
        await this.schedule(this.lastSentAt + CHANGE_COALESCE_MS);
        return;
      }
      await this.flush();
    });
  }

  alarm(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.options.enabled()) { await this.cancel(); return; }
      await this.flush();
    });
  }

  private async flush(): Promise<void> {
    const snapshot = this.options.snapshot();
    this.lastSentAt = Date.now();
    // Establish the next retry before best-effort metrics I/O. Empty shards never re-arm.
    if (snapshot.totalConnections > 0) await this.schedule(this.lastSentAt + SHARD_HEARTBEAT_INTERVAL_MS);
    else await this.cancel();
    await this.options.send(snapshot);
  }

  private async schedule(at: number): Promise<void> {
    const existing = await this.options.storage.getAlarm();
    if (existing === null || existing <= Date.now() || at < existing) await this.options.storage.setAlarm(at);
  }

  private async cancel(): Promise<void> {
    if (await this.options.storage.getAlarm() !== null) await this.options.storage.deleteAlarm();
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.pending.then(work);
    // A failed best-effort report must not poison subsequent connection/alarm events.
    this.pending = result.catch(() => {});
    return result;
  }
}
