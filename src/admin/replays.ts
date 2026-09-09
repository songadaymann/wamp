import { createAdminApiClient } from './adminApiClient';
import type { ReplaySample, ReplaySession } from '../analytics/replay/model';
import './replays.css';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const requestedSession = new URLSearchParams(location.search).get('session');
if (new URLSearchParams(location.search).get('embedded') === '1') document.body.classList.add('embedded-replay');
const key = element<HTMLInputElement>('replay-key');
try { key.value = sessionStorage.getItem('ep_launch_admin_api_key') ?? ''; } catch { /* Key can be entered manually. */ }
const status = element('replay-status');
const visits = element('replay-visits');
const filter = element<HTMLSelectElement>('replay-filter');
const frame = element<HTMLImageElement>('replay-frame');
const empty = element('replay-empty');
const scrub = element<HTMLInputElement>('replay-scrub');
const play = element<HTMLButtonElement>('replay-play');
const remove = element<HTMLButtonElement>('replay-delete');
const speed = element<HTMLSelectElement>('replay-speed');
const client = createAdminApiClient(() => key.value.trim());
let sessions: ReplaySession[] = [];
let samples: ReplaySample[] = [];
let current: ReplaySession | null = null;
let playing = false;
let position = 0;
let previous = 0;
let generation = 0;
const clock = (ms: number) => `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
function pause(): void { playing = false; play.textContent = 'Play'; }
function draw(): void {
  const sample = [...samples].reverse().find(s => s.time <= position) ?? samples[0];
  if (!sample) return;
  scrub.value = String(position);
  element('replay-time').textContent = `${clock(position)} / ${clock(samples.at(-1)?.time ?? 0)}`;
  frame.hidden = !sample.image;
  empty.hidden = !!sample.image;
  if (sample.image) frame.src = sample.image;
  else empty.textContent = sample.mode === 'play' ? 'Gameplay frame unavailable' : sample.mode === 'edit' ? 'Builder frame unavailable' : 'Browsing — see the action timeline below';
  element('replay-detail').textContent = `${sample.screen.replace(/_/g,' ')} · ${sample.mode} · room ${sample.room ?? '—'}${sample.player ? ` · position ${sample.player.x}, ${sample.player.y}` : ''}`;
}
function renderVisits(): void {
  visits.replaceChildren();
  const shown = sessions.filter(s => filter.value === 'all' || (filter.value === 'built' && s.built) || (filter.value === 'no_play' && !s.played)
    || (filter.value === 'no_move' && s.played && !s.moved) || (filter.value === 'signup' && s.signup)
    || (filter.value === 'signed_in' && s.signed_in) || (filter.value === 'return' && s.visits > 1));
  for (const session of shown) {
    const button = document.createElement('button');
    button.className = 'visit';
    button.dataset.sessionId = session.id;
    button.setAttribute('aria-pressed', String(current?.id === session.id));
    const date = new Date(session.started_at).toLocaleString();
    button.textContent = `${date}\n${session.built ? 'Built rooms · ' : ''}${session.played ? session.moved ? 'Played' : 'Played without moving' : 'Never played'}${session.signup ? ' · signup opened' : ''}${session.signed_in ? ' · signed in' : ''}\n${session.viewport} · ${session.referrer_host || 'Direct / unknown'} · ${session.samples} samples · ${session.visits} visits this week`;
    button.addEventListener('click', () => { void select(session); });
    visits.append(button);
  }
  if (!shown.length) visits.textContent = 'No visits match this filter.';
}
async function select(session: ReplaySession): Promise<void> {
  const requestGeneration = ++generation;
  pause();
  current = session;
  samples = [];
  frame.hidden = true;
  empty.hidden = false;
  empty.textContent = 'Loading…';
  play.disabled = true;
  remove.disabled = true;
  scrub.disabled = true;
  renderVisits();
  try {
    const data = await client.request<{samples:ReplaySample[]}>(`/api/admin/guest-replays/${session.id}`);
    if (requestGeneration !== generation) return;
    samples = data.samples;
    position = 0;
    scrub.max = String(samples.at(-1)?.time ?? 0);
    scrub.disabled = !samples.length;
    play.disabled = !samples.length;
    remove.disabled = false;
    element('replay-title').textContent = new Date(session.started_at).toLocaleString();
    const events = element('replay-events');
    events.replaceChildren();
    let lastRoom: string | null = null;
    let lastMode = '';
    let lastScreen = '';
    for (const sample of samples) {
      const labels: string[] = [...sample.actions.map(a => a.replace(/_/g,' '))];
      if (sample.screen !== lastScreen) labels.push(sample.screen.replace(/_/g,' '));
      lastScreen = sample.screen;
      if (sample.mode !== lastMode) labels.unshift(sample.mode);
      if (sample.room !== lastRoom) labels.push(`room ${sample.room ?? '—'}`);
      lastRoom = sample.room; lastMode = sample.mode;
      if (!labels.length) continue;
      const item = document.createElement('li');
      const jump = document.createElement('button');
      jump.textContent = `${clock(sample.time)} · ${labels.join(' · ')}`;
      jump.onclick = () => { position = sample.time; draw(); };
      item.append(jump); events.append(item);
    }
    if (!samples.length) empty.textContent = 'No samples received. The guest may have left before recording started.';
    draw();
  } catch (error) { if (requestGeneration === generation) status.textContent = String(error); }
}
element<HTMLFormElement>('replay-auth').addEventListener('submit', event => {
  event.preventDefault();
  void (async () => {
    try {
      const data = await client.request<{sessions:ReplaySession[]}>(`/api/admin/guest-replays${requestedSession ? '?session='+encodeURIComponent(requestedSession) : ''}`);
      try { sessionStorage.setItem('ep_launch_admin_api_key',key.value.trim()); } catch { /* Optional convenience only. */ }
      document.body.classList.add('replay-authorized');
      sessions = data.sessions;
      status.textContent = `${sessions.length} recent visits · first five minutes at 1 fps · seven-day retention · up to 100 recordings/day`;
      renderVisits();
      if (requestedSession) {
        const selected = sessions.find(s => s.id === requestedSession);
        if (selected) await select(selected);
        else status.textContent = 'This recording has expired or was deleted.';
      }
    } catch (error) { status.textContent = String(error); }
  })();
});
filter.onchange = renderVisits;
scrub.oninput = () => { pause(); position = Number(scrub.value); draw(); };
play.onclick = () => {
  playing = !playing;
  if (position >= Number(scrub.max)) position = 0;
  play.textContent = playing ? 'Pause' : 'Play';
};
remove.onclick = () => {
  if (!current || !confirm('Delete this recording permanently?')) return;
  const id = current.id;
  void client.request(`/api/admin/guest-replays/${id}`,{method:'DELETE'}).then(() => {
    generation++; pause(); current = null; samples = []; sessions = sessions.filter(s => s.id !== id);
    frame.hidden = true; empty.hidden = false; empty.textContent = 'Recording deleted.';
    play.disabled = true; remove.disabled = true; scrub.disabled = true;
    element('replay-events').replaceChildren(); renderVisits();
  }).catch(error => { status.textContent = String(error); });
};
function animate(now: number): void {
  if (playing && samples.length) {
    position = Math.min(Number(scrub.max),position+Math.min(250,now-previous)*Number(speed.value));
    draw();
    if (position >= Number(scrub.max)) pause();
  }
  previous = now;
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

if (key.value) element<HTMLFormElement>('replay-auth').requestSubmit();
