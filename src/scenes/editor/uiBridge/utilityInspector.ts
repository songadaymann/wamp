import { listRollingBallGraphics } from '../../../config/rollingBall';
import { triangleFlipFromOrient } from '../../../config/trianglePiece';
import { EditorColorPopover } from '../colorPopover';
import {
  INSPECTOR_WINDOWS_RESET_EVENT,
  inspectorWindowLabel,
  isInspectorWindowMinimized,
  setInspectorWindowMinimized,
} from '../inspectorWindows';
import type { EditorInspectorState, EditorUiBridgeActions } from './model';
import type { EditorUiElements } from './elements';
import { renderInspectorPanel } from './panels';

export function bindUtilityInspectorControls(host: {
  elements: EditorUiElements;
  actions: EditorUiBridgeActions;
  cleanupCallbacks: Array<() => void>;
  windowObj: Window;
  getInspectorState: () => EditorInspectorState | null;
}): void {
  const { elements, actions, cleanupCallbacks, windowObj } = host;
  const graphicSelect = elements.ballGraphicSelect;
  if (graphicSelect && graphicSelect.options.length === 0) {
    for (const graphic of listRollingBallGraphics()) {
      const option = graphicSelect.ownerDocument.createElement('option');
      option.value = graphic.id;
      option.textContent = graphic.name;
      graphicSelect.append(option);
    }
  }
  const handleBallGraphicChange = () => {
    const value = elements.ballGraphicSelect?.value;
    if (value) actions.onSetFocusedBallGraphic(value);
  };
  elements.ballGraphicSelect?.addEventListener('change', handleBallGraphicChange);
  const handleBallWeightChange = () => {
    const weight = Number(elements.ballWeightInput?.value);
    if (Number.isFinite(weight)) actions.onSetFocusedBallWeight(weight);
  };
  elements.ballWeightInput?.addEventListener('change', handleBallWeightChange);
  const handleInspectorMinimize = () => {
    const state = host.getInspectorState();
    if (!state) return;
    const windowInfo = inspectorWindowLabel(state);
    if (!windowInfo) return;
    setInspectorWindowMinimized(windowInfo.kind, !isInspectorWindowMinimized(windowInfo.kind));
    renderInspectorPanel(elements, state);
  };
  elements.inspectorMinimizeButton?.addEventListener('click', handleInspectorMinimize);
  const handleInspectorWindowsReset = () => {
    const state = host.getInspectorState();
    if (state) renderInspectorPanel(elements, state);
  };
  windowObj.addEventListener(INSPECTOR_WINDOWS_RESET_EVENT, handleInspectorWindowsReset);
  cleanupCallbacks.push(() => {
    elements.inspectorMinimizeButton?.removeEventListener('click', handleInspectorMinimize);
    windowObj.removeEventListener(INSPECTOR_WINDOWS_RESET_EVENT, handleInspectorWindowsReset);
  });
  const bindBallFlag = (
    checkbox: HTMLInputElement | null,
    apply: (enabled: boolean) => void,
  ) => {
    const handle = () => apply(checkbox?.checked === true);
    checkbox?.addEventListener('change', handle);
    if (checkbox) cleanupCallbacks.push(() => checkbox.removeEventListener('change', handle));
  };
  bindBallFlag(elements.ballHurtEnemiesCheckbox, (enabled) => actions.onSetFocusedBallHurtEnemies(enabled));
  bindBallFlag(elements.ballHurtFriendliesCheckbox, (enabled) => actions.onSetFocusedBallHurtFriendlies(enabled));
  bindBallFlag(elements.ballHurtPlayerCheckbox, (enabled) => actions.onSetFocusedBallHurtPlayer(enabled));
  bindBallFlag(elements.ballPushableCheckbox, (enabled) => actions.onSetFocusedBallPushable(enabled));
  const colorPopover = new EditorColorPopover(
    {
      popover: elements.colorPopover,
      square: elements.colorPopoverSquare,
      hue: elements.colorPopoverHue,
      hex: null,
      dropper: elements.colorEyedropperButton,
    },
    () => undefined,
  );
  colorPopover.bind(cleanupCallbacks);
  const openColor = (anchor: HTMLButtonElement | null, current: string, apply: (hex: string) => void) => {
    if (!anchor) return;
    colorPopover.open(anchor, current, apply);
  };
  elements.triangleFillSwatch?.addEventListener('click', () => {
    openColor(elements.triangleFillSwatch, elements.triangleFillInput?.value ?? '#8A8F98', (hex) => actions.onSetFocusedTriangleFill(hex));
  });
  elements.triangleStrokeSwatch?.addEventListener('click', () => {
    openColor(elements.triangleStrokeSwatch, elements.triangleStrokeInput?.value ?? '#2C3138', (hex) => actions.onSetFocusedTriangleStroke(hex));
  });
  elements.triangleFillInput?.addEventListener('change', () => {
    actions.onSetFocusedTriangleFill(elements.triangleFillInput?.value ?? '');
  });
  elements.triangleStrokeInput?.addEventListener('change', () => {
    actions.onSetFocusedTriangleStroke(elements.triangleStrokeInput?.value ?? '');
  });
  for (const button of elements.triangleOrientButtons) {
    button.addEventListener('click', () => {
      const orient = button.dataset.triangleOrient;
      if (orient !== 'ne' && orient !== 'nw' && orient !== 'se' && orient !== 'sw') return;
      const flip = triangleFlipFromOrient(orient);
      actions.onSetTriangleOrientation(flip.flipX, flip.flipY);
    });
  }
}
