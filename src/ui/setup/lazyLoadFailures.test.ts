import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
const feedback = vi.hoisted(() => ({ free: true }));
vi.mock('../appFeedback', async (original) => ({ ...await original<object>(), showBusyError: vi.fn(), canReplaceBusyCard: () => feedback.free }));
vi.mock('../../main/clientErrorReporter', () => ({ reportClientError: vi.fn() }));
import { showBusyError } from '../appFeedback';
import { reportClientError } from '../../main/clientErrorReporter';
import { explainMenuLoadFailure, LazyModal } from './lazyModal';
import { hasPendingDialog } from '../pendingDialog';

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); feedback.free = true; });

/** Each `new LazyModal(` / `new LazyRecoveryController(` in controllers.ts, by the name it is stored under. */
function lazyConstructions(source: string): Map<string, string> {
  const found = new Map<string, string>(), step: Record<string, number> = { '(': 1, ')': -1 };
  for (const match of source.matchAll(/(?:const (\w+) = |(\w+): )new (?:LazyModal|LazyRecoveryController)\(/g)) {
    let depth = 1, end = match.index + match[0].length;
    while (depth > 0 && end < source.length) depth += step[source[end++]] ?? 0;
    found.set(match[1] ?? match[2], source.slice(match.index, end));
  }
  return found;
}

it('explains every on-demand menu in controllers.ts that fails to download, by its player-facing name', () => {
  const source = readFileSync(new URL('./controllers.ts', import.meta.url), 'utf8');
  const names = Object.fromEntries([...lazyConstructions(source)].map(([key, call]) =>
    [key, /explainMenuLoadFailure\('([^']+)'\)\)$/.exec(call)?.[1] ?? 'missing']));
  expect(names).toEqual({
    leaderboardModal: 'Leaderboard', controlsModal: 'controls list', exploreModal: 'Explore page', roomRushResultModal: 'Room Rush results',
    guestProgressClaimModal: 'Guest Clears list', historyModal: 'version history', guestBuilderClaimModal: 'sign-in prompt',
    guestRoomRecoveryModal: 'Guest Drafts list', guestbookModal: 'Guestbook', aboutModal: 'About page', chatModerationModal: 'chat moderation tools',
    profileModal: 'profile', playlistModal: 'playlist', roomRushModal: 'Room Rush', signTextModal: 'sign editor', wampOGramModal: 'Wamp-O-Gram',
  });
});

it('an Explore download that fails shows one card and one report, and leaves nothing paused', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const explore = new LazyModal<{ init(): void; open(tab?: string): void; close(): void }>(
    () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')), [], explainMenuLoadFailure('Explore page'));
  await expect(explore.open('unrated')).resolves.toBeUndefined();
  expect(showBusyError).toHaveBeenCalledExactlyOnceWith(
    "The Explore page couldn't load. Check your connection, then reload WAMP. Save anything you are working on first.",
    expect.objectContaining({ title: 'Explore page', retryLabel: 'Reload', closeLabel: 'Not now' }));
  expect(reportClientError).toHaveBeenCalledOnce();
  expect(vi.mocked(reportClientError).mock.lastCall![0].message).toBe('Explore page failed to load: Failed to fetch dynamically imported module');
  expect(hasPendingDialog()).toBe(false);
});

it('a common-noun name reads in lower case in the sentence and starts the title with a capital', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const history = new LazyModal<{ init(): void; open(): void; close(): void }>(() => Promise.reject(new Error('offline')), [], explainMenuLoadFailure('version history'));
  await history.open();
  expect(showBusyError).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^The version history couldn't load\./), expect.objectContaining({ title: 'Version history' }));
});

it('an Explore failure over a save in progress or an open choice is reported without a card', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  feedback.free = false;
  const explore = new LazyModal<{ init(): void; open(): void; close(): void }>(() => Promise.reject(new Error('offline')), [], explainMenuLoadFailure('Explore page'));
  await explore.open();
  expect(showBusyError).not.toHaveBeenCalled();
  expect(reportClientError).toHaveBeenCalledOnce();
});
