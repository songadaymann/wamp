import { BUILD_PROMPT_OPEN_REQUEST } from '../../buildPrompts/events';
import { activityDescription, type BuilderActivity } from '../../activity/model';

export function createActivityEntry(doc: Document, entry: BuilderActivity, guestView: boolean,
  onGuest: (ref: number, name: string, trigger: HTMLElement) => void): HTMLLIElement {
  const row = doc.createElement('li'); row.className = 'activity-row';
  row.setAttribute('data-kind', entry.kind);
  const description = activityDescription(entry);
  if (!guestView && entry.guestActivityRef !== undefined) {
    const actor = doc.createElement('button'); actor.type = 'button'; actor.className = 'activity-actor-link';
    actor.textContent = entry.actorName;
    actor.setAttribute('data-guest-activity', String(entry.guestActivityRef));
    actor.setAttribute('aria-label', `View activity by ${entry.actorName}`);
    actor.addEventListener('click', () => onGuest(entry.guestActivityRef!, entry.actorName, actor));
    row.append(actor);
  }
  const link = doc.createElement('a'); link.href = entry.contentPath;
  link.textContent = guestView || entry.guestActivityRef !== undefined ? description.slice(entry.actorName.length + 1) : description;
  const slug = entry.kind === 'prompt_result' ? entry.recognition?.promptSlug : null;
  if (slug) {
    link.href = `/?buildPrompt=${encodeURIComponent(slug)}`;
    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const win = doc.defaultView; if (!win) return;
      event.preventDefault(); win.dispatchEvent(new CustomEvent(BUILD_PROMPT_OPEN_REQUEST, { detail: { slug } }));
    });
  }
  const time = doc.createElement('div'); time.className = 'history-modal-meta';
  time.textContent = `v${entry.contentVersion} · ${new Date(entry.createdAt).toLocaleString()}`;
  row.append(link, time);
  if (entry.kind === 'edited' && !guestView) {
    const hint = doc.createElement('div'); hint.className = 'history-modal-meta';
    hint.textContent = "Not what you wanted? Open the room's History to restore your version.";
    row.append(hint);
  }
  return row;
}
