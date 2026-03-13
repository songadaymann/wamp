function isPhoneEditorActive(doc: Document): boolean {
  const body = doc.body;
  return body.dataset.appMode === 'editor' && body.dataset.deviceClass === 'phone';
}

function toggleSidebarSection(section: HTMLElement): void {
  section.classList.toggle('is-collapsed');
  const toggle = section.querySelector<HTMLButtonElement>(':scope > .section-label > .sidebar-section-toggle');
  toggle?.setAttribute('aria-expanded', section.classList.contains('is-collapsed') ? 'false' : 'true');
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
    section.dataset.sidebarCollapsibleReady = 'true';
    syncExpandedState();
  }
}
