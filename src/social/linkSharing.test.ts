import { describe, expect, it, vi } from 'vitest';
import { copyShareLink, shareLink } from './linkSharing';

const payload = { title: 'WAMP clear', text: 'I beat this level.', url: 'https://wamp.land/r/-4/12?from=share' };
function fixture() {
  const input = { value: '', style: {}, select: vi.fn(), remove: vi.fn() };
  const doc = { activeElement: { focus: vi.fn() }, body: { append: vi.fn() }, createElement: vi.fn(() => input), execCommand: vi.fn(() => true) };
  const navigatorObj = { share: vi.fn().mockResolvedValue(undefined), canShare: vi.fn(() => false), clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } };
  return { doc, navigatorObj, input, document: doc as unknown as Document, navigator: navigatorObj as unknown as Navigator };
}
describe('native sharing and clipboard fallback', () => {
  it('opens a text share sheet even without file support', async () => {
    const f = fixture(), file = new File(['image'], 'clear.png', { type: 'image/png' });
    expect(await shareLink(f.document, f.navigator, { ...payload, files: [file] })).toBe('shared');
    expect(f.navigatorObj.share).toHaveBeenCalledWith(payload);
    expect(f.navigatorObj.clipboard.writeText).not.toHaveBeenCalled();
  });
  it('includes supported snapshot files', async () => {
    const f = fixture(), files = [new File(['image'], 'clear.png')]; f.navigatorObj.canShare.mockReturnValue(true);
    await shareLink(f.document, f.navigator, { ...payload, files });
    expect(f.navigatorObj.share).toHaveBeenCalledWith({ ...payload, files });
  });
  it('shares text when file capability detection throws', async () => {
    const f = fixture(); f.navigatorObj.canShare.mockImplementation(() => { throw new Error('Capability unavailable'); });
    await shareLink(f.document, f.navigator, { ...payload, files: [new File(['x'], 'x.png')] });
    expect(f.navigatorObj.share).toHaveBeenCalledWith(payload);
  });
  it('leaves cancellation quiet without copying or opening another destination', async () => {
    const f = fixture(); f.navigatorObj.share.mockRejectedValue({ name: 'AbortError' });
    expect(await shareLink(f.document, f.navigator, payload)).toBe('canceled');
    expect(f.navigatorObj.clipboard.writeText).not.toHaveBeenCalled(); expect(f.doc.execCommand).not.toHaveBeenCalled();
  });
  it.each(['missing', 'rejected'])('copies the URL when native share is %s', async mode => {
    const f = fixture();
    if (mode === 'missing') Object.defineProperty(f.navigatorObj, 'share', { value: undefined });
    else f.navigatorObj.share.mockRejectedValue(new Error('Share unavailable'));
    expect(await shareLink(f.document, f.navigator, payload)).toBe('copied');
    expect(f.navigatorObj.clipboard.writeText).toHaveBeenCalledWith(payload.url);
  });
  it('uses legacy copying after clipboard rejection and restores focus', async () => {
    const f = fixture(); f.navigatorObj.clipboard.writeText.mockRejectedValue(new Error('Permission denied'));
    await copyShareLink(f.document, f.navigator, payload.url);
    expect(f.input.value).toBe(payload.url); expect(f.doc.execCommand).toHaveBeenCalledWith('copy');
    expect(f.input.remove).toHaveBeenCalledOnce(); expect(f.doc.activeElement.focus).toHaveBeenCalledOnce();
  });
  it('reports failure when legacy copying returns false and still removes its temporary input', async () => {
    const f = fixture(); f.navigatorObj.clipboard.writeText.mockRejectedValue(new Error('Permission denied')); f.doc.execCommand.mockReturnValue(false);
    await expect(copyShareLink(f.document, f.navigator, payload.url)).rejects.toThrow('Clipboard unavailable');
    expect(f.input.remove).toHaveBeenCalledOnce();
  });
  it('reports missing clipboard APIs', async () => {
    await expect(copyShareLink({} as Document, {} as Navigator, payload.url)).rejects.toThrow('Clipboard unavailable');
  });
});
