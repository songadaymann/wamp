import { createAdminApiClient } from '../adminApiClient';
import type { LaunchFunnelResponse } from '../model';

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

/** New guests followed to play, build, clear, sign-up and publish, by where they came from (F127). */
export function setupLaunchFunnel(getAdminKey: () => string, doc: Document = document): void {
  const client = createAdminApiClient(getAdminKey);
  const range = doc.getElementById('launch-funnel-range') as HTMLSelectElement | null;
  const load = doc.getElementById('launch-funnel-load') as HTMLButtonElement | null;
  const status = doc.getElementById('launch-funnel-status');
  const steps = doc.getElementById('launch-funnel-steps');
  const sources = doc.getElementById('launch-funnel-sources');
  let generation = 0;

  const cell = (tag: 'td' | 'th', text: string) => { const element = doc.createElement(tag); element.textContent = text; return element; };

  async function refresh(): Promise<void> {
    if (!getAdminKey()) { if (status) status.textContent = 'Use your admin key, then Load.'; return; }
    const current = ++generation;
    if (status) status.textContent = 'Loading…';
    try {
      const funnel = await client.request<LaunchFunnelResponse>(`/api/admin/launch-funnel?days=${range?.value ?? '7'}`);
      if (current !== generation) return;
      const { steps: counts } = funnel;
      steps?.replaceChildren(...([
        ['New guest browsers', counts.visitors],
        ['Played a room as a guest', counts.played],
        ['Built something as a guest', counts.built],
        ['Cleared a room as a guest (verified; guest clears are kept 14 days)', counts.cleared],
        ['Signed up', counts.signedUp],
        ['Published a room', counts.published],
      ] as const).map(([label, value]) => {
        const row = doc.createElement('tr');
        row.append(cell('th', label), cell('td', String(value)), cell('td', percent(value, counts.visitors)));
        return row;
      }));
      sources?.replaceChildren(...funnel.sources.map((source) => {
        const row = doc.createElement('tr');
        row.append(cell('th', source.source), cell('td', String(source.visitors)), cell('td', percent(source.played, source.visitors)),
          cell('td', percent(source.built, source.visitors)), cell('td', percent(source.signedUp, source.visitors)));
        return row;
      }));
      if (status) {
        status.textContent = `Since ${new Date(funnel.since).toLocaleDateString()} · ${percent(funnel.phoneVisitors, counts.visitors)} on phones`
          + ` · came back next day ${percent(funnel.returns.d1.returned, funnel.returns.d1.eligible)}`
          + ` · came back within a week ${percent(funnel.returns.d7.returned, funnel.returns.d7.eligible)}`
          + ' (a separate visit 12 hours to 2 or 7 days after the first). Crawlers are left out; "unknown" is visits from before'
          + ' 22 October 2026, when sign-ups also started being linked to their guest visit.';
      }
    } catch (error) {
      if (current === generation && status) status.textContent = error instanceof Error ? error.message : 'The funnel could not load.';
    }
  }

  load?.addEventListener('click', () => { void refresh(); });
  range?.addEventListener('change', () => { void refresh(); });
}
