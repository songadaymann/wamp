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
  const time = doc.createElement('div'); time.className = 'history-modal-meta';
  time.textContent = `v${entry.contentVersion} · ${new Date(entry.createdAt).toLocaleString()}`;
  row.append(link, time); return row;
}
