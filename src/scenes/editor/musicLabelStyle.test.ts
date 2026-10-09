import { describe, expect, it, vi } from 'vitest';
import { syncMusicLabelStyle } from './musicLabelStyle';

function label() {
  return {
    text: '', alpha: 1, style: { color: '#old' },
    setText: vi.fn(function (this: { text: string }, value: string) { this.text = value; }),
    setAlpha: vi.fn(function (this: { alpha: number }, value: number) { this.alpha = value; }),
    setColor: vi.fn(function (this: { style: { color: string } }, value: string) { this.style.color = value; }),
  };
}

describe('music label texture updates', () => {
  it('performs no repeated text/color/alpha mutations across unchanged frames', () => {
    const text = label(); const next = { text: 'C4', color: '#56cfde', alpha: 0.92 };
    for (let frame = 0; frame < 120; frame++) syncMusicLabelStyle(text, next);
    expect(text.setText).toHaveBeenCalledOnce(); expect(text.setColor).toHaveBeenCalledOnce(); expect(text.setAlpha).toHaveBeenCalledOnce();
  });

  it('updates only changed values and notices external label changes', () => {
    const text = label(); const next = { text: 'PAN C · VOL 100%', color: '#56cfde', alpha: 0.92 };
    syncMusicLabelStyle(text, next); vi.clearAllMocks();
    syncMusicLabelStyle(text, { ...next, text: 'PAN R50 · VOL 100%' });
    expect(text.setText).toHaveBeenCalledOnce(); expect(text.setColor).not.toHaveBeenCalled(); expect(text.setAlpha).not.toHaveBeenCalled();
    vi.clearAllMocks(); text.style.color = '#outside'; text.alpha = 0.2;
    syncMusicLabelStyle(text, { ...next, text: text.text });
    expect(text.setText).not.toHaveBeenCalled(); expect(text.setColor).toHaveBeenCalledWith(next.color); expect(text.setAlpha).toHaveBeenCalledWith(next.alpha);
  });

  it('does not retain destroyed labels and applies a new theme once per label', () => {
    syncMusicLabelStyle(null, { text: '', color: '#fff', alpha: 1 });
    const labels = Array.from({ length: 24 }, label);
    for (const text of labels) syncMusicLabelStyle(text, { text: 'A3', color: '#fff', alpha: 1 });
    for (const text of labels) syncMusicLabelStyle(text, { text: 'A3', color: '#f6e8c9', alpha: 1 });
    for (let frame = 0; frame < 120; frame++) for (const text of labels) syncMusicLabelStyle(text, { text: 'A3', color: '#f6e8c9', alpha: 1 });
    expect(labels.every(text => text.setColor.mock.calls.length === 2 && text.setText.mock.calls.length === 1)).toBe(true);
  });
});
