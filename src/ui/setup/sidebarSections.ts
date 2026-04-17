function isPhoneEditorActive(doc: Document): boolean {
  const body = doc.body;
  return body.dataset.appMode === 'editor' && body.dataset.deviceClass === 'phone';
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
