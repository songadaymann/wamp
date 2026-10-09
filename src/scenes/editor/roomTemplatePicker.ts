import { editorState } from '../../config';
import { createRoomRepository, roomIdFromCoordinates, type RoomSnapshot } from '../../persistence/roomRepository';
import { ROOM_TEMPLATE_DEFINITIONS, type RoomTemplateDefinition, type RoomTemplateId } from '../../templates/roomTemplateDefinitions';
import type { EditorEditRuntime } from './editRuntime';

interface RoomTemplatePickerContext {
  getRuntime: () => EditorEditRuntime | null;
  isActive: () => boolean;
  expandedCell?: boolean;
  onApplied: () => void;
}

let activeClose: (() => void) | null = null;
export function closeRoomTemplatePicker(): void { activeClose?.(); }

function drawPreview(definition: RoomTemplateDefinition, expandedCell: boolean): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 40 22');
  svg.setAttribute('aria-hidden', 'true');
  for (const rect of definition.rectangles) {
    const block = document.createElementNS(ns, 'rect');
    for (const [key, value] of Object.entries({ x: rect.x1, y: rect.y1, width: rect.x2 - rect.x1 + 1, height: rect.y2 - rect.y1 + 1 })) block.setAttribute(key, String(value));
    block.setAttribute('fill', '#769952');
    svg.append(block);
  }
  for (const point of [...(expandedCell ? [] : [definition.spawn, definition.exit]), ...(definition.enemies ?? [])]) {
    if (!point) continue;
    const marker = document.createElementNS(ns, 'circle');
    marker.setAttribute('cx', String(point.tileX + 0.5));
    marker.setAttribute('cy', String(point.tileY + 0.5));
    marker.setAttribute('r', '0.9');
    marker.setAttribute('fill', point === definition.spawn ? '#7bbbea' : point === definition.exit ? '#e3bf64' : '#d96c5c');
    svg.append(marker);
  }
  return svg;
}

async function readNeighborSnapshots(base: RoomSnapshot): Promise<RoomSnapshot[]> {
  const repository = createRoomRepository();
  const requests = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(async ([dx, dy]) => {
    const coordinates = { x: base.coordinates.x + dx, y: base.coordinates.y + dy };
    const record = await repository.loadRoomCurrent(roomIdFromCoordinates(coordinates), coordinates);
    return record.published;
  });
  return (await Promise.allSettled(requests)).flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
}

