import type Phaser from 'phaser';
import { ensureEditorStylesReady } from './editorStyles';

/** What the editor UI needs from the always-loaded UI. */
export interface EditorUiHost {
  closePanels(): void;
  openHistory(): void;
}

let host: EditorUiHost | null = null;
let ready: Promise<void> | null = null;

/** Called at boot by the always-loaded UI. */
export function configureEditorUiHost(nextHost: EditorUiHost): void {
  host = nextHost;
}

/**
 * The builder's palette, dock, sprite and music editors, the Expanded Room composer panel
 * and the editor UI bridge load with the editor scenes instead of at boot (F019). A failed
 * download can be retried; setup itself runs once.
 */
export function ensureEditorUiReady(game: Phaser.Game): Promise<void> {
  ready ??= Promise.all([import('./editorUi'), ensureEditorStylesReady()])
    .catch((error: unknown) => {
      ready = null;
      throw error;
    })
    .then(([{ setupEditorUi }]) => {
      if (!host) throw new Error('The editor UI host is not configured.');
      setupEditorUi(game, host);
    });
  return ready;
}
