type MusicTextLabel = {
  text: string;
  alpha: number;
  style: { color?: unknown };
  setText(text: string): unknown;
  setColor(color: string): unknown;
  setAlpha(alpha: number): unknown;
};

/** Phaser redraws a text texture on setColor even when the color is unchanged. */
export function syncMusicLabelStyle(
  label: MusicTextLabel | null,
  next: { text: string; color: string; alpha: number },
): void {
  if (!label) return;
  if (label.text !== next.text) label.setText(next.text);
  if (label.style.color !== next.color) label.setColor(next.color);
  if (label.alpha !== next.alpha) label.setAlpha(next.alpha);
}
