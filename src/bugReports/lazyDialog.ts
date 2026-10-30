import { LazyModal } from '../ui/setup/lazyModal';
import type { BugReportDialog } from './reporter';

/**
 * The Report a bug form, its replay player and its sender download on the first Report click
 * instead of at boot (F319). The recent replay keeps recording from boot, so a report still
 * shows what just happened. Gameplay stays paused while the form downloads. A failed download
 * (offline, or a tab left open across a release) calls `onLoadError`, which offers a reload: the
 * browser keeps the failed file for the page, so trying again without one fails the same way.
 */
export function installLazyBugReportDialog(options: {
  buttons: Iterable<EventTarget>;
  load: () => Promise<BugReportDialog>;
  onLoadError: (error: unknown) => void;
}): { isOpen(): boolean; destroy(): void } {
  let dialog: BugReportDialog | null = null, destroyed = false;
  const modal = new LazyModal<BugReportDialog>(async () => {
    const loaded = await options.load();
    if (destroyed) loaded.destroy();
    else dialog = loaded;
    return loaded;
  }, [], options.onLoadError);
  const open = (): void => { void modal.open(); };
  const buttons = [...options.buttons];
  buttons.forEach(button => button.addEventListener('click', open));
  return {
    isOpen: () => dialog?.isOpen() ?? false,
    destroy(): void {
      destroyed = true;
      buttons.forEach(button => button.removeEventListener('click', open));
      modal.destroy();
    },
  };
}
