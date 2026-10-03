import { hideBusyOverlay, showBusyError } from '../../ui/appFeedback';

/** Restore only changes the local editor. The builder still decides when to Save to the account. */
export function chooseLocalDraftRecovery(label: string): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (restore: boolean): void => {
      hideBusyOverlay();
      resolve(restore);
    };
    showBusyError(
      `The account draft for ${label} changed after this device's backup was made. Restore the local changes for review, or use the account draft?`,
      {
        title: 'Recover unsaved changes?',
        retryLabel: 'Restore Local',
        retryHandler: () => finish(true),
        closeLabel: 'Use Account Draft',
        closeHandler: () => finish(false),
      },
    );
  });
}
