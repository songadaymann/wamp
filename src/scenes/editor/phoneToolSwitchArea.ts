import { uncoveredMapArea, type MapArea, type ScreenRect } from './composerMap';

/** The landscape phone Draw/Erase column from the stage's left edge: an 8px gap, 44px wide, 8px clear (F369). */
export const PHONE_TOOL_SWITCH_RESERVE_PX = 60;

/**
 * The part of the stage the phone Draw/Erase switch leaves clear, in camera pixels. In landscape
 * the switch is a column at the stage's left edge, so a fit keeps rooms to its right. The column
 * is reserved even while the library sheet hides it, so it never lands on a room when it shows.
 */
export function toolSwitchClearArea(canvas: ScreenRect, landscapeColumn: boolean, column: ScreenRect | null,
  viewWidth: number, viewHeight: number): MapArea {
  if (!landscapeColumn) return { x: 0, y: 0, width: viewWidth, height: viewHeight };
  // A shown column is measured, so larger text and the notch inset are counted.
  const right = column && column.width > 0 ? column.left + column.width + 8 : canvas.left + PHONE_TOOL_SWITCH_RESERVE_PX;
  return uncoveredMapArea(canvas, { left: canvas.left, top: canvas.top, width: right - canvas.left, height: canvas.height },
    viewWidth, viewHeight);
}

/** The same, read from the page around an editor's canvas. */
export function phoneToolSwitchClearArea(canvas: HTMLCanvasElement, viewWidth: number, viewHeight: number): MapArea {
  const doc = canvas.ownerDocument;
  const { deviceClass, orientationState, editorDockShell } = doc.body.dataset;
  return toolSwitchClearArea(canvas.getBoundingClientRect(),
    deviceClass === 'phone' && orientationState === 'landscape' && editorDockShell === 'true',
    doc.getElementById('editor-phone-draw-switch')?.getBoundingClientRect() ?? null, viewWidth, viewHeight);
}
