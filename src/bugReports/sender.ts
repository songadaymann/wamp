import { getApiBaseUrl } from '../api/baseUrl';
import type { BugReportSubmission } from './model';

/** Keep the same id/body for an uncertain retry; a changed report gets a new id. */
export class BugReportSender {
  private attempt: { text: string; id: string } | null = null;
  constructor(private readonly send: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  async submit(report: BugReportSubmission): Promise<string> {
    const text = JSON.stringify({ ...report, id: '' });
    if (!this.attempt || this.attempt.text !== text) this.attempt = { text, id: crypto.randomUUID() };
    const id = this.attempt.id, controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.send(`${getApiBaseUrl()}/api/bug-reports`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...report, id }), signal: controller.signal,
      });
      const result = await response.json() as { id?: string; stored?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Report could not be saved. Please retry.');
      if (result.id !== id || result.stored !== true) throw new Error('Saving was not confirmed. Please retry.');
      this.attempt = null;
      return id;
    } finally { clearTimeout(timeout); }
  }
}
