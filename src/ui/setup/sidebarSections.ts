export const EDITOR_SIDEBAR_RESIZED_EVENT = 'editor-sidebar-resized';

const EDITOR_SIDEBAR_WIDTH_STORAGE_KEY = 'wamp_editor_sidebar_width_v1';
const MIN_EDITOR_SIDEBAR_WIDTH = 280;
const MAX_EDITOR_SIDEBAR_WIDTH = 560;
const DESKTOP_MIN_EDITOR_STAGE_WIDTH = 520;
const TABLET_MIN_EDITOR_STAGE_WIDTH = 420;
const SIDEBAR_KEYBOARD_RESIZE_STEP = 24;

let sidebarResizeEventQueued = false;

function isPhoneEditorActive(doc: Document): boolean {
  const body = doc.body;
  return body.dataset.appMode === 'editor' && body.dataset.deviceClass === 'phone';
}

function isEditorSidebarResizable(doc: Document): boolean {
  const body = doc.body;
  return body.dataset.appMode === 'editor' && body.dataset.deviceClass !== 'phone';
}

function readStoredEditorSidebarWidth(win: Window): number | null {
  try {
    const stored = win.localStorage.getItem(EDITOR_SIDEBAR_WIDTH_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const parsed = Number.parseFloat(stored);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredEditorSidebarWidth(win: Window, width: number): void {
  try {
    win.localStorage.setItem(EDITOR_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Local storage can be unavailable in restricted browser contexts.
  }
}

function clearStoredEditorSidebarWidth(win: Window): void {
  try {
    win.localStorage.removeItem(EDITOR_SIDEBAR_WIDTH_STORAGE_KEY);
  } catch {
    // Local storage can be unavailable in restricted browser contexts.
  }
}

function getMaxEditorSidebarWidth(doc: Document): number {
  const win = doc.defaultView;
  const viewportWidth = win?.innerWidth ?? doc.documentElement.clientWidth;
  if (!viewportWidth) {
    return MAX_EDITOR_SIDEBAR_WIDTH;
  }

  const stageMinWidth =
    doc.body.dataset.deviceClass === 'tablet' ? TABLET_MIN_EDITOR_STAGE_WIDTH : DESKTOP_MIN_EDITOR_STAGE_WIDTH;
  return Math.max(MIN_EDITOR_SIDEBAR_WIDTH, Math.min(MAX_EDITOR_SIDEBAR_WIDTH, viewportWidth - stageMinWidth));
}

function clampEditorSidebarWidth(width: number, doc: Document): number {
  if (!Number.isFinite(width)) {
    return MIN_EDITOR_SIDEBAR_WIDTH;
  }
  return Math.max(MIN_EDITOR_SIDEBAR_WIDTH, Math.min(getMaxEditorSidebarWidth(doc), width));
}

function getCurrentEditorSidebarWidth(sidebar: HTMLElement, doc: Document): number {
  const inlineWidth = Number.parseFloat(doc.body.style.getPropertyValue('--app-sidebar-width'));
  if (Number.isFinite(inlineWidth)) {
    return inlineWidth;
  }
  return sidebar.getBoundingClientRect().width;
}

function queueEditorSidebarResizeEvent(doc: Document, resizeGame = true): void {
  const win = doc.defaultView;
  if (!win || sidebarResizeEventQueued) {
    return;
  }

  sidebarResizeEventQueued = true;
  const dispatch = () => {
    sidebarResizeEventQueued = false;
    win.dispatchEvent(new win.CustomEvent(EDITOR_SIDEBAR_RESIZED_EVENT));
    if (resizeGame) {
      win.dispatchEvent(new win.Event('resize'));
    }
  };

  if (typeof win.requestAnimationFrame === 'function') {
    win.requestAnimationFrame(dispatch);
  } else {
    dispatch();
  }
}

function applyEditorSidebarWidth(
  doc: Document,
  width: number,
  options: { persist?: boolean; notify?: boolean; resizeGame?: boolean } = {},
): number {
  const clampedWidth = clampEditorSidebarWidth(width, doc);
  doc.body.style.setProperty('--app-sidebar-width', `${Math.round(clampedWidth)}px`);

  const win = doc.defaultView;
  if (win && options.persist) {
    writeStoredEditorSidebarWidth(win, clampedWidth);
  }
  if (options.notify !== false) {
    queueEditorSidebarResizeEvent(doc, options.resizeGame !== false);
  }

  return clampedWidth;
}

function resetEditorSidebarWidth(doc: Document): void {
  doc.body.style.removeProperty('--app-sidebar-width');
  const win = doc.defaultView;
  if (win) {
    clearStoredEditorSidebarWidth(win);
  }
  queueEditorSidebarResizeEvent(doc);
}

function applyStoredEditorSidebarWidth(doc: Document): void {
  const win = doc.defaultView;
  if (!win || !isEditorSidebarResizable(doc)) {
    return;
  }

  const storedWidth = readStoredEditorSidebarWidth(win);
  if (storedWidth !== null) {
    applyEditorSidebarWidth(doc, storedWidth, { persist: false });
  }
}

function setupEditorSidebarResizeHandle(sidebar: HTMLElement, doc: Document): void {
  const win = doc.defaultView;
  if (!win) {
    return;
  }

  let handle = doc.getElementById('editor-sidebar-resize-handle') as HTMLButtonElement | null;
  if (!handle) {
    handle = doc.createElement('button');
    handle.id = 'editor-sidebar-resize-handle';
    handle.className = 'editor-sidebar-resize-handle';
    handle.type = 'button';
    handle.setAttribute('aria-label', 'Resize editor panel');
    handle.title = 'Drag to resize editor panel. Double-click to reset.';
  }
  if (handle.parentElement !== sidebar) {
    sidebar.append(handle);
  }

  applyStoredEditorSidebarWidth(doc);

  if (handle.dataset.editorSidebarResizeReady === 'true') {
    return;
  }

  let activeDrag: { pointerId: number; startX: number; startWidth: number } | null = null;

  const finishDrag = () => {
    if (!activeDrag) {
      return;
    }
    const finalWidth = clampEditorSidebarWidth(getCurrentEditorSidebarWidth(sidebar, doc), doc);
    writeStoredEditorSidebarWidth(win, finalWidth);
    activeDrag = null;
    delete doc.body.dataset.editorSidebarResizing;
  };

  handle.addEventListener('pointerdown', (event) => {
    if (!isEditorSidebarResizable(doc) || event.button !== 0) {
      return;
    }
    event.preventDefault();
    activeDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebar.getBoundingClientRect().width,
    };
    doc.body.dataset.editorSidebarResizing = 'true';
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the event target is detached mid-interaction.
    }
  });

  win.addEventListener('pointermove', (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) {
      return;
    }
    event.preventDefault();
    applyEditorSidebarWidth(doc, activeDrag.startWidth + event.clientX - activeDrag.startX, {
      persist: false,
    });
  }, { capture: true });

  win.addEventListener('pointerup', (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) {
      return;
    }
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    finishDrag();
  }, { capture: true });

  win.addEventListener('pointercancel', (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) {
      return;
    }
    finishDrag();
  }, { capture: true });

  handle.addEventListener('dblclick', (event) => {
    event.preventDefault();
    resetEditorSidebarWidth(doc);
  });

  handle.addEventListener('keydown', (event) => {
    if (!isEditorSidebarResizable(doc)) {
      return;
    }

    const currentWidth = getCurrentEditorSidebarWidth(sidebar, doc);
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      applyEditorSidebarWidth(doc, currentWidth - SIDEBAR_KEYBOARD_RESIZE_STEP, { persist: true });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      applyEditorSidebarWidth(doc, currentWidth + SIDEBAR_KEYBOARD_RESIZE_STEP, { persist: true });
    } else if (event.key === 'Home') {
      event.preventDefault();
      applyEditorSidebarWidth(doc, MIN_EDITOR_SIDEBAR_WIDTH, { persist: true });
    } else if (event.key === 'End') {
      event.preventDefault();
      applyEditorSidebarWidth(doc, getMaxEditorSidebarWidth(doc), { persist: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      resetEditorSidebarWidth(doc);
    }
  });

  win.addEventListener('resize', () => {
    if (
      activeDrag ||
      !isEditorSidebarResizable(doc) ||
      !doc.body.style.getPropertyValue('--app-sidebar-width')
    ) {
      return;
    }

    const preferredWidth = readStoredEditorSidebarWidth(win) ?? getCurrentEditorSidebarWidth(sidebar, doc);
    const nextWidth = clampEditorSidebarWidth(preferredWidth, doc);
    if (Math.abs(nextWidth - getCurrentEditorSidebarWidth(sidebar, doc)) > 0.5) {
      applyEditorSidebarWidth(doc, nextWidth, { persist: false, resizeGame: false });
    }
  });

  const modeObserver = new win.MutationObserver(() => {
    applyStoredEditorSidebarWidth(doc);
  });
  modeObserver.observe(doc.body, {
    attributes: true,
    attributeFilter: ['data-app-mode', 'data-device-class'],
  });

  handle.dataset.editorSidebarResizeReady = 'true';
}

