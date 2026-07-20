import { corsHeaders } from './http';

interface TimingEntry {
  durationMs: number;
  description?: string;
}

export class ServerTiming {
  private readonly startedAt = performance.now();
  private readonly entries = new Map<string, TimingEntry>();

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      this.add(name, performance.now() - startedAt);
    }
  }

  measureSync<T>(name: string, operation: () => T): T {
    const startedAt = performance.now();
    try {
      return operation();
    } finally {
      this.add(name, performance.now() - startedAt);
    }
  }

  add(name: string, durationMs: number, description?: string): void {
    const normalizedName = normalizeTimingName(name);
    const existing = this.entries.get(normalizedName);
    this.entries.set(normalizedName, {
      durationMs: (existing?.durationMs ?? 0) + Math.max(0, durationMs),
      description: description ?? existing?.description,
    });
  }

  setDiagnostic(name: string, description: string): void {
    this.entries.set(normalizeTimingName(name), { durationMs: 0, description });
  }

  toHeaderValue(): string {
    const entries = new Map(this.entries);
    entries.set('total', { durationMs: performance.now() - this.startedAt });
    return Array.from(entries.entries())
      .map(([name, entry]) => {
        const duration = Math.round(entry.durationMs * 100) / 100;
        const description = entry.description
          ? `;desc="${entry.description.replace(/["\\]/g, '')}"`
          : '';
        return `${name};dur=${duration}${description}`;
      })
      .join(', ');
  }
}

export function timedJsonResponse(
  request: Request,
  body: unknown,
  timing: ServerTiming,
  init: ResponseInit = {},
): Response {
  const serialized = timing.measureSync('serialize', () => JSON.stringify(body));
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }
  headers.set('Server-Timing', timing.toHeaderValue());
  return new Response(serialized, { ...init, headers });
}

function normalizeTimingName(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  return normalized || 'segment';
}
