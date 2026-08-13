import { getAuthDebugState } from '../../auth/client';
import { playSfx } from '../../audio/sfx';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import {
  ROOM_COMMENT_MAX_LENGTH,
  type RoomCommentRecord,
} from '../../roomComments/model';
import { submitRoomComment } from '../../roomComments/client';
import type { RoomSnapshot } from '../../persistence/roomModel';

interface ComposerElements {
  root: HTMLDivElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  counter: HTMLDivElement;
  cancelButton: HTMLButtonElement;
  submitButton: HTMLButtonElement;
}

interface RoomCommentsComposerAuthState {
  authenticated: boolean;
  user: unknown;
  schoolManaged: boolean;
}

interface RoomCommentsComposerControllerOptions {
  document?: Document;
  getHost: () => HTMLElement;
  focusCanvas: () => void;
  getRenderableRoom: () => RoomSnapshot | null;
  getPlayerCommentPosition: () => { x: number; y: number } | null;
  showTransientStatus?: (message: string) => void;
  getAuthState?: () => RoomCommentsComposerAuthState;
  submitComment?: typeof submitRoomComment;
  playSubmitSound?: () => void;
}

export interface RoomCommentsComposerDebugSnapshot {
  composerOpen: boolean;
  submitting: boolean;
}

export class RoomCommentsComposerController {
  private elements: ComposerElements | null = null;
  private openState = false;
  private submitting = false;

  constructor(private readonly options: RoomCommentsComposerControllerOptions) {}

  initialize(): void {
    this.ensureDom();
    this.render();
  }

  destroy(): void {
    this.destroyDom();
    this.openState = false;
    this.submitting = false;
  }

  update(): void {
    if (!this.options.getRenderableRoom()) {
      this.close(false);
      return;
    }
    this.render();
  }

  open(): boolean {
    const room = this.options.getRenderableRoom();
    if (!room) {
      this.options.showTransientStatus?.('Play a published room to leave a comment.');
      return false;
    }

    const authState = this.getAuthState();
    if (!authState.authenticated || !authState.user) {
      this.options.showTransientStatus?.('Sign in to comment on rooms.');
      return false;
    }
    if (authState.schoolManaged) {
      this.options.showTransientStatus?.('Classroom accounts cannot comment on rooms.');
      return false;
    }

    this.ensureDom();
    this.openState = true;
    this.render();
    this.elements?.input.focus();
    return true;
  }

  close(focusCanvas = true): void {
    if (!this.openState) {
      this.render();
      return;
    }

    this.openState = false;
    this.submitting = false;
    if (this.elements) {
      this.elements.form.reset();
      this.elements.input.blur();
    }
    this.render();

    if (focusCanvas) {
      this.options.focusCanvas();
    }
  }

  isOpen(): boolean {
    return this.openState;
  }

  handleEscapeKey(): boolean {
    if (!this.openState) {
      return false;
    }

    this.close();
    return true;
  }

  refresh(): void {
    this.render();
  }

  getDebugSnapshot(): RoomCommentsComposerDebugSnapshot {
    return {
      composerOpen: this.openState,
      submitting: this.submitting,
    };
  }

