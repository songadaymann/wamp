import { createAdminApiClient } from './adminApiClient';
import { createReplayPlayer } from '../analytics/replay/player';
import { bugRoomHref, type BugReportDetail, type BugReportSummary } from '../bugReports/model';
import './replays.css';
import './bugReports.css';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const key = element<HTMLInputElement>('bug-admin-key'), status = element('bug-admin-status');
const filter = element<HTMLSelectElement>('bug-admin-filter'), list = element('bug-admin-list');
const detail = element('bug-admin-detail'), resolve = element<HTMLButtonElement>('bug-admin-resolve');
const remove = element<HTMLButtonElement>('bug-admin-delete'), room = element<HTMLAnchorElement>('bug-admin-room');
const screenshot = element<HTMLImageElement>('bug-admin-screenshot');
const player = createReplayPlayer({ image: element('bug-admin-frame'), empty: element('bug-admin-empty'),
  play: element('bug-admin-play'), scrub: element('bug-admin-scrub'), time: element('bug-admin-time') });
const client = createAdminApiClient(() => key.value.trim());
try { key.value = sessionStorage.getItem('ep_launch_admin_api_key') ?? ''; } catch { /* Manual key. */ }
let reports: BugReportSummary[] = [], current: BugReportDetail | null = null, generation = 0;
function render(): void {
  list.replaceChildren();
  for (const report of reports) {
    const button = document.createElement('button');
    button.className = 'visit'; button.dataset.reportId = report.id; button.setAttribute('aria-pressed', String(current?.id === report.id));
    button.textContent = `${new Date(report.createdAt).toLocaleString()} · ${report.status}\nRoom ${report.context.roomId ?? 'unknown'} · ${report.signedIn ? 'Signed-in player' : 'Guest'}\n${report.notes.slice(0, 180)}`;
    button.addEventListener('click', () => { void select(report.id); }); list.append(button);
  }
  if (!reports.length) list.textContent = 'No reports match this filter.';
}
async function select(id: string): Promise<void> {
  const requestGeneration = ++generation; player.pause(); detail.hidden = true; current = null;
  try {
    const data = await client.request<{ report: BugReportDetail }>(`/api/admin/bug-reports/${id}`);
    if (requestGeneration !== generation) return;
    current = data.report; detail.hidden = false; render();
    element('bug-admin-title').textContent = `${new Date(current.createdAt).toLocaleString()} · ${current.status}`;
    element('bug-admin-notes').textContent = current.notes;
    const href = bugRoomHref(current.context); room.hidden = !href; if (href) room.href = href;
    element('bug-admin-context').textContent = `Room ${current.context.roomId ?? '?'} · ${current.context.source}${current.context.dirty ? ' with unsaved edits' : ''}
      · version ${current.context.roomVersion ?? '?'} · ${current.context.courseId ? `Expanded Room ${current.context.courseId} v${current.context.courseVersion ?? '?'}` : current.context.mode}
      · build ${current.build}`;
    const hasImages = current.evidence.samples.some(sample => sample.image) || Boolean(current.evidence.screenshot);
    element('bug-admin-evidence-status').textContent = hasImages ? `${(current.durationMs / 1000).toFixed(1)}s replay · ${current.frames} frames · images expire ${new Date(current.evidenceExpiresAt!).toLocaleString()}`
      : current.evidence.reason === 'disabled' ? 'Recording was off. Written report and diagnostic context are available.'
      : current.evidence.reason === 'not_attached' ? 'The reporter chose to send this without game images.' : 'Game images were unavailable or have expired. The written report is retained.';
    screenshot.hidden = !current.evidence.screenshot; if (current.evidence.screenshot) screenshot.src = current.evidence.screenshot;
    element('bug-admin-empty').textContent = 'No replay attached, or this frame is unavailable.';
    element('bug-admin-diagnostics').textContent = JSON.stringify({ device: current.device, context: current.context, errors: current.errors }, null, 2);
    resolve.textContent = current.status === 'open' ? 'Mark resolved' : 'Reopen report'; resolve.disabled = false; remove.disabled = false;
    player.set(current.evidence.samples);
  } catch (error) { if (requestGeneration === generation) status.textContent = String(error); }
}
async function load(): Promise<void> {
  const requestGeneration = ++generation;
  player.pause(); current = null; detail.hidden = true;
  try {
    const data = await client.request<{ reports: BugReportSummary[] }>(`/api/admin/bug-reports?status=${filter.value}`);
    if (requestGeneration !== generation) return;
    try { sessionStorage.setItem('ep_launch_admin_api_key', key.value.trim()); } catch { /* Optional convenience. */ }
    reports = data.reports; element('bug-admin-workspace').hidden = false;
    status.textContent = `${reports.length} reports · notes retained 30 days · images retained seven days`; render();
  } catch (error) {
    if (requestGeneration !== generation) return;
    element('bug-admin-workspace').hidden = true; reports = []; list.replaceChildren(); status.textContent = String(error);
  }
}
element<HTMLFormElement>('bug-admin-auth').addEventListener('submit', event => { event.preventDefault(); void load(); });
filter.addEventListener('change', () => { void load(); });
element('bug-admin-refresh').addEventListener('click', () => { void load(); });
resolve.addEventListener('click', () => {
  if (!current) return;
  const id = current.id, next = current.status === 'open' ? 'resolved' : 'open';
  resolve.disabled = true;
  void client.request(`/api/admin/bug-reports/${id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) })
    .then(() => load()).catch(error => { status.textContent = String(error); resolve.disabled = false; });
});
remove.addEventListener('click', () => {
  if (!current || !confirm('Delete this report and its replay permanently?')) return;
  remove.disabled = true;
  void client.request(`/api/admin/bug-reports/${current.id}`, { method: 'DELETE' })
    .then(() => load()).catch(error => { status.textContent = String(error); remove.disabled = false; });
});
