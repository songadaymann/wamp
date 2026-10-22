import { createAdminApiClient } from '../adminApiClient';
import { REPORT_REASON_LABELS, type AdminContentReport, type AdminContentReportsResponse } from '../../reports/model';

const TARGET_NAMES: Record<AdminContentReport['targetType'], string> = {
  room: 'Room',
  user: 'Player',
  chat_message: 'Chat message',
  guest_room: 'Guest room',
};

function targetLink(report: AdminContentReport): string | null {
  if (report.targetType === 'room') {
    const [x, y] = report.targetId.split(',');
    return `/r/${encodeURIComponent(x)}/${encodeURIComponent(y)}`;
  }
  return null;
}

/** Player reports: newest first, with a quick way to inspect the reported player and close the report. */
export function createReportsPanel(
  getAdminKey: () => string,
  getOperatorLabel: () => string,
  inspectUser: (userId: string) => void,
): { reset(): void; load(): Promise<void> } {
  const list = document.getElementById('reports-list');
  const status = document.getElementById('reports-status');
  const filter = document.getElementById('reports-filter') as HTMLSelectElement | null;
  const client = createAdminApiClient(getAdminKey);
  let generation = 0;

  function renderReport(report: AdminContentReport): HTMLElement {
    const row = document.createElement('div');
    row.className = 'audit-item';
    const heading = document.createElement('strong');
    heading.textContent = `${TARGET_NAMES[report.targetType]} · ${REPORT_REASON_LABELS[report.reason]}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${new Date(report.createdAt).toLocaleString()} · ${report.reporterSignedIn ? 'signed-in reporter' : 'guest reporter'}`
      + ` · ${report.openReportsForTarget} open report(s) on this ${TARGET_NAMES[report.targetType].toLowerCase()} · ${report.status}`;
    const label = document.createElement('div');
    label.textContent = report.targetLabel;
    row.append(heading, meta, label);
    if (report.details) {
      const details = document.createElement('div');
      details.className = 'meta';
      details.textContent = `“${report.details}”`;
      row.append(details);
    }
    const actions = document.createElement('div');
    actions.className = 'actions';
    const link = targetLink(report);
    if (link) {
      const open = document.createElement('a');
      open.href = link;
      open.target = '_blank';
      open.rel = 'noopener';
      open.textContent = 'Open room';
      actions.append(open);
    }
    if (report.targetUserId) {
      const inspect = document.createElement('button');
      inspect.type = 'button';
      inspect.className = 'secondary';
      inspect.textContent = 'Inspect player';
      inspect.addEventListener('click', () => inspectUser(report.targetUserId!));
      actions.append(inspect);
    }
    if (report.status === 'open') {
      for (const [next, text] of [['resolved', 'Handled'], ['dismissed', 'Dismiss']] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = report.openReportsForTarget > 1 ? `${text} (all ${report.openReportsForTarget})` : text;
        button.addEventListener('click', () => { void close(report, next); });
        actions.append(button);
      }
    }
    row.append(actions);
    return row;
  }

  async function close(report: AdminContentReport, next: 'resolved' | 'dismissed'): Promise<void> {
    try {
      await client.request(`/api/admin/reports/${encodeURIComponent(report.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next, allForTarget: true, operatorLabel: getOperatorLabel() }),
      });
      await load();
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : 'Could not update the report.';
    }
  }

  async function load(): Promise<void> {
    if (!getAdminKey()) { reset(); return; }
    const current = ++generation;
    try {
      const response = await client.request<AdminContentReportsResponse>(
        `/api/admin/reports?status=${encodeURIComponent(filter?.value ?? 'open')}`,
      );
      if (current !== generation) return;
      list?.replaceChildren(...response.reports.map(renderReport));
      if (status) status.textContent = response.reports.length === 0 ? 'No reports.' : `${response.reports.length} report(s).`;
    } catch (error) {
      if (current === generation && status) status.textContent = error instanceof Error ? error.message : 'Could not load reports.';
    }
  }

  function reset(): void {
    generation += 1;
    list?.replaceChildren();
    if (status) status.textContent = 'Use an admin key to load player reports.';
  }

  filter?.addEventListener('change', () => { void load(); });
  return { reset, load };
}
