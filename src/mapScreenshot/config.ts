/**
 * Map screenshot tunables.
 *
 * Change these defaults when you want different padding, zoom smoothing,
 * resolution, or schedule behavior. Redeploy the map-screenshot Worker after edits.
 */

/** Extra published-room padding on each side (left/right/top/bottom). Default: 2 */
export const PADDING_ROOMS = 2;

/**
 * Max absolute zoom change from the previous screenshot's zoom.
 * Limits sudden jumps in a time-lapse. Default: 0.005
 */
export const MAX_ZOOM_DELTA_PER_DAY = 0.005;

/** Output width in pixels. Default: 3840 (4K) */
export const SCREENSHOT_WIDTH = 3840;

/** Output height in pixels. Default: 2160 (4K) */
export const SCREENSHOT_HEIGHT = 2160;

/**
 * Cron expression for automatic capture (Wrangler `triggers.crons`).
 * Default: "0 10 * * *" — 10:00 UTC ≈ 6:00 AM Eastern during EDT.
 * Note: during EST (winter) the same UTC cron is 5:00 AM Eastern.
 */
export const AUTO_CAPTURE_CRON = '0 10 * * *';

/** Manual screenshots allowed per Eastern-calendar day (`_1` … `_9`). Default: 9 */
export const MAX_MANUAL_SHOTS_PER_DAY = 9;

/** Room size in world pixels (matches WAMP room geometry; do not change lightly). */
export const ROOM_PX_WIDTH = 640;
export const ROOM_PX_HEIGHT = 352;
export const GAME_TILE_PX = 16;

/** Backdrop behind transparent empty tile cells (overworld starfield base). */
export const SCREENSHOT_BACKGROUND = '#050505';

/** R2 object that stores the last applied zoom for gradual adjustment. */
export const STATE_OBJECT_KEY = 'state.json';

/** Prefix for screenshot PNGs inside the R2 bucket (acts like a folder). */
export const SCREENSHOT_KEY_PREFIX = 'screenshots/';

/** Refuse to fetch more than this many tiles for one stitch (safety). */
export const MAX_STITCH_TILES = 96;