function shouldCollapseSectionByDefault(section: HTMLElement, doc: Document): boolean {
  const defaultCollapsed = section.dataset.sidebarDefaultCollapsed;
  if (defaultCollapsed === 'desktop') {
    return !isPhoneEditorActive(doc);
  }
  if (defaultCollapsed === 'phone') {
    return isPhoneEditorActive(doc);
  }
  return defaultCollapsed === 'true';
}

function toggleSidebarSection(section: HTMLElement): void {
  section.classList.toggle('is-collapsed');
  const toggle = section.querySelector<HTMLButtonElement>(':scope > .section-label > .sidebar-section-toggle');
  toggle?.setAttribute('aria-expanded', section.classList.contains('is-collapsed') ? 'false' : 'true');
}

export function setupEditorSidebarShell(doc: Document = document): void {
  const sidebar = doc.getElementById('sidebar');
  const editorActions = doc.getElementById('editor-actions');
  if (!sidebar || !editorActions) {
    return;
  }

  let fixedStack = doc.getElementById('editor-fixed-stack') as HTMLElement | null;
  if (!fixedStack) {
    fixedStack = doc.createElement('div');
    fixedStack.id = 'editor-fixed-stack';
  }

  let scrollShell = doc.getElementById('editor-sidebar-scroll') as HTMLElement | null;
  if (!scrollShell) {
    scrollShell = doc.createElement('div');
    scrollShell.id = 'editor-sidebar-scroll';
  }

  if (fixedStack.parentElement !== sidebar) {
    sidebar.insertBefore(fixedStack, sidebar.firstChild);
  }
  if (scrollShell.parentElement !== sidebar) {
    sidebar.append(scrollShell);
  }
  setupEditorSidebarResizeHandle(sidebar, doc);

  const sections = Array.from(sidebar.querySelectorAll<HTMLElement>('.sidebar-section'));
  const sectionById = new Map<string, HTMLElement>();
  let paletteModeSection: HTMLElement | null = null;
  for (const section of sections) {
    if (section.id) {
      sectionById.set(section.id, section);
    } else if (
      !paletteModeSection &&
      section.dataset.mobilePanel === 'palette' &&
      section.id !== 'tileset-section' &&
      section.id !== 'tile-palette-section' &&
      section.id !== 'object-palette-section'
    ) {
      paletteModeSection = section;
    }
  }

  const used = new Set<HTMLElement>();
  const appendSection = (container: HTMLElement, section: HTMLElement | null | undefined) => {
    if (!section || used.has(section)) {
      return;
    }
    container.append(section);
    used.add(section);
  };

  appendSection(fixedStack, editorActions);

  appendSection(scrollShell, paletteModeSection);
  appendSection(scrollShell, sectionById.get('smart-palette-section'));
  appendSection(scrollShell, sectionById.get('tileset-section'));
  appendSection(scrollShell, sectionById.get('tile-palette-section'));
  appendSection(scrollShell, sectionById.get('object-palette-section'));
  appendSection(scrollShell, sectionById.get('layers-section'));
  appendSection(scrollShell, sectionById.get('background-section'));
  appendSection(scrollShell, sectionById.get('goal-section'));
  appendSection(scrollShell, sectionById.get('course-goal-section'));
  appendSection(scrollShell, sectionById.get('editor-advanced'));
  appendSection(scrollShell, sectionById.get('tools-section'));

  for (const section of sections) {
    if (used.has(section)) {
      continue;
    }
    appendSection(scrollShell, section);
  }
}

