import './worlds.css';

export class WorldsView {
  readonly content: HTMLElement;
  readonly status: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly title: HTMLElement;

  constructor(root: HTMLElement, onClose: () => void) {
    root.innerHTML = `
      <section class="worlds-modal hidden" aria-hidden="true">
        <div class="worlds-panel" role="dialog" aria-modal="true" aria-labelledby="worlds-title">
          <header class="worlds-header">
            <div><span class="worlds-kicker">The shared WAMP grid</span><h2 id="worlds-title">Worlds</h2></div>
            <button class="bar-btn bar-btn-small" type="button" data-world-action="close">Close</button>
          </header>
          <nav class="worlds-tabs" aria-label="Worlds sections">
            <button class="bar-btn bar-btn-small" type="button" data-world-tab="browse">Browse</button>
            <button class="bar-btn bar-btn-small" type="button" data-world-tab="mine">My Worlds</button>
          </nav>
          <div class="worlds-status" role="status"></div>
          <div class="worlds-content"></div>
        </div>
      </section>`;
    this.modal = required(root.querySelector('.worlds-modal'));
    this.title = required(root.querySelector('#worlds-title'));
    this.content = required(root.querySelector('.worlds-content'));
    this.status = required(root.querySelector('.worlds-status'));
    root.querySelector('[data-world-action="close"]')?.addEventListener('click', onClose);
    this.modal.addEventListener('pointerdown', (event) => {
      if (event.target === this.modal) onClose();
    });
  }

  open(): void {
    this.modal.classList.remove('hidden');
    this.modal.setAttribute('aria-hidden', 'false');
  }

  close(): void {
    this.modal.classList.add('hidden');
    this.modal.setAttribute('aria-hidden', 'true');
  }

  setTitle(value: string): void {
    this.title.textContent = value;
  }

  setStatus(value: string, danger = false): void {
    this.status.textContent = value;
    this.status.classList.toggle('worlds-status-danger', danger);
    this.status.classList.toggle('hidden', !value);
  }

  showLoading(label = 'Loading Worlds…'): void {
    this.setStatus(label);
    this.content.replaceChildren();
  }
}

function required<T extends Element>(value: T | null): T {
  if (!value) throw new Error('Worlds modal markup is incomplete.');
  return value;
}
