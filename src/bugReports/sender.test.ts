import { expect, it, vi } from 'vitest';
vi.mock('../api/baseUrl', () => ({ getApiBaseUrl: () => '' }));
import { BugReportSender } from './sender';
import { normalizeBugContext, normalizeBugDevice, type BugReportSubmission } from './model';
const report = (): BugReportSubmission => ({ id: crypto.randomUUID(), visitor: crypto.randomUUID(), notes: 'The camera hiccups',
  build: 'test', context: normalizeBugContext(null), device: normalizeBugDevice(null), errors: [],
  evidence: { samples: [], screenshot: null, reason: 'disabled' } });
it('preserves the browser fetch receiver for the default transport', async () => {
  vi.stubGlobal('fetch', function(this: unknown, _url: unknown, init: RequestInit) {
    expect(this).toBe(globalThis);
    return Promise.resolve(Response.json({ id: JSON.parse(String(init.body)).id, stored: true }));
  });
  try { await expect(new BugReportSender().submit(report())).resolves.toBeTypeOf('string'); }
  finally { vi.unstubAllGlobals(); }
});
it('retries uncertain storage with the same id and only confirms a stored receipt', async () => {
  const bodies: BugReportSubmission[] = [];
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init!.body)); bodies.push(body);
    if (bodies.length === 1) throw new Error('Disconnected');
    return Response.json({ id: body.id, stored: true });
  });
  const sender = new BugReportSender(send), body = report();
  await expect(sender.submit(body)).rejects.toThrow('Disconnected');
  await expect(sender.submit(body)).resolves.toBe(bodies[0].id);
  expect(bodies[1]).toEqual(bodies[0]); expect(send.mock.calls[0][1]?.credentials).toBe('include');
});
it('does not confirm a failed/unconfirmed upload and gives edited notes a new identity', async () => {
  const ids: string[] = [];
  const sender = new BugReportSender(vi.fn<typeof fetch>(async (_url, init) => {
    ids.push(JSON.parse(String(init!.body)).id); return Response.json({ stored: false });
  }));
  const body = report();
  await expect(sender.submit(body)).rejects.toThrow('not confirmed');
  await expect(sender.submit({ ...body, notes: 'Changed description' })).rejects.toThrow('not confirmed');
  expect(ids[0]).not.toBe(ids[1]);
});
