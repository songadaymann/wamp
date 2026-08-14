import type {
  TutorialCoachmarkAction,
  TutorialCoachmarkActionId,
  TutorialCoachmarkViewModel,
} from './coachmarks';
import type { CreativeChecklistItem } from './model';

export interface TutorialViewAction {
  id: TutorialCoachmarkActionId;
  checklistItem?: CreativeChecklistItem;
}

export interface TutorialViewHandlers {
  onAction(action: TutorialViewAction): void;
  onEmailSubmit(email: string): void;
  onSkip(): void;
}

export class TutorialView {
  private root: HTMLDivElement | null = null;
  private status: HTMLDivElement | null = null;

  constructor(
    private readonly doc: Document = document,
    private readonly handlers: TutorialViewHandlers,
  ) {}

  render(model: TutorialCoachmarkViewModel): void {
    this.ensureRoot();
    if (!this.root) return;

    this.root.className = `tutorial-layer tutorial-layer--${model.tone}`;
    this.root.setAttribute('aria-hidden', 'false');
    this.root.replaceChildren(this.buildPanel(model));
    this.status = this.root.querySelector('.tutorial-status');

    if (model.accountCreation && ['idle', 'error'].includes(model.accountCreation.state)) {
      const input = this.root.querySelector<HTMLInputElement>('.tutorial-email-input');
      this.doc.defaultView?.setTimeout(() => input?.focus(), 0);
    } else if (model.tone === 'dream') {
      const primary = this.root.querySelector<HTMLButtonElement>('[data-tutorial-primary="true"]');
      this.doc.defaultView?.setTimeout(() => primary?.focus(), 0);
    }
  }

  setStatus(message: string | null, isError = false): void {
    if (!this.status) return;
    this.status.textContent = message ?? '';
    this.status.classList.toggle('hidden', !message);
    this.status.classList.toggle('tutorial-status--error', Boolean(message) && isError);
  }

  hide(): void {
    this.status = null;
    this.root?.classList.add('hidden');
    this.root?.setAttribute('aria-hidden', 'true');
    this.root?.replaceChildren();
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
    this.status = null;
  }

  private ensureRoot(): void {
    if (this.root) return;
    const root = this.doc.createElement('div');
    root.id = 'tutorial-layer';
    root.className = 'tutorial-layer hidden';
    root.setAttribute('aria-hidden', 'true');
    this.doc.body.append(root);
    this.root = root;
  }

  private buildPanel(model: TutorialCoachmarkViewModel): HTMLElement {
    const panel = this.doc.createElement('section');
    panel.className = 'tutorial-panel';
    panel.setAttribute('role', model.tone === 'dream' ? 'dialog' : 'region');
    if (model.tone === 'dream') panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'tutorial-title');

    if (model.persistentSkip) {
      const skip = this.doc.createElement('button');
      skip.className = 'tutorial-skip';
      skip.type = 'button';
      skip.textContent = 'Skip Tutorial';
      skip.addEventListener('click', () => this.handlers.onSkip());
      panel.append(skip);
    }

    const title = this.doc.createElement('h2');
    title.id = 'tutorial-title';
    title.className = 'tutorial-title';
    title.textContent = model.title;
    panel.append(title);

    if (model.dreamLines) {
      const script = this.doc.createElement('div');
      script.className = 'tutorial-dream-script';
      model.dreamLines.forEach((line, index) => {
        const paragraph = this.doc.createElement('p');
        paragraph.className = 'tutorial-dream-line';
        paragraph.style.setProperty('--tutorial-line-index', String(index));
        paragraph.textContent = line;
        script.append(paragraph);
      });
      panel.append(script);
    } else {
      const body = this.doc.createElement('p');
      body.className = 'tutorial-body';
      body.textContent = model.body;
      panel.append(body);
    }

    if (model.checklist) {
      const list = this.doc.createElement('ul');
      list.className = 'tutorial-checklist';
      for (const item of model.checklist) {
        const row = this.doc.createElement('li');
        row.className = 'tutorial-checklist-item';
        row.dataset.state = item.state;
        const marker = this.doc.createElement('span');
        marker.className = 'tutorial-checklist-marker';
        marker.textContent = item.state === 'done' ? '✓' : item.state === 'skipped' ? '—' : '□';
        const label = this.doc.createElement('span');
        label.className = 'tutorial-checklist-label';
        label.textContent = item.label;
        row.append(marker, label);
        if (item.state === 'pending') {
          const skip = this.doc.createElement('button');
          skip.className = 'tutorial-checklist-skip';
          skip.type = 'button';
          skip.textContent = 'Skip';
          skip.addEventListener('click', () => this.handlers.onAction({
            id: 'skip_checklist_item',
            checklistItem: item.id,
          }));
          row.append(skip);
        }
        list.append(row);
      }
      panel.append(list);
    }

    if (model.accountCreation) {
      panel.append(this.buildAccountCreationForm(model.accountCreation));
    }

    const status = this.doc.createElement('div');
    status.className = 'tutorial-status hidden';
    status.setAttribute('aria-live', 'polite');
    panel.append(status);

    if (model.actions.length > 0) {
      const actions = this.doc.createElement('div');
      actions.className = 'tutorial-actions';
      for (const action of model.actions) actions.append(this.buildAction(action));
      panel.append(actions);
    }

    return panel;
  }

  private buildAction(action: TutorialCoachmarkAction): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.className = `tutorial-action${action.primary ? ' tutorial-action--primary' : ''}`;
    button.type = 'button';
    button.textContent = action.label;
    button.dataset.tutorialPrimary = String(Boolean(action.primary));
    button.addEventListener('click', () => this.handlers.onAction({
      id: action.id,
      checklistItem: action.checklistItem,
    }));
    return button;
  }

  private buildAccountCreationForm(
    account: NonNullable<TutorialCoachmarkViewModel['accountCreation']>,
  ): HTMLFormElement {
    const form = this.doc.createElement('form');
    form.className = 'tutorial-email-form';
    form.noValidate = false;

    const label = this.doc.createElement('label');
    label.className = 'tutorial-email-label';
    label.htmlFor = 'tutorial-email-input';
    label.textContent = 'Email address';

    const controls = this.doc.createElement('div');
    controls.className = 'tutorial-email-controls';

    const input = this.doc.createElement('input');
    input.id = 'tutorial-email-input';
    input.className = 'tutorial-email-input';
    input.type = 'email';
    input.name = 'email';
    input.autocomplete = 'email';
    input.inputMode = 'email';
    input.placeholder = 'you@example.com';
    input.required = true;
    input.value = account.email;
    input.disabled = account.state === 'sending';

    const submit = this.doc.createElement('button');
    submit.className = 'tutorial-email-submit';
    submit.type = 'submit';
    submit.disabled = account.state === 'sending';
    submit.textContent = account.state === 'sending'
      ? 'Sending…'
      : account.state === 'sent'
        ? 'Send Again'
        : 'Email Me a Link';

    controls.append(input, submit);
    form.append(label, controls);

    if (account.debugMagicLink) {
      const debugLink = this.doc.createElement('a');
      debugLink.className = 'tutorial-email-debug-link';
      debugLink.href = account.debugMagicLink;
      debugLink.textContent = 'Open debug account link';
      form.append(debugLink);
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      this.handlers.onEmailSubmit(input.value);
    });

    return form;
  }
}
