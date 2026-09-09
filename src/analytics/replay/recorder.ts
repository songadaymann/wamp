import { getGuestVisitSessionId } from '../guestActivity';
import { REPLAY_EDITOR_EVENT } from './editorEvents';
import { getApiBaseUrl } from '../../api/baseUrl';
import { getAuthDebugState, AUTH_STATE_CHANGED_EVENT } from '../../auth/client';
import { REPLAY_ACTIONS, REPLAY_IMAGE_LIMIT, REPLAY_SECONDS, replayPosition, type ReplayAction, type ReplaySample } from './model';
import type { GuestActivitySnapshot } from '../guestActivity';
import './notice.css';

const OPT_OUT = 'wamp_replay_opt_out';
const VISITOR = 'wamp_replay_visitor';
const ACTIONS: Record<string, ReplayAction> = {
  'btn-world-play': 'play_toggle', 'btn-world-restart': 'restart', 'btn-room-sequence-stop': 'stop', 'btn-room-sequence-restart': 'restart', 'btn-room-goal-intro-start': 'room_start', 'btn-welcome-play': 'welcome_play', 'btn-welcome-build': 'welcome_build',
  'menu-toggle': 'menu', 'btn-auth-email': 'email_submit', 'btn-auth-wallet': 'wallet_open',
  'btn-guest-builder-claim-signin': 'signup_open', 'btn-guest-room-recovery-signin': 'signup_open',
  'btn-run-guest-claim-signin': 'signup_open', 'btn-run-share-signin': 'signup_open',
};
interface Host {
  canvas: HTMLCanvasElement;
  onFrame(callback: () => void): () => void;
  snapshot(): GuestActivitySnapshot;
  state(): Record<string, unknown>;
}
export function initializeGuestReplay(host: Host): () => void {
  const api = getApiBaseUrl();
  if (import.meta.env.DEV && api.startsWith('https://')) return () => {};
  try { if (localStorage.getItem(OPT_OUT) === '1') return () => {}; } catch { /* volatile recording */ }
  if (navigator.doNotTrack === '1' || (navigator as Navigator & {globalPrivacyControl?: boolean}).globalPrivacyControl) return () => {};
  let stopped = false;
  let credentials: { id: string; token: string } | null = null;
  let starting = false;
  let start = 0;
  let sequence = 0;
  let due = false;
  let sending = false;
  let failures = 0;
  let pending: ReplaySample[] = [];
  const actions: ReplayAction[] = [];
  let lastTool = '';
  let lastGoal = { room: '', deaths: 0, result: '' };
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const notice = document.createElement('div');
  notice.className = 'guest-replay-notice';
  notice.setAttribute('role', 'status');
  notice.append('We record brief play and building sessions to improve WAMP. No form entries. ');
  const optOut = document.createElement('button');
  optOut.type = 'button';
  optOut.textContent = 'Don’t record me';
  notice.append(optOut);
  const post = (path: string, body: unknown, keepalive = false) => fetch(`${api}/api/guest-replays/${path}`, {
    method: 'POST', credentials: 'omit', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body), keepalive,
  });
  async function flush(keepalive = false): Promise<void> {
    if (!credentials || sending || !pending.length) return;
    sending = true;
    const batch = pending.slice(0,3);
    try {
      const response = await post('samples', { ...credentials, samples: batch }, keepalive);
      if (!response.ok) throw new Error('Upload failed');
      pending = pending.slice(batch.length);
      failures = 0;
    } catch {
      failures++;
      if (failures >= 3) stop();
    } finally { sending = false; if (stopped && failures < 3 && pending.length) void flush(true); }
  }
  function screen(): ReplaySample['screen'] {
    for (const [id, label] of [['boot-splash','loading'],['welcome-modal','welcome'],['room-goal-intro-modal','room_instructions']] as const) {
      const el = document.getElementById(id);
      if (el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden') return label;
    }
    return document.getElementById('auth-panel')?.classList.contains('menu-open') ? 'menu' : 'game';
  }
  function sample(image: string | null): void {
    if (!credentials || sequence >= REPLAY_SECONDS || stopped) return;
    const snapshot = host.snapshot();
    const room = snapshot.roomCoordinates;
    const state = host.state();
    if (snapshot.mode === 'edit') {
      const tool = `tool_${state.activeTool}`;
      if (tool !== lastTool && REPLAY_ACTIONS.includes(tool as ReplayAction)) actions.push(tool as ReplayAction);
      lastTool = tool;
    }
    const goal = state.goalRun as {roomId?: string; deaths?: number; result?: string} | null;
    if (goal) {
      if (goal.roomId === lastGoal.room && Number(goal.deaths) > lastGoal.deaths) actions.push('death');
      if ((goal.result === 'completed' || goal.result === 'failed') && (goal.result !== lastGoal.result || goal.roomId !== lastGoal.room)) actions.push(goal.result);
      lastGoal = {room:goal.roomId ?? '',deaths:Number(goal.deaths) || 0,result:goal.result ?? ''};
    }

    pending.push({sequence:sequence++, time:Math.min(REPLAY_SECONDS*1000,Math.round(performance.now()-start)),
      mode:snapshot.mode, screen:screen(), room:room ? `${room.x},${room.y}` : null,
      player: snapshot.mode === 'play' ? replayPosition(state.player) : null, actions:actions.splice(0,12), image});
    if (pending.length > 6) { stop(); return; }
    if (pending.length >= 3) void flush();
  }
  const removeFrame = host.onFrame(() => {
    if (!due || stopped) return;
    due = false;
    let image: string | null = null;
    // Capture only the game canvas, never DOM, form values, chat, or auth data.
    if (host.snapshot().mode !== 'browse' && context && host.canvas.width && host.canvas.height) {
      try {
        const scale = Math.min(640 / host.canvas.width, 480 / host.canvas.height);
        canvas.width = Math.max(1, Math.round(host.canvas.width * scale));
        canvas.height = Math.max(1, Math.round(host.canvas.height * scale));
        context.drawImage(host.canvas,0,0,canvas.width,canvas.height);
        image = canvas.toDataURL('image/jpeg',0.35);
        if (image.length > REPLAY_IMAGE_LIMIT) image = canvas.toDataURL('image/jpeg',0.12);
        if (image.length > REPLAY_IMAGE_LIMIT) image = null;
      } catch { /* An unreadable canvas must not interrupt gameplay. */ }
    }
    sample(image);
  });
  async function tick(): Promise<void> {
    if (stopped) return;
    const auth = getAuthDebugState();
    if (auth.loading) return;
    if (auth.authenticated) {
      if (credentials) { actions.push('signed_in'); sample(null); }
      stop();
      return;
    }
    if (document.visibilityState !== 'visible') return;
    if (!credentials && !starting) {
      starting = true;
      document.body.append(notice);
      let visitor = crypto.randomUUID();
      try {
        const saved = localStorage.getItem(VISITOR);
        if (saved && /^[a-f0-9-]{36}$/.test(saved)) visitor = saved as typeof visitor;
        else localStorage.setItem(VISITOR, visitor);
      } catch { /* Anonymous identity can be session-only. */ }
      let referrer = '';
      try { referrer = new URL(document.referrer).hostname; } catch { /* direct visit */ }
      try {
        const response = await post('start', {visitor,visitSessionId:getGuestVisitSessionId(),path:location.pathname,referrer,viewport:`${innerWidth}x${innerHeight}`});
        if (!response.ok) throw new Error('Recording unavailable');
        credentials = await response.json() as {id:string;token:string};
        if (stopped) { await post('discard',credentials); return; }
        start = performance.now();
      } catch { stop(); return; }
      finally { starting = false; }
    }
    if (credentials && (performance.now()-start >= REPLAY_SECONDS*1000 || sequence >= REPLAY_SECONDS)) { stop(); return; }
    due = !!credentials;
  }
  function click(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (host.snapshot().mode === 'edit' && event.target instanceof Element && event.target.closest('[data-object-id]') && actions.length < 12) actions.push('object_selected');
    if (!target) return;
    const action = ACTIONS[target.id] ?? ({test:'test',stop:'stop',restart:'restart'} as Record<string,ReplayAction>)[target.getAttribute('data-editor-shell-action') ?? ''];
    if (action && actions.length < 12) actions.push(action);
  }
  function editorAction(event: Event): void {
    const action = (event as CustomEvent<ReplayAction>).detail;
    if (!stopped && REPLAY_ACTIONS.includes(action) && actions.length < 12) actions.push(action);
  }
  function visibility(): void {
    if (!credentials || stopped) return;
    actions.push(document.visibilityState === 'hidden' ? 'hidden' : 'visible');
    sample(null);
    void flush(true);
  }
  function pagehide(): void { sample(null); void flush(true); }
  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    removeFrame();
    notice.remove();
    window.removeEventListener(REPLAY_EDITOR_EVENT, editorAction);
    document.removeEventListener('click', click);
    document.removeEventListener('visibilitychange',visibility);
    window.removeEventListener('pagehide',pagehide);
    window.removeEventListener(AUTH_STATE_CHANGED_EVENT,tick);
    void flush(true);
  }
  optOut.addEventListener('click', () => {
    try { localStorage.setItem(OPT_OUT,'1'); } catch { /* still stop this visit */ }
    pending = [];
    stop();
    if (credentials) void post('discard',credentials,true).catch(() => {});
  });
  window.addEventListener(REPLAY_EDITOR_EVENT, editorAction);
  document.addEventListener('click', click);
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',pagehide);
  window.addEventListener(AUTH_STATE_CHANGED_EVENT,tick);
  const timer = window.setInterval(() => { void tick(); },1000);
  void tick();
  return stop;
}
