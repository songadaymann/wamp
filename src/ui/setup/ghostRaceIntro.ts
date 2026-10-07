import type { RoomSnapshot } from '../../persistence/roomModel';
import { supportsGhostRace, type GhostOption, type GhostRaceChoice, type RunGhost } from '../../runs/ghostRace';
import { getGhostStorage, loadLocalGhostBest } from '../../runs/localGhostBest';
import { getRecentTopGhost, loadRoomGhosts, subscribeGhostBestUpdates } from '../../runs/ghostRepository';

const unavailableCopy: Record<string, string> = {
  no_run: 'No clear recorded yet.', no_recording: 'This best has no ghost recording yet.',
  layout_changed: 'This best was set on a different layout.', sign_in: 'Clear this room to save a ghost on this browser.',
  unsupported: 'Ghost races are available for time-ranked rooms.',
};
/** Owns asynchronous choices while the existing intro owns Start, focus and pause. */
export class GhostRaceIntro {
  private abort: AbortController | null = null;
  private selection: GhostRaceChoice = 'off';
  private explicitChoice: GhostRaceChoice | null = null;
  private loading = false;
  private unsubscribe: (() => void) | null = null;
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
    this.explicitChoice = this.selection;
    this.renderStatus();
  };
  open(room: RoomSnapshot, signedIn: boolean): void {
    this.close();
    const supported = room.status === 'published' && supportsGhostRace(room.goal);
    this.panel?.classList.toggle('hidden', !supported);
    if (!supported || !this.select || !this.status) return;
    this.options = { top: { ghost: getRecentTopGhost(room.id, room.version), reason: 'no_recording' },
      personal: { ghost: signedIn ? null : loadLocalGhostBest(getGhostStorage(), room.id, room.version), reason: 'no_run' } };
    this.unsubscribe = subscribeGhostBestUpdates(room.id, () => this.loadOptions(room, signedIn));
    this.loadOptions(room, signedIn);
  }
  private loadOptions(room: RoomSnapshot, signedIn: boolean): void {
    this.abort?.abort();
    this.loading = true;
    this.renderOptions(); this.renderStatus();
    const abort = this.abort = new AbortController();
    void loadRoomGhosts(room.id, room.version, room.coordinates, abort.signal).then(response => {
        if (this.abort !== abort || abort.signal.aborted) return;
        this.loading = false;
        this.options = {
          top: response.top,
          personal: signedIn ? response.personal
            : { ghost: loadLocalGhostBest(getGhostStorage(), room.id, room.version), reason: 'sign_in' },
        };
        this.renderOptions();
        this.renderStatus();
      }).catch(() => {
        if (this.abort !== abort || abort.signal.aborted) return;
        this.loading = false; this.renderOptions();
        this.status!.textContent = this.options?.top.ghost
          ? 'Ghost could not refresh. The previous recording is ready to race.'
          : 'Ghosts could not load. You can still start; reopen Play to retry.';
      });
  }
  take(): { ghost: RunGhost | null; choice: GhostRaceChoice } {
    const ghost = this.selection === 'off' ? null : this.options?.[this.selection].ghost ?? null;
    // Keep automatic #1 intent through a quick Start or a finish still being saved.
    const choice = this.options ? this.explicitChoice ?? 'top' : 'off';
    this.close();
    return { ghost, choice };
  }
  close(): void {
    this.abort?.abort(); this.abort = null; this.unsubscribe?.(); this.unsubscribe = null;
    this.options = null; this.selection = 'off'; this.explicitChoice = null; this.loading = false;
    if (this.select) this.select.value = 'off';
    this.panel?.classList.add('hidden');
  }
  destroy(): void { this.close(); this.select?.removeEventListener('change', this.onChange); }
  private renderOptions(): void {
    this.selection = this.explicitChoice ?? (this.options?.top.ghost || this.loading ? 'top' : 'off');
    if (this.select) this.select.value = this.selection;
    for (const choice of ['top', 'personal'] as const) {
      const option = this.select?.querySelector<HTMLOptionElement>(`option[value="${choice}"]`);
      if (option) {
        const ghost = this.options?.[choice].ghost;
        option.disabled = !ghost && !(choice === 'top' && this.loading);
        option.textContent = `${choice === 'top' ? 'Race #1' : 'Race my best'}${ghost ? ` · ${(ghost.elapsedMs / 1000).toFixed(2)}s`
          : choice === 'top' && this.loading ? ' · loading…' : ' · unavailable'}`;
      }
    }
  }
  private renderStatus(): void {
    if (!this.status || !this.options) return;
    if (this.selection !== 'off') {
      const ghost = this.options[this.selection].ghost;
      this.status.textContent = ghost ? `${this.selection === 'top' ? '#1 ' + ghost.displayName : 'Your best'} · ${(ghost.elapsedMs / 1000).toFixed(2)}s`
        : this.loading ? 'Loading the room record ghost… You can start now.'
          : unavailableCopy[this.options[this.selection].reason ?? 'no_recording'];
    } else {
      this.status.textContent = this.options.top.ghost || this.options.personal.ghost
        ? 'Choose a ghost to race, or start on your own.'
        : `#1: ${unavailableCopy[this.options.top.reason ?? 'no_recording']} Your best: ${unavailableCopy[this.options.personal.reason ?? 'no_run']}`;
    }
  }
}
