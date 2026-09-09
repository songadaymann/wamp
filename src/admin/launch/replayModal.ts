import './replayModal.css';
export function setupLaunchReplayModal(feed: HTMLElement | null): void {
  if (!feed) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'launch-replay-dialog';
  dialog.setAttribute('aria-label','Guest visit replay');
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = 'Close replay';
  const frame = document.createElement('iframe');
  frame.title = 'Guest visit replay';
  dialog.append(close, frame);
  document.body.append(dialog);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { frame.src = 'about:blank'; });
  feed.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-replay-session]') : null;
    const id = button?.dataset.replaySession;
    if (!id || !/^[a-f0-9-]{36}$/.test(id)) return;
    frame.src = `/guest-replays.html?embedded=1&session=${encodeURIComponent(id)}`;
    dialog.showModal();
  });
}
