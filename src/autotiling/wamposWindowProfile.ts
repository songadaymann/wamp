import type { LayerName } from '../config/room';
import type { SmartWamposBrushId } from './model';

/** Artist reference: -11,10 v6, regular window at (21,5), 16 by 13 cells. */
export const WAMPOS_WINDOW_MINIMUM = { width: 5, height: 6 } as const;

export function getWamposMinimumSize(brushId: SmartWamposBrushId): { width: number; height: number } {
  if (brushId === 'wampos95.alert') return { width: 3, height: 3 };
  if (brushId === 'wampos95.start-bar') return { width: 8, height: 1 };
  return WAMPOS_WINDOW_MINIMUM;
}

/** Inactive title in -13,10 v3 and the alert in -11,10 v6. */
export const WAMPOS_INACTIVE_TITLE_TILES = { titleLeft: 7, title: 8, titleRight: 9 } as const; // A8/A9/A10
export const WAMPOS_ALERT_TILES = {
  ...WAMPOS_INACTIVE_TITLE_TILES,
  left: 12, content: 40, right: 21, // B1/D5/B10
  bottomLeft: 84, bottom: 85, bottomRight: 86, // H1/H2/H3
} as const;
/** The blank Start frame and four-cell tray from -13,10, with manual clock text removed. */
export const WAMPOS_START_BAR_TILES = {
  startLeft: 120, start: 121, startRight: 122, // K1/K2/K3
  strip: 126, trayLeft: 127, tray: 128, trayRight: 129, // K7/K8/K9/K10
} as const;

/** WampOS 95 sheet coordinates, 12 columns. Text and application icons are manual. */
export const WAMPOS_WINDOW_TILES = {
  titleLeft: 4, // A5
  title: 5, // A6
  titleRight: 6, // A7
  menuLeft: 12, // B1
  menu: 40, // D5: blank grey, as used in the artist's menu row
  menuRight: 21, // B10
  contentTopLeft: 24, // C1
  contentTop: 25, // C2
  contentLeft: 36, // D1
  content: 37, // D2
  scrollUp: 33, // C10
  scrollVerticalThumb: 45, // D10
  scrollVerticalThumbEnd: 57, // E10
  scrollVerticalTrack: 69, // F10
  scrollDown: 81, // G10
  scrollLeft: 88, // H5
  scrollHorizontalThumb: 89, // H6
  scrollHorizontalThumbEnd: 90, // H7
  scrollHorizontalTrack: 91, // H8
  scrollRight: 92, // H9
  resizeGrip: 93, // H10
} as const;

export interface WamposWindowTile {
  localIndex: number;
  layer: LayerName;
}

/** Position grammar for a complete window, with authored scrollbar ends and thumbs. */
export function resolveWamposWindowTile(
  x: number,
  y: number,
  width: number,
  height: number,
  sourceLayer: LayerName = 'terrain',
  inactive = false,
): WamposWindowTile {
  const t = WAMPOS_WINDOW_TILES;
  let localIndex: number;
  let content = false;
  if (y === 0) {
    const title = inactive ? WAMPOS_INACTIVE_TITLE_TILES : t;
    localIndex = x === 0 ? title.titleLeft : x === width - 1 ? title.titleRight : title.title;
  } else if (y === 1) {
    localIndex = x === 0 ? t.menuLeft : x === width - 1 ? t.menuRight : t.menu;
  } else if (y === height - 1) {
    const thumbLength = Math.max(1, Math.min(width - 4, Math.round((width - 3) * 0.6)));
    localIndex = x === 0 ? t.scrollLeft
      : x === width - 1 ? t.resizeGrip
        : x === width - 2 ? t.scrollRight
          : x < thumbLength ? t.scrollHorizontalThumb
            : x === thumbLength ? t.scrollHorizontalThumbEnd : t.scrollHorizontalTrack;
  } else if (x === width - 1) {
    const thumbLength = Math.max(1, Math.min(height - 6, Math.round((height - 5) * 0.6)));
    localIndex = y === 2 ? t.scrollUp
      : y === height - 2 ? t.scrollDown
        : y < 2 + thumbLength ? t.scrollVerticalThumb
          : y === 2 + thumbLength ? t.scrollVerticalThumbEnd : t.scrollVerticalTrack;
  } else if (y === 2) {
    localIndex = x === 0 ? t.contentTopLeft : t.contentTop;
  } else if (x === 0) {
    localIndex = t.contentLeft;
  } else {
    localIndex = t.content;
    content = true;
  }
  // The artist uses Terrain chrome and Background white, leaving Terrain/Front
  // available for manual contents. Back/Front placement keeps the whole window
  // on that layer so the white never covers the player from a companion layer.
  return { localIndex, layer: content && sourceLayer === 'terrain' ? 'background' : sourceLayer };
}

export function resolveWamposTile(
  brushId: SmartWamposBrushId,
  x: number,
  y: number,
  width: number,
  height: number,
  sourceLayer: LayerName,
): WamposWindowTile {
  if (brushId === 'wampos95.start-bar') {
    const t = WAMPOS_START_BAR_TILES;
    const localIndex = x === 0 ? t.startLeft : x === 1 ? t.start : x === 2 ? t.startRight
      : x === width - 4 ? t.trayLeft : x === width - 1 ? t.trayRight
        : x > width - 4 ? t.tray : t.strip;
    return { localIndex, layer: sourceLayer };
  }
  if (brushId === 'wampos95.alert') {
    const t = WAMPOS_ALERT_TILES;
    const content = x > 0 && x < width - 1 && y > 0 && y < height - 1;
    const localIndex = y === 0
      ? x === 0 ? t.titleLeft : x === width - 1 ? t.titleRight : t.title
      : y === height - 1
        ? x === 0 ? t.bottomLeft : x === width - 1 ? t.bottomRight : t.bottom
        : x === 0 ? t.left : x === width - 1 ? t.right : t.content;
    return { localIndex, layer: content && sourceLayer === 'terrain' ? 'background' : sourceLayer };
  }
  return resolveWamposWindowTile(x, y, width, height, sourceLayer, brushId === 'wampos95.inactive-window');
}
