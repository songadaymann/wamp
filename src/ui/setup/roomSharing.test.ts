import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomSharingController } from './roomSharing';

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const classes = new Set(['hidden']);
  const status = { textContent: '', classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } };
  const doc = { getElementById: () => status };
  const navigator = { share: vi.fn().mockResolvedValue(undefined), clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } };
  const win = { location: { href: 'https://wamp.land/r/99/99?draft=private' }, navigator, setTimeout, clearTimeout };
  const context = { roomId: '-4,12', coordinates: { x: -4, y: 12 }, shareTitle: 'Cybertowers', state: 'published' as const,
    courseId: null, courseTitle: null, courseGoalType: null, courseRoomCount: null };
  const getContext = vi.fn(() => context);
  return { classes, status, doc, navigator, win, context, getContext,
    controller: new RoomSharingController(getContext, doc as unknown as Document, win as unknown as Window) };
}
describe('selected-room sharing', () => {
  it('shares the selected published room and title rather than the browser address', async () => {
    const f = fixture(); await f.controller.shareSelectedRoom();
    expect(f.navigator.share).toHaveBeenCalledWith({ title: 'Cybertowers', text: 'Come play "Cybertowers" in WAMP.', url: 'https://wamp.land/r/-4/12?from=share' });
    expect(f.status.textContent).toBe('Shared.'); expect(f.classes.has('hidden')).toBe(false);
    await vi.advanceTimersByTimeAsync(5000); expect(f.classes.has('hidden')).toBe(true);
  });
  it('copies a link and shows confirmation when native sharing is absent', async () => {
    const f = fixture(); Object.defineProperty(f.navigator, 'share', { value: undefined }); await f.controller.shareSelectedRoom();
    expect(f.navigator.clipboard.writeText).toHaveBeenCalledWith('https://wamp.land/r/-4/12?from=share');
    expect(f.status.textContent).toBe('Room link copied.');
  });
  it('does not copy after the player cancels the sheet', async () => {
    const f = fixture(); f.navigator.share.mockRejectedValue({ name: 'AbortError' }); await f.controller.shareSelectedRoom();
    expect(f.status.textContent).toBe('Share canceled.'); expect(f.navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
  it.each(['draft', 'claimed_unpublished', 'frontier', 'empty'] as const)('keeps a private or %s cell out of public sharing', async state => {
    const f = fixture(); f.getContext.mockReturnValue({ ...f.context, state } as never); await f.controller.shareSelectedRoom();
    expect(f.navigator.share).not.toHaveBeenCalled(); expect(f.navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(f.classes.has('hidden')).toBe(true);
  });
  it('shows a selectable real link when sharing and copying both fail', async () => {
    const f = fixture(); f.navigator.share.mockRejectedValue(new Error('Unavailable')); f.navigator.clipboard.writeText.mockRejectedValue(new Error('Blocked'));
    await f.controller.shareSelectedRoom(); expect(f.status.textContent).toBe('Copy this link: https://wamp.land/r/-4/12?from=share');
  });
});
