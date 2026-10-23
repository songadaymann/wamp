import type { ProfileTabId } from './profileCollection';

type TabButtons = Record<ProfileTabId, HTMLButtonElement | null>;

/**
 * The profile tabs as a real tab list, so screen readers hear which tab is selected (F464). Like
 * Activity's tabs, Tab reaches only the selected tab, and the arrow keys, Home and End move between
 * the shown tabs and select the one reached.
 */
export function setupProfileTabs(buttons: TabButtons, panels: Record<ProfileTabId, HTMLElement | null>,
  select: (tab: ProfileTabId) => void): void {
  for (const [tab, button] of Object.entries(buttons) as Array<[ProfileTabId, HTMLButtonElement | null]>) {
    if (!button) continue;
    const panel = panels[tab];
    button.setAttribute('role', 'tab');
    if (panel) {
      button.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
    }
    button.addEventListener('click', () => select(tab));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const shown = Array.from(button.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(.hidden)') ?? []);
      const current = shown.indexOf(button);
      if (current < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? shown[0]
        : event.key === 'End' ? shown[shown.length - 1]
          : shown[(current + (event.key === 'ArrowRight' ? 1 : shown.length - 1)) % shown.length];
      next.click();
      next.focus();
    });
  }
}

/** Only the selected tab is a Tab stop. */
export function setProfileTabStops(buttons: TabButtons, selected: ProfileTabId): void {
  for (const [tab, button] of Object.entries(buttons)) button?.setAttribute('tabindex', tab === selected ? '0' : '-1');
}