export async function openRoomTemplatePicker(context: RoomTemplatePickerContext): Promise<void> {
  closeRoomTemplatePicker();
  const runtime = context.getRuntime();
  if (!runtime || !runtime.canReplaceRoomLayout() || !context.isActive()) return;
  const root = document.getElementById('room-template-modal');
  const grid = document.getElementById('room-template-grid');
  const status = document.getElementById('room-template-status');
  const scope = document.getElementById('room-template-scope');
  const styleSelect = document.getElementById('room-template-style') as HTMLSelectElement | null;
  const apply = document.getElementById('btn-room-template-apply') as HTMLButtonElement | null;
  const closeButton = document.getElementById('btn-room-template-close');
  const confirmRow = document.getElementById('room-template-confirm-row');
  const confirm = document.getElementById('room-template-confirm') as HTMLInputElement | null;
  if (!root || !grid || !status || !scope || !styleSelect || !apply || !closeButton || !confirmRow || !confirm) return;
  const opener = document.activeElement as HTMLElement | null;
  const base = runtime.exportRoomSnapshot();
  const replacing = runtime.hasRoomLayoutContent();
  let alive = true;
  let ready = false;
  let styleChosen = false;
  let selected: RoomTemplateId = 'flat_run';
  const current = () => {
    if (!alive || !context.isActive() || context.getRuntime() !== runtime || !runtime.canReplaceRoomLayout()) return false;
    const snapshot = runtime.exportRoomSnapshot();
    return snapshot.id === base.id && snapshot.coordinates.x === base.coordinates.x && snapshot.coordinates.y === base.coordinates.y;
  };
  const onStyleChange = () => { styleChosen = true; };
  const syncApply = () => { apply.disabled = !ready || (replacing && !confirm.checked) || !current(); };
  const close = () => {
    if (!alive) return;
    alive = false;
    root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true');
    root.removeEventListener('keydown', onKeyDown, true);
    root.removeEventListener('click', onBackdrop);
    closeButton.removeEventListener('click', close);
    confirm.removeEventListener('change', syncApply);
    styleSelect.removeEventListener('change', onStyleChange);
    apply.removeEventListener('click', onApply);
    if (activeClose === close) activeClose = null;
    if (opener?.isConnected && context.isActive()) opener.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const focusable = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled)')].filter(element => element.getClientRects().length > 0);
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  const onBackdrop = (event: MouseEvent) => { if (event.target === root) close(); };
  const onApply = () => {
    if (apply.disabled || !current()) return;
    try {
      const next = builder!.buildRoomTemplate(runtime.exportRoomSnapshot(), selected, styleSelect.value as typeof editorState.smartStyle);
      if (context.expandedCell) { next.goal = base.goal; next.goalIntroText = base.goalIntroText; next.spawnPoint = base.spawnPoint; }
      if (!runtime.replaceRoomLayout(next)) return;
      const style = builder!.getRoomTemplateStyles().find(candidate => candidate.id === styleSelect.value)!;
      editorState.paletteMode = 'smart'; editorState.activeLayer = 'terrain';
      editorState.smartStyle = style.id; editorState.smartTheme = style.themeId;
      editorState.smartMaterial = builder!.getRoomTemplateDefaultBrush(style.id);
      editorState.activeTool = 'pencil';
      close(); context.onApplied();
    } catch { status.textContent = 'Could not apply this layout. Your current layout is unchanged; close and try again.'; }
  };
  let builder: typeof import('../../templates/roomTemplates') | null = null;
  activeClose = close;
  confirm.checked = false; confirmRow.classList.toggle('hidden', !replacing);
  scope.textContent = context.expandedCell
    ? `Cell ${base.coordinates.x}, ${base.coordinates.y} only. The Expanded Room’s start and goal stay in Markers.`
    : 'Includes a start and exit, except Blank. Keep building with Smart terrain.';
  status.textContent = 'Loading terrain styles…';
  styleSelect.disabled = true; apply.disabled = true;
  grid.replaceChildren();
  for (const definition of ROOM_TEMPLATE_DEFINITIONS) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'room-template-card';
    card.dataset.roomTemplate = definition.id;
    card.setAttribute('aria-pressed', String(definition.id === selected));
    const title = document.createElement('strong'); title.textContent = definition.label;
    const detail = document.createElement('span'); detail.textContent = definition.description;
    card.append(drawPreview(definition, context.expandedCell === true), title, detail);
    card.addEventListener('click', () => {
      selected = definition.id;
      for (const button of grid.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button === card));
      apply.textContent = replacing ? 'Replace layout' : definition.id === 'blank' ? 'Start blank' : 'Use layout';
    });
    grid.append(card);
  }
  apply.textContent = replacing ? 'Replace layout' : 'Use layout';
  root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false');
  root.addEventListener('keydown', onKeyDown, true); root.addEventListener('click', onBackdrop);
  closeButton.addEventListener('click', close); confirm.addEventListener('change', syncApply); apply.addEventListener('click', onApply);
  styleSelect.addEventListener('change', onStyleChange);
  closeButton.focus();
  try {
    builder = await import('../../templates/roomTemplates');
    if (!current()) { close(); return; }
    const styles = builder.getRoomTemplateStyles();
    styleSelect.replaceChildren(...styles.map(style => {
      const option = document.createElement('option'); option.value = style.id; option.textContent = style.label; return option;
    }));
    styleSelect.value = builder.chooseRoomTemplateStyle([base], editorState.smartStyle);
    styleSelect.disabled = false; ready = true;
    status.textContent = replacing
      ? context.expandedCell ? 'Replaces this cell’s tiles and objects. Undo restores its previous layout.' : 'Replaces all tiles, objects and room markers. Undo restores the previous layout.'
      : 'Choose a layout and terrain style. You can undo after applying.';
    syncApply();
    if (!replacing) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const neighbors = await Promise.race([readNeighborSnapshots(base), new Promise<RoomSnapshot[]>(resolve => { timeout = setTimeout(() => resolve([]), 3500); })]);
      clearTimeout(timeout);
      if (current() && !styleChosen) styleSelect.value = builder.chooseRoomTemplateStyle(neighbors, editorState.smartStyle);
    }
  } catch { if (alive) status.textContent = 'Terrain styles could not load. Close and try again.'; }
}
