import { createAdminApiClient } from '../adminApiClient';
import { getPublishedGoalIssueText, type PublishedGoalIssuesResponse } from '../publishedGoalIssues';

export function createPublishedGoalsPanel(getAdminKey: () => string): { reset(): void } {
  const scanButton = document.getElementById('room-setup-review') as HTMLButtonElement | null;
  const nextButton = document.getElementById('room-setup-next') as HTMLButtonElement | null;
  const status = document.getElementById('room-setup-status');
  const list = document.getElementById('room-setup-list');
  const client = createAdminApiClient(getAdminKey);
  let nextCursor: string | null = null;
  let generation = 0;
  let abort: AbortController | null = null;

  function reset(): void {
    generation += 1;
    abort?.abort();
    abort = null;
    nextCursor = null;
    list?.replaceChildren();
    if (status) status.textContent = 'Use an admin key, then review published room goals.';
    if (scanButton) scanButton.disabled = false;
    if (nextButton) { nextButton.disabled = false; nextButton.hidden = true; }
  }

  async function scan(cursor: string | null): Promise<void> {
    if (abort) return;
    const key = getAdminKey();
    if (!key) { reset(); return; }
    const currentGeneration = ++generation;
    abort = new AbortController();
    if (scanButton) scanButton.disabled = true;
    if (nextButton) nextButton.disabled = true;
    if (status) status.textContent = 'Checking published room goals…';
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (cursor) params.set('cursor', cursor);
      const response = await client.request<PublishedGoalIssuesResponse>(`/api/admin/suspicious/published-goals?${params}`, { signal: abort.signal });
      if (currentGeneration !== generation || key !== getAdminKey()) return;
      const total = Object.values(response.counts).reduce((sum, count) => sum + count, 0);
      if (status) status.textContent = `${total} room setup issue${total === 1 ? '' : 's'}: ${response.counts.missing_exit} missing exits, ${response.counts.missing_finish} missing finishes, ${response.counts.no_enemies} empty Defeat All goals. Showing ${response.items.length} on this page.`;
      list?.replaceChildren();
      for (const item of response.items) {
        const row = document.createElement('div');
        row.className = 'room-setup-item';
        const link = document.createElement('a');
        link.href = `/r/${item.x}/${item.y}?welcome=0`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = `${item.title?.trim() || 'Untitled room'} (${item.x}, ${item.y}) · v${item.version}`;
        const reason = document.createElement('div');
        reason.className = 'meta';
        reason.textContent = getPublishedGoalIssueText(item.issue);
        row.append(link, reason);
        list?.append(row);
      }
      nextCursor = response.nextCursor;
      if (nextButton) nextButton.hidden = nextCursor === null;
    } catch (error) {
      if (currentGeneration === generation && status) status.textContent = error instanceof Error ? error.message : 'Could not review room setup issues.';
    } finally {
      if (currentGeneration === generation) {
        abort = null;
        if (scanButton) scanButton.disabled = false;
        if (nextButton) nextButton.disabled = false;
      }
    }
  }

  scanButton?.addEventListener('click', () => { void scan(null); });
  nextButton?.addEventListener('click', () => { if (nextCursor) void scan(nextCursor); });
  return { reset };
}
