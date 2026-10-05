import { buildAttributedRoomShareUrl } from '../../social/roomShareLinks';
import { shareLink } from '../../social/linkSharing';
import type { OverworldSelectedRoomContext } from './sceneBridge';

export class RoomSharingController {
  private generation = 0;
  private timer: number | null = null;

  constructor(
    private readonly getContext: () => OverworldSelectedRoomContext | null,
    private readonly doc: Document = document,
    private readonly win: Window = window,
  ) {}

  async shareSelectedRoom(): Promise<void> {
    const context = this.getContext();
    if (!context || context.state !== 'published') return;
    const generation = ++this.generation;
    const url = buildAttributedRoomShareUrl(context.coordinates, this.win.location.href);
    const title = context.shareTitle?.trim() || context.courseTitle?.trim();
    const subject = title ? `"${title}"` : `room ${context.coordinates.x},${context.coordinates.y}`;
    try {
      const result = await shareLink(this.doc, this.win.navigator, { title: title || 'WAMP room', text: `Come play ${subject} in WAMP.`, url });
      if (generation === this.generation) this.showStatus(result === 'shared' ? 'Shared.' : result === 'canceled' ? 'Share canceled.' : 'Room link copied.');
    } catch {
      if (generation === this.generation) this.showStatus(`Copy this link: ${url}`, true);
    }
  }

  private showStatus(message: string, failed = false): void {
    const element = this.doc.getElementById('world-share-status');
    if (!element) return;
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    element.textContent = message;
    element.classList.remove('hidden');
    this.timer = this.win.setTimeout(() => { element.classList.add('hidden'); this.timer = null; }, failed ? 15000 : 5000);
  }
}
