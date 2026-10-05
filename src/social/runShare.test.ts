import { describe, expect, it } from 'vitest';
import type { PostRunRatingRequestDetail } from '../progression/postRunRatingEvents';
import { buildAttributedRoomShareUrl } from './roomShareLinks';
import { buildRunShareText, buildRunShareUrl } from './runShare';

const base = { contentId: 'completed', contentTitle: 'Cybertowers', version: 3, previousViewerRank: null,
  elapsedMs: 41250, deaths: 0, score: null, autoSuggestedDifficulty: 'medium' as const };
describe('completed level invitations', () => {
  it('drops draft, renderer, welcome, coordinates and fragment parameters and adds attribution once', () => {
    expect(buildAttributedRoomShareUrl({ x: -4, y: 12 }, 'https://wamp.land/?draft=private&renderer=canvas&welcome=0&x=1&y=2&from=old#editor'))
      .toBe('https://wamp.land/r/-4/12?from=share');
  });
  it('uses the finished room even after the address bar has moved elsewhere', () => {
    const detail: PostRunRatingRequestDetail = { ...base, contentType: 'room', roomCoordinates: { x: -11, y: -6 } };
    expect(buildRunShareUrl(detail, 'https://wamp.land/r/99/99?world=3')).toBe('https://wamp.land/r/-11/-6?from=share');
  });
  it.each(['expanded_room', 'course'] as const)('uses the captured %s start rather than the current address', contentType => {
    const detail: PostRunRatingRequestDetail = { ...base, contentType, expandedRoomId: 'expanded', shareCoordinates: { x: -4, y: 12 } };
    expect(buildRunShareUrl(detail, 'https://wamp.land/r/99/99?from=old')).toBe('https://wamp.land/r/-4/12?from=share');
    expect(buildRunShareText(detail, ' Cybertowers\n')).toBe('I beat "Cybertowers" in WAMP in 41.3 seconds. Can you do better?');
  });
  it.each(['expanded_room', 'course'] as const)('declines an old %s result without a known destination', contentType => {
    expect(buildRunShareUrl({ ...base, contentType, expandedRoomId: 'expanded' }, 'https://wamp.land/r/99/99')).toBeNull();
  });
  it('names an untitled legacy expanded result truthfully', () => {
    expect(buildRunShareText({ ...base, contentType: 'course', expandedRoomId: 'legacy' }, null)).toContain('this Expanded Room');
    expect(buildRunShareText({ ...base, contentType: 'course' }, null)).toContain('this course');
  });
});
