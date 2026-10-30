import { apiRequest, ApiError } from '../api/request';
import {
  REPORT_DETAILS_LIMIT,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ContentReportRequestBody,
  type ContentReportResponse,
  type ReportReason,
  type ReportTarget,
} from './model';
import './reportDialog.css';

interface ReportDialog {
  open(target: ReportTarget | null): void;
}

let dialog: ReportDialog | null = null;

function createReportDialog(doc: Document): ReportDialog {
  const element = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const modal = element('report-modal');
  const form = element<HTMLFormElement>('report-form');
  const subject = element('report-subject');
  const reasons = element('report-reasons');
  const details = element<HTMLTextAreaElement>('report-details');
  const status = element('report-status');
  const send = element<HTMLButtonElement>('btn-report-send');
  const close = element<HTMLButtonElement>('btn-report-close');
  details.maxLength = REPORT_DETAILS_LIMIT;
  reasons.append(...REPORT_REASONS.map((reason) => {
    const label = doc.createElement('label');
    const input = doc.createElement('input');
    input.type = 'radio';
    input.name = 'report-reason';
    input.value = reason;
    label.append(input, ` ${REPORT_REASON_LABELS[reason]}`);
    return label;
  }));
  let target: ReportTarget | null = null;
  let opened = false;
  let sending = false;
  let returnFocus: HTMLElement | null = null;

  const selectedReason = (): ReportReason | null =>
    (form.querySelector<HTMLInputElement>('input[name="report-reason"]:checked')?.value as ReportReason | undefined) ?? null;
  const sync = () => { send.disabled = sending || !selectedReason(); };

  function hide(): void {
    if (!opened || sending) return;
    opened = false;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    returnFocus?.focus();
  }

  form.addEventListener('change', sync);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const reason = selectedReason();
    if (!target || !reason || sending) return;
    sending = true;
    sync();
    status.textContent = 'Sending…';
    const body: ContentReportRequestBody = {
      targetType: target.type, targetId: target.id, reason, details: details.value.trim(),
    };
    void apiRequest<ContentReportResponse>('/api/reports', { method: 'POST', body: JSON.stringify(body) })
      .then((response) => {
        status.textContent = response.alreadyReported
          ? 'You already reported this. Thank you — it is in the review queue.'
          : 'Thank you. Your report was sent privately, and someone will review it.';
        send.hidden = true;
        close.textContent = 'Done';
      })
      .catch((error: unknown) => {
        status.textContent = error instanceof ApiError ? error.message : 'Could not send the report. Try again.';
      })
      .finally(() => { sending = false; sync(); });
  });
  close.addEventListener('click', hide);
  modal.addEventListener('click', (event) => { if (event.target === modal) hide(); });
  doc.addEventListener('keydown', (event) => {
    if (opened && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); hide(); }
  }, true);

  return {
    open(next: ReportTarget | null): void {
      target = next;
      returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
      subject.textContent = next?.label ?? 'Nothing selected';
      form.reset();
      form.hidden = next === null;
      status.textContent = next ? '' : 'Select a published room on the map first, then choose Report this room again.';
      send.hidden = next === null;
      close.textContent = next ? 'Cancel' : 'Close';
      sync();
      doc.getElementById('auth-panel')?.classList.remove('menu-open');
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      opened = true;
      form.querySelector<HTMLInputElement>('input[name="report-reason"]')?.focus();
    },
  };
}

export function openReportDialog(target: ReportTarget | null, doc: Document = document): void {
  dialog ??= createReportDialog(doc);
  dialog.open(target);
}
