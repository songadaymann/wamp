/** Marks an object palette tile as the selected one (or not), for sight and for screen readers. */
export function setObjectPaletteTilePressed(tile: Element, pressed: boolean): void {
  tile.classList.toggle('active', pressed);
  tile.setAttribute('aria-pressed', String(pressed));
}

/**
 * Object palette tiles are styled divs; give them what a button has: focus, Enter/Space to
 * select (through the tile's click handler) and a pressed state.
 */
export function makeObjectPaletteTile(tile: HTMLElement, pressed: boolean): void {
  tile.setAttribute('role', 'button');
  tile.tabIndex = 0;
  setObjectPaletteTilePressed(tile, pressed);
  tile.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    tile.click();
  });
}