  private readonly handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    void this.submit();
  };

  private readonly handleInput = () => {
    this.renderCounter();
  };

  private readonly handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.close();
  };

  private readonly handleCancel = () => {
    this.close();
  };

  private async submit(): Promise<void> {
    if (this.submitting || !this.elements) {
      return;
    }

    const room = this.options.getRenderableRoom();
    if (!room) {
      this.options.showTransientStatus?.('Play a published room to leave a comment.');
      return;
    }

    const body = this.elements.input.value.replace(/\s+/g, ' ').trim();
    if (!body) {
      this.options.showTransientStatus?.('Type a comment first.');
      return;
    }
    if (body.length > ROOM_COMMENT_MAX_LENGTH) {
      this.options.showTransientStatus?.(`Keep comments under ${ROOM_COMMENT_MAX_LENGTH} characters.`);
      return;
    }

    const position = this.options.getPlayerCommentPosition() ?? {
      x: Math.round(ROOM_PX_WIDTH / 2),
      y: Math.round(ROOM_PX_HEIGHT / 2),
    };

    this.submitting = true;
    this.render();
    try {
      await (this.options.submitComment ?? submitRoomComment)(room.id, room.coordinates, {
        roomVersion: room.version,
        position,
        body,
      });
      (this.options.playSubmitSound ?? (() => playSfx('chat-send')))();
      this.close(false);
      this.options.showTransientStatus?.('Comment submitted for review.');
    } catch (error) {
      this.options.showTransientStatus?.(getErrorMessage(error, 'Comment failed to submit.'));
    } finally {
      this.submitting = false;
      this.render();
    }
  }

  private ensureDom(): void {
    if (this.elements) return;

    const doc = this.options.document ?? document;
    const root = doc.createElement('div');
    root.id = 'room-comment-composer';
    root.className = 'room-comment-composer hidden';

    const form = doc.createElement('form');
    form.className = 'room-comment-composer-form';

    const input = doc.createElement('textarea');
    input.id = 'room-comment-input';
    input.className = 'room-comment-input';
    input.maxLength = ROOM_COMMENT_MAX_LENGTH;
    input.placeholder = 'Leave a comment for this room';
    input.rows = 3;
    input.spellcheck = true;

    const footer = doc.createElement('div');
    footer.className = 'room-comment-composer-footer';

    const counter = doc.createElement('div');
    counter.className = 'room-comment-counter';
    counter.textContent = `0/${ROOM_COMMENT_MAX_LENGTH}`;

    const cancelButton = doc.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'bar-btn bar-btn-small room-comment-cancel';
    cancelButton.textContent = 'Cancel';

    const submitButton = doc.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'bar-btn bar-btn-small room-comment-submit';
    submitButton.textContent = 'Submit';

    footer.append(counter, cancelButton, submitButton);
    form.append(input, footer);
    root.append(form);
    this.options.getHost().append(root);

    form.addEventListener('submit', this.handleSubmit);
    input.addEventListener('input', this.handleInput);
    input.addEventListener('keydown', this.handleKeydown);
    cancelButton.addEventListener('click', this.handleCancel);

    this.elements = { root, form, input, counter, cancelButton, submitButton };
  }

  private destroyDom(): void {
    if (!this.elements) return;
    this.elements.form.removeEventListener('submit', this.handleSubmit);
    this.elements.input.removeEventListener('input', this.handleInput);
    this.elements.input.removeEventListener('keydown', this.handleKeydown);
    this.elements.cancelButton.removeEventListener('click', this.handleCancel);
    this.elements.root.remove();
    this.elements = null;
  }

  private render(): void {
    const elements = this.elements;
    if (!elements) return;

    const authState = this.getAuthState();
    const open = this.openState && Boolean(this.options.getRenderableRoom());
    elements.root.classList.toggle('hidden', !open);
    elements.input.disabled = !authState.authenticated || authState.schoolManaged || this.submitting;
    elements.submitButton.disabled = !authState.authenticated || authState.schoolManaged || this.submitting;
    elements.cancelButton.disabled = this.submitting;
    elements.submitButton.textContent = this.submitting ? 'Submitting...' : 'Submit';
    elements.input.placeholder = authState.schoolManaged
      ? 'Classroom comments are disabled'
      : authState.authenticated
        ? 'Leave a comment for this room'
        : 'Sign in to comment on rooms';
    this.renderCounter();
  }

  private renderCounter(): void {
    if (!this.elements) return;
    this.elements.counter.textContent =
      `${this.elements.input.value.length}/${ROOM_COMMENT_MAX_LENGTH}`;
  }

  private getAuthState(): RoomCommentsComposerAuthState {
    return (this.options.getAuthState ?? getAuthDebugState)();
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export type { RoomCommentRecord };
