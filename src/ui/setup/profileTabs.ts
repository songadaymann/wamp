import type { ProfileTabId } from './profileCollection';

type TabButtons = Record<ProfileTabId, HTMLButtonElement | null>;

/** The tabs on screen, in page order. */
function shownTabs(button: HTMLElement): HTMLButtonElement[] {
  return Array.from(button.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(.hidden)') ?? []);
}

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
      const shown = shownTabs(button);
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

/**
 * Only the selected tab is a Tab stop. While a profile loads, the selected tab can still be hidden
 * (Collection, before the wallet check); then the first tab on screen takes the stop.
 */
export function setProfileTabStops(buttons: TabButtons, selected: ProfileTabId): void {
  const all = Object.values(buttons).filter((button): button is HTMLButtonElement => Boolean(button));
  const shown = all.length ? shownTabs(all[0]) : [];
  const chosen = buttons[selected];
  const stop = chosen && shown.includes(chosen) ? chosen : shown[0];
  for (const button of all) button.setAttribute('tabindex', button === stop ? '0' : '-1');
}
