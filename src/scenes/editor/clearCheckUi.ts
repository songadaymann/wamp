import type { ReadyToPublishChecklist } from './clearCheck';

let activeClose: (() => void) | null = null;
export function closePublishChecklist(): void { activeClose?.(); }

export function renderChecklistRows(container: HTMLElement, checklist: ReadyToPublishChecklist): void {
  const doc = container.ownerDocument;
  container.replaceChildren(...checklist.rows.map(row => {
    const item = doc.createElement('li'); item.dataset.clearCheckRow = row.id; item.dataset.state = row.state;
    const label = doc.createElement('strong'); label.textContent = `${row.state === 'ready' ? '✓' : row.state === 'optional' ? '–' : '○'} ${row.label}`;
    const detail = doc.createElement('span'); detail.textContent = row.detail;
    item.append(label, detail); return item;
  }));
}

export function renderEditorClearCheck(doc: Document, checklist?: ReadyToPublishChecklist): void {
  const root = doc.getElementById('editor-clear-check');
  root?.classList.toggle('hidden', !checklist);
  const rows = doc.getElementById('editor-clear-check-rows');
  if (checklist && rows) renderChecklistRows(rows, checklist);
  const heading = doc.getElementById('editor-clear-check-title');
  if (heading) heading.textContent = checklist?.cleared ? 'Clear Check ✓' : 'Ready to Publish';
}

export function openPublishChecklist(checklist: ReadyToPublishChecklist): Promise<'publish' | 'test' | 'cancel'> {
  closePublishChecklist();
  const root = document.getElementById('publish-checklist-modal');
  const rows = document.getElementById('publish-checklist-rows');
  const publish = document.getElementById('btn-publish-checklist-confirm') as HTMLButtonElement | null;
  const test = document.getElementById('btn-publish-checklist-test');
  const cancel = document.getElementById('btn-publish-checklist-close');
  const status = document.getElementById('publish-checklist-status');
  if (!root || !rows || !publish || !test || !cancel || !status) return Promise.resolve('cancel');
  const opener = document.activeElement as HTMLElement | null;
  renderChecklistRows(rows, checklist);
  status.textContent = checklist.publishError ?? (checklist.ready ? 'Your room checks are ready.' : 'These suggestions are advisory. You can publish before completing a Clear Check.');
  publish.disabled = Boolean(checklist.publishError);
  publish.textContent = checklist.ready ? 'Publish room' : 'Publish anyway';
  root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false');
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: 'publish' | 'test' | 'cancel') => {
      if (settled) return; settled = true;
      root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true');
      publish.removeEventListener('click', onPublish); test.removeEventListener('click', onTest);
      cancel.removeEventListener('click', close); root.removeEventListener('click', onBackdrop); root.removeEventListener('keydown', onKey, true);
      if (activeClose === close) activeClose = null;
      if (opener?.isConnected) opener.focus(); resolve(result);
    };
    const close = () => finish('cancel');
    const onPublish = () => { if (!publish.disabled) finish('publish'); };
    const onTest = () => finish('test');
    const onBackdrop = (event: MouseEvent) => { if (event.target === root) close(); };
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const buttons = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    activeClose = close; publish.addEventListener('click', onPublish); test.addEventListener('click', onTest);
    cancel.addEventListener('click', close); root.addEventListener('click', onBackdrop); root.addEventListener('keydown', onKey, true);
    cancel.focus();
  });
}
