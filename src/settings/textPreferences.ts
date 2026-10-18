import { getGameSettings, subscribeGameSettings } from './userSettings';
import type { GameSettings } from './model';

type TextPreferences = Pick<GameSettings, 'textStyle' | 'textSize'>;

export function applyTextPreferences(settings: TextPreferences, doc: Document): void {
  doc.body.dataset.textStyle = settings.textStyle;
  doc.body.dataset.textSize = settings.textSize;
}

export function resolveTextSize(size: number, settings: TextPreferences): number {
  if ((settings.textStyle === 'pixel' && settings.textSize === 'normal') || size > 20) return size;
  if (size >= 16) return 20;
  if (size >= 12 || settings.textSize === 'large') return 16;
  return 12;
}

interface CanvasText {
  active: boolean;
  scene: unknown;
  setStyle(style: { fontFamily: string; fontSize: string }): unknown;
  updateText(): unknown;
  once(event: 'destroy', listener: () => void): unknown;
}

/** Keep existing world labels in sync, and release their listener with the label. */
export function bindCanvasTextPreferences(label: CanvasText, family: string, size: number): void {
  let lastStyle = '';
  const apply = (settings: TextPreferences) => {
    const fontFamily = settings.textStyle === 'readable' ? '"IBM Plex Mono", monospace' : family;
    const fontSize = `${resolveTextSize(size, settings)}px`;
    const key = `${fontFamily}:${fontSize}`;
    if (key === lastStyle) return;
    lastStyle = key;
    label.setStyle({ fontFamily, fontSize });
    if (typeof document !== 'undefined' && document.fonts?.load) {
      void document.fonts.load(`${fontSize} ${fontFamily}`).then(() => {
        if (label.active && label.scene) label.updateText();
      }).catch(() => { /* The readable system fallback remains available offline. */ });
    }
  };
  apply(getGameSettings());
  label.once('destroy', subscribeGameSettings(apply));
}
