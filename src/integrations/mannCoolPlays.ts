import { MANN_COOL_ORIGIN } from './mannCoolInput';

export const MANN_COOL_PLAYS_URL = `${MANN_COOL_ORIGIN}/api/v1/plays`;
export function mannCoolPlaySource(referrer: string): 'direct' | 'mann.cool' {
  try { return new URL(referrer).origin === MANN_COOL_ORIGIN ? 'mann.cool' : 'direct'; }
  catch { return 'direct'; }
}

/** One bounded, best-effort visit report; no identity, room or credential fields. */
export class MannCoolPlayReporter {
  status: 'idle' | 'pending' | 'sent' | 'failed' | 'skipped' = 'idle';
  private request: Promise<void> | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly environment: { hostname: string; referrer: string; fetch: typeof fetch }) {}

  report(): Promise<void> {
    if (this.request) return this.request;
    if (!['wamp.land', 'www.wamp.land'].includes(this.environment.hostname)) {
      this.status = 'skipped'; return this.request = Promise.resolve();
    }
    this.status = 'pending';
    this.abort = new AbortController();
    const timeout = setTimeout(() => this.abort?.abort(), 4000);
    this.request = Promise.resolve().then(async () => {
      const response = await this.environment.fetch(MANN_COOL_PLAYS_URL, {
        method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'wamp', source: mannCoolPlaySource(this.environment.referrer) }),
        signal: this.abort!.signal,
      });
      this.status = response.ok ? 'sent' : 'failed';
    }).catch(() => { this.status = 'failed'; }).finally(() => clearTimeout(timeout));
    return this.request;
  }

  destroy(): void { this.abort?.abort(); }
}
