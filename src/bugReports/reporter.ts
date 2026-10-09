import { createReplayPlayer } from '../analytics/replay/player';
import { bugRecordingAllowed, setBugRecordingAllowed } from './recordingPreference';
import { BUG_NOTES_LIMIT, BUG_RECORDING_CHANGED, normalizeBugDevice, type BugContext, type BugDiagnostic,
  type BugDevice, type BugEvidence, type BugReportSubmission } from './model';
import { BugReportSender } from './sender';
import './reporter.css';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function device(): BugDevice {
  const ua = navigator.userAgent;
  const match = /(Edg|Firefox|Chrome|Version)\/([\d.]+)/.exec(ua);
  return normalizeBugDevice({ browser: ({ Edg: 'Edge', Firefox: 'Firefox', Chrome: 'Chrome', Version: 'Safari' } as Record<string,string>)[match?.[1] ?? ''] ?? 'Other',
    browserVersion: match?.[2] ?? '', platform: /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
      : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Other',
    width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio, touch: navigator.maxTouchPoints > 0 });
}
function visitorId(): string {
  try {
    const saved = localStorage.getItem('wamp_bug_report_visitor');
    if (saved && /^[a-f0-9-]{36}$/.test(saved)) return saved;
    const id = crypto.randomUUID(); localStorage.setItem('wamp_bug_report_visitor', id); return id;
  } catch { return crypto.randomUUID(); }
}
export function initializeBugReportDialog(host: {
  freeze(): BugEvidence; context(): BugContext; errors(): BugDiagnostic[];
  pause(): () => void; resumeCapture(): void;
}) {
  const modal = element('bug-report-modal'), form = element<HTMLFormElement>('bug-report-form');
  const notes = element<HTMLTextAreaElement>('bug-report-notes'), status = element('bug-report-status');
  const send = element<HTMLButtonElement>('btn-bug-report-send'), close = element<HTMLButtonElement>('btn-bug-report-close');
  const attach = element<HTMLInputElement>('bug-report-attach'), recording = element<HTMLInputElement>('bug-recording-enabled');
  const detail = element('bug-report-context'), summary = element('bug-report-evidence-summary');
  const screenshot = element<HTMLImageElement>('bug-report-screenshot');
  const player = createReplayPlayer({ image: element('bug-report-frame'), empty: element('bug-report-empty'),
    play: element('bug-report-play'), scrub: element('bug-report-scrub'), time: element('bug-report-time') });
  const sender = new BugReportSender(), visitor = visitorId();
  let draft: BugReportSubmission | null = null, resume: (() => void) | null = null;
  let sending = false, opened = false, returnFocus: HTMLElement | null = null, sent = false;
  function syncEvidence(): void {
    if (!draft) return;
    const evidence = draft.evidence, hasImages = evidence.reason === 'captured';
    attach.disabled = !hasImages; attach.checked = hasImages;
    const duration = evidence.samples.at(-1)?.time ?? 0;
    summary.textContent = hasImages ? `${(duration / 1000).toFixed(1)} seconds of recent replay · latest game screenshot`
      : evidence.reason === 'disabled' ? 'Recording is off on this device. You can send notes and room details.'
      : 'Recent replay and screenshot are unavailable. You can still send notes and room details.';
    screenshot.hidden = !evidence.screenshot;
    if (evidence.screenshot) screenshot.src = evidence.screenshot;
    player.set(evidence.samples);
    element('bug-report-empty').textContent = hasImages ? 'Frame unavailable' : 'No game images attached';
  }
  function syncPreference(): void {
    recording.checked = bugRecordingAllowed();
    recording.disabled = navigator.doNotTrack === '1' || Boolean((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl);
    if (!recording.checked && draft) { draft.evidence = { samples: [], screenshot: null, reason: 'disabled' }; syncEvidence(); }
  }
  function open(): void {
    if (opened) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!draft || sent) {
      const context = host.context();
      draft = { id: crypto.randomUUID(), visitor, notes: '', build: import.meta.env.VITE_APP_BUILD_ID ?? 'unknown',
        context, device: device(), errors: host.errors(), evidence: host.freeze() };
      notes.value = ''; sent = false;
    } else host.freeze();
    resume = host.pause(); opened = true;
    document.getElementById('auth-panel')?.classList.remove('menu-open');
    document.getElementById('settings-modal')?.classList.add('hidden');
    document.getElementById('settings-modal')?.setAttribute('aria-hidden', 'true');
    modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false');
    status.textContent = ''; send.hidden = false; send.textContent = 'Send report'; notes.disabled = false; attach.hidden = false;
    close.textContent = 'Close'; send.disabled = notes.value.trim().length < 3; syncEvidence(); syncPreference();
    const ctx = draft.context;
    detail.textContent = `Room ${ctx.roomId ?? 'unavailable'} · ${ctx.source === 'draft' ? `draft${ctx.dirty ? ' with unsaved edits' : ''}` : ctx.source}
      ${ctx.roomVersion ? ` · version ${ctx.roomVersion}` : ''}${ctx.courseId ? ` · Expanded Room ${ctx.courseId} v${ctx.courseVersion ?? '?'}` : ''}
      · ${draft.device.browser} ${draft.device.browserVersion} / ${draft.device.platform} · ${draft.device.width}×${draft.device.height}
      · ${draft.errors.length} recent errors · build ${draft.build.slice(0, 12)}`;
    notes.focus();
  }
  function hide(): void {
    if (sending || !opened) return;
    opened = false; player.pause(); modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true');
    resume?.(); resume = null; host.resumeCapture(); returnFocus?.focus();
  }
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-bug-report-open]')];
  buttons.forEach(button => button.addEventListener('click', open));
  const onNotes = () => { send.disabled = sending || notes.value.trim().length < 3 || notes.value.length > BUG_NOTES_LIMIT; };
  const onAttach = () => {
    if (attach.checked) { syncEvidence(); return; }
    player.pause(); summary.textContent = 'Game images excluded. Notes and diagnostic details will be sent.';
  };
  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!draft || sending || send.disabled || sent) return;
    sending = true; send.disabled = true; close.disabled = true; notes.disabled = true; attach.disabled = true;
    status.textContent = 'Sending report…';
    const report = { ...draft, notes: notes.value,
      evidence: attach.checked ? draft.evidence : { samples: [], screenshot: null, reason: draft.evidence.reason === 'disabled' ? 'disabled' : 'not_attached' } as BugEvidence };
    void sender.submit(report).then(id => {
      sent = true; status.textContent = `Report saved. Thank you! Reference ${id.slice(0, 8)}.`;
      send.hidden = true; close.textContent = 'Done'; notes.value = ''; draft = null;
    }).catch(error => {
      status.textContent = `${error instanceof Error && !['AbortError','TypeError','SyntaxError'].includes(error.name) ? error.message : 'Upload failed.'} Your notes are kept. Retry when ready.`;
      send.textContent = 'Retry report';
    }).finally(() => {
      sending = false; close.disabled = false; notes.disabled = sent;
      attach.disabled = draft?.evidence.reason !== 'captured'; onNotes();
    });
  };
  const onKey = (event: KeyboardEvent) => {
    if (!opened) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); hide(); }
    if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll<HTMLElement>('button:not(:disabled):not([hidden]), textarea:not(:disabled), input:not(:disabled)')]
        .filter(el => el.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  const onBackdrop = (event: MouseEvent) => { if (event.target === modal) hide(); };
  const onPreference = () => syncPreference();
  const onRecording = () => setBugRecordingAllowed(recording.checked);
  close.addEventListener('click', hide); notes.addEventListener('input', onNotes); form.addEventListener('submit', onSubmit);
  attach.addEventListener('change', onAttach);
  modal.addEventListener('click', onBackdrop); document.addEventListener('keydown', onKey, true);
  recording.addEventListener('change', onRecording); window.addEventListener(BUG_RECORDING_CHANGED, onPreference);
  window.addEventListener('storage', onPreference);
  syncPreference();
  return { isOpen: () => opened, destroy(): void {
    hide(); player.destroy(); buttons.forEach(button => button.removeEventListener('click', open));
    close.removeEventListener('click', hide); notes.removeEventListener('input', onNotes); form.removeEventListener('submit', onSubmit);
    attach.removeEventListener('change', onAttach);
    modal.removeEventListener('click', onBackdrop); document.removeEventListener('keydown', onKey, true);
    recording.removeEventListener('change', onRecording); window.removeEventListener(BUG_RECORDING_CHANGED, onPreference);
    window.removeEventListener('storage', onPreference);
  } };
}
