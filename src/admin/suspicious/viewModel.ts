import type { SuspiciousSeverity, SuspiciousUserCase } from '../model';

export type SuspiciousQueueTab = 'all' | 'real_players' | 'generated_signals';

export function filterSuspiciousUsers(
  users: SuspiciousUserCase[],
  tab: SuspiciousQueueTab,
): SuspiciousUserCase[] {
  return tab === 'all' ? users : users.filter((user) => user.identity.bucket === tab);
}

export function countSuspiciousQueueTabs(
  users: SuspiciousUserCase[],
): Record<SuspiciousQueueTab, number> {
  return {
    all: users.length,
    real_players: users.filter((user) => user.identity.bucket === 'real_players').length,
    generated_signals: users.filter((user) => user.identity.bucket === 'generated_signals').length,
  };
}

export function getSuspiciousIdentityTone(user: SuspiciousUserCase): SuspiciousSeverity {
  switch (user.identity.kind) {
    case 'generated_only':
      return 'high';
    case 'legacy_generated_linked':
    case 'generated_name_heuristic':
      return 'medium';
    case 'no_generated_signal':
    default:
      return 'low';
  }
}
