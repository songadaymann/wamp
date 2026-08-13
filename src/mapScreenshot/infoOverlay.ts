/**
 * Info overlay for map screenshots.
 *
 * Edit `infoOverlay.html` for layout/copy, then keep the TEMPLATE string below
 * in sync (Workers bundle this module; the .html file is the human-editable source).
 */

/** Keep in sync with `infoOverlay.html`. Title is hardcoded (game name does not change). */
export const INFO_OVERLAY_TEMPLATE = `<div class="map-shot-info">
  <div class="map-shot-info__title">We All Make A<br>Platformer</div>
  <div class="map-shot-info__body">
    <div class="map-shot-info__date">{{DATE}}</div>
    <div class="map-shot-info__line">Players: <span class="value">{{PLAYERS}}</span></div>
    <div class="map-shot-info__line">Builders: <span class="value">{{BUILDERS}}</span></div>
    <div class="map-shot-info__line">Rooms Built: <span class="value">{{ROOMS}}</span></div>
  </div>
</div>
<style>
  .map-shot-info {
    display: inline-block;
    box-sizing: border-box;
    margin: 0;
    padding: 22px 28px 24px;
    border: 5px solid #ffffff;
    border-radius: 0;
    background: rgba(5, 5, 5, 0.78);
    text-align: left;
    white-space: nowrap;
  }
  .map-shot-info__title {
    margin: 0 0 14px;
    font-family: 'Early Gameboy', monospace;
    font-size: 36px;
    line-height: 1.2;
    letter-spacing: 0.02em;
    color: rgb(252, 234, 124);
  }
  .map-shot-info__body {
    font-family: 'HomeVideo', 'Courier New', monospace;
    font-size: 28px;
    line-height: 1.45;
    color: #a89f8f;
  }
  .map-shot-info__date {
    margin: 0 0 4px;
    font-family: 'HomeVideo', 'Courier New', monospace;
    font-size: 32px;
    line-height: 1.45;
    color: #79ccde;
  }
  .map-shot-info__line {
    margin: 0;
  }
  .map-shot-info__line .value {
    color: #f65699;
  }
</style>
`;

/** Bottom-right brand mark (drawn separately in stitch, not inside the info box). */
export const CORNER_MARK_TEXT = 'WAMP.LAND';
/** Plan: 100px Early GameBoy in #faaa39, 50px from bottom-right. */
export const CORNER_MARK_FONT_SIZE_PX = 100;
export const CORNER_MARK_COLOR = '#faaa39';

export interface InfoOverlayValues {
  date: string;
  players: number | string;
  builders: number | string;
  rooms: number | string;
}

export function fillInfoOverlayTemplate(
  values: InfoOverlayValues,
  template: string = INFO_OVERLAY_TEMPLATE,
): string {
  return template
    .replace(/\{\{DATE\}\}/g, escapeHtml(String(values.date)))
    .replace(/\{\{PLAYERS\}\}/g, escapeHtml(formatCount(values.players)))
    .replace(/\{\{BUILDERS\}\}/g, escapeHtml(formatCount(values.builders)))
    .replace(/\{\{ROOMS\}\}/g, escapeHtml(formatCount(values.rooms)));
}

export function buildFontFaceCss(input: {
  earlyGameboyDataUrl: string;
  homeVideoDataUrl: string;
}): string {
  return `
@font-face {
  font-family: 'Early Gameboy';
  src: url('${input.earlyGameboyDataUrl}') format('truetype');
  font-display: block;
}
@font-face {
  font-family: 'HomeVideo';
  src: url('${input.homeVideoDataUrl}') format('truetype');
  font-display: block;
}
`.trim();
}

function formatCount(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat('en-US').format(n);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
