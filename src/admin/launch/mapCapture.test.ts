import { describe, expect, it, vi } from 'vitest';
import { setupMapCaptureAdmin } from './mapCapture';
import type { CaptureResult } from '../../mapScreenshot/capture';
class Element extends EventTarget {
  disabled = false; hidden = false; href = ''; textContent = '';
  removeAttribute(name: string) { if (name === 'href') this.href = ''; }
  click() { this.dispatchEvent(new Event('click')); }
}
const tick = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
function setup() {
  let key = ''; const button = new Element(), status = new Element(), link = new Element();
  const elements = { 'map-capture-button': button, 'map-capture-status': status, 'map-capture-result': link };
  const request = vi.fn(async (_path: string, _init?: RequestInit): Promise<CaptureResult> => ({ ok: true, fileName: '2026_10_19_1.png' }));
  const controller = setupMapCaptureAdmin(() => key, { getElementById: (id: keyof typeof elements) => elements[id] } as unknown as Document, { request: request as unknown as <T>() => Promise<T> });
  return { button, status, link, request, controller, setKey(value: string) { key = value; controller.refresh(); } };
}
describe('map capture admin control', () => {
  it('requires a key, prevents duplicate clicks and opens only a validated same-site file', async () => {
    const f = setup(); expect(f.button.disabled).toBe(true); f.setKey('fixture-key'); expect(f.button.disabled).toBe(false);
    f.button.click(); f.button.click(); expect(f.button.disabled).toBe(true); await tick();
    expect(f.request).toHaveBeenCalledOnce(); expect(f.request).toHaveBeenCalledWith('/api/admin/map-screenshot/capture', expect.objectContaining({ method: 'POST', body: '{}' }));
    expect(f.link.href).toBe('/capture/files/2026_10_19_1.png'); expect(f.link.hidden).toBe(false); expect(f.button.disabled).toBe(false); f.controller.destroy();
  });
  it('keeps failed/busy messages actionable and allows a deliberate retry', async () => {
    const f = setup(); f.setKey('fixture-key'); f.request.mockRejectedValueOnce(new Error('A map capture is already running.'));
    f.button.click(); await tick(); expect(f.status.textContent).toContain('already running'); expect(f.button.disabled).toBe(false); expect(f.link.hidden).toBe(true);
    f.button.click(); await tick(); expect(f.status.textContent).toContain('Saved'); f.controller.destroy();
  });
  it('aborts and fences delayed results when a key is cleared or replaced', async () => {
    const f = setup(); f.setKey('first'); let resolve!: (value: CaptureResult) => void;
    f.request.mockImplementationOnce(() => new Promise(r => { resolve = r; })); f.button.click();
    const signal = f.request.mock.calls[0]![1]?.signal as AbortSignal;
    f.setKey(''); expect(signal.aborted).toBe(true); resolve({ ok: true, fileName: '2026_10_19_1.png' }); await tick();
    expect(f.link.hidden).toBe(true); expect(f.link.href).toBe(''); expect(f.button.disabled).toBe(true); expect(f.status.textContent).toContain('admin key');
    f.controller.destroy();
  });
});
