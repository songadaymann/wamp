import { explainMenuLoadFailure } from '../ui/setup/lazyModal';
import type { ReportTarget } from './model';

/** Opens the shared Report dialog; its code downloads on first use. Null asks the player to pick a room. */
export function requestReport(target: ReportTarget | null): void {
  void import('./reportDialog')
    .then(({ openReportDialog }) => openReportDialog(target), explainMenuLoadFailure('report form'));
}