export function setupCollapsibleSidebarSections(doc: Document = document): void {
  const sections = Array.from(
    doc.querySelectorAll<HTMLElement>('#sidebar .sidebar-section[data-sidebar-collapsible="true"]')
  );

  for (const section of sections) {
    if (section.dataset.sidebarCollapsibleReady === 'true') {
      continue;
    }

    const label = section.querySelector<HTMLElement>(':scope > .section-label');
    if (!label) {
      continue;
    }

    let body = section.querySelector<HTMLElement>(':scope > .sidebar-section-body');
    if (!body) {
      body = doc.createElement('div');
      body.className = 'sidebar-section-body';
      while (label.nextSibling) {
        body.append(label.nextSibling);
      }
      section.append(body);
    }

    let toggle = label.querySelector<HTMLButtonElement>(':scope > .sidebar-section-toggle');
    if (!toggle) {
      toggle = doc.createElement('button');
      toggle.className = 'sidebar-section-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-label', `Toggle ${label.textContent?.trim() ?? 'section'}`);
      label.append(toggle);
    }

    const syncExpandedState = () => {
      toggle.setAttribute('aria-expanded', section.classList.contains('is-collapsed') ? 'false' : 'true');
    };

    const handleToggle = (event: Event) => {
      if (isPhoneEditorActive(doc)) {
        return;
      }
      event.preventDefault();
      toggleSidebarSection(section);
      syncExpandedState();
    };

    label.addEventListener('click', handleToggle);
    label.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      handleToggle(event);
    });
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      handleToggle(event);
    });

    label.tabIndex = 0;
    label.setAttribute('role', 'button');
    label.setAttribute('aria-expanded', 'true');
    section.classList.add('is-collapsible');
    if (shouldCollapseSectionByDefault(section, doc)) {
      section.classList.add('is-collapsed');
    }
    section.dataset.sidebarCollapsibleReady = 'true';
    syncExpandedState();
  }
}
