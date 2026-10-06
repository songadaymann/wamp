import { getApiBaseUrl } from '../../api/baseUrl';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { normalizeRunGhost, supportsGhostRace, type GhostOption, type GhostRaceChoice,
  type RoomGhostResponse, type RunGhost } from '../../runs/ghostRace';
import { getGhostStorage, loadLocalGhostBest } from '../../runs/localGhostBest';

const unavailableCopy: Record<string, string> = {
  no_run: 'No clear recorded yet.', no_recording: 'This best has no ghost recording yet.',
  layout_changed: 'This best was set on a different layout.', sign_in: 'Clear this room to save a ghost on this browser.',
  unsupported: 'Ghost races are available for time-ranked rooms.',
};
/** Owns asynchronous choices while the existing intro owns Start, focus and pause. */
export class GhostRaceIntro {
  private abort: AbortController | null = null;
  private selection: GhostRaceChoice = 'off';
  private options: { top: GhostOption; personal: GhostOption } | null = null;
  private readonly panel: HTMLElement | null;
  private readonly select: HTMLSelectElement | null;
  private readonly status: HTMLElement | null;
  constructor(doc: Document) {
    this.panel = doc.getElementById('room-ghost-race');
    this.select = doc.getElementById('room-ghost-race-choice') as HTMLSelectElement | null;
    this.status = doc.getElementById('room-ghost-race-status');
    this.select?.addEventListener('change', this.onChange);
  }
  private readonly onChange = () => {
    this.selection = (this.select?.value ?? 'off') as GhostRaceChoice;
    this.renderStatus();
  };
  open(room: RoomSnapshot, signedIn: boolean): void {
    this.close();
    const supported = room.status === 'published' && supportsGhostRace(room.goal);
    this.panel?.classList.toggle('hidden', !supported);
    if (!supported || !this.select || !this.status) return;
    this.options = { top: { ghost: null, reason: 'no_recording' },
      personal: { ghost: signedIn ? null : loadLocalGhostBest(getGhostStorage(), room.id, room.version), reason: 'no_run' } };
    this.renderOptions();
    this.status.textContent = 'Loading ghosts… You can start without one.';
    const abort = this.abort = new AbortController();
    const params = new URLSearchParams({ x: String(room.coordinates.x), y: String(room.coordinates.y), version: String(room.version) });
    void fetch(`${getApiBaseUrl()}/api/rooms/${encodeURIComponent(room.id)}/ghosts?${params}`,
      { credentials: 'include', cache: 'no-store', signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error('unavailable');
        return await response.json() as RoomGhostResponse;
      }).then(response => {
        if (this.abort !== abort || abort.signal.aborted) return;
        if (response.roomId !== room.id || response.roomVersion !== room.version) throw new Error('layout');
        this.options = {
          top: { ghost: normalizeRunGhost(response.top?.ghost), reason: response.top?.reason ?? 'no_recording' },
          personal: signedIn ? { ghost: normalizeRunGhost(response.personal?.ghost), reason: response.personal?.reason ?? 'no_recording' }
            : { ghost: loadLocalGhostBest(getGhostStorage(), room.id, room.version), reason: 'sign_in' },
        };
        this.renderOptions();
        if (new URLSearchParams(window.location.search).get('race') === '1' && this.options.top.ghost) {
          this.selection = 'top'; this.select!.value = 'top';
        }
        this.renderStatus();
      }).catch(() => {
        if (this.abort !== abort || abort.signal.aborted) return;
        this.status!.textContent = 'Ghosts could not load. You can still start; reopen Play to retry.';
      });
  }
  take(): { ghost: RunGhost | null; choice: GhostRaceChoice } {
    const ghost = this.selection === 'off' ? null : this.options?.[this.selection].ghost ?? null;
    const choice = ghost ? this.selection : 'off';
    this.close();
    return { ghost, choice };
  }
  close(): void {
    this.abort?.abort(); this.abort = null; this.options = null; this.selection = 'off';
    if (this.select) this.select.value = 'off';
    this.panel?.classList.add('hidden');
  }
  destroy(): void { this.close(); this.select?.removeEventListener('change', this.onChange); }
  private renderOptions(): void {
    for (const choice of ['top', 'personal'] as const) {
      const option = this.select?.querySelector<HTMLOptionElement>(`option[value="${choice}"]`);
      if (option) {
        const ghost = this.options?.[choice].ghost;
        option.disabled = !ghost;
        option.textContent = `${choice === 'top' ? 'Race #1' : 'Race my best'}${ghost ? ` · ${(ghost.elapsedMs / 1000).toFixed(2)}s` : ' · unavailable'}`;
      }
    }
  }
  private renderStatus(): void {
    if (!this.status || !this.options) return;
    if (this.selection !== 'off') {
      const ghost = this.options[this.selection].ghost;
      this.status.textContent = ghost ? `${this.selection === 'top' ? '#1 ' + ghost.displayName : 'Your best'} · ${(ghost.elapsedMs / 1000).toFixed(2)}s`
        : unavailableCopy[this.options[this.selection].reason ?? 'no_recording'];
    } else {
      this.status.textContent = this.options.top.ghost || this.options.personal.ghost
        ? 'Choose a ghost to race, or start on your own.'
        : `#1: ${unavailableCopy[this.options.top.reason ?? 'no_recording']} Your best: ${unavailableCopy[this.options.personal.reason ?? 'no_run']}`;
    }
  }
}
