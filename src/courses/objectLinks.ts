import type { CourseObjectLink, CourseSnapshot } from './model';

function getSourceKey(sourceRoomId: string, sourceInstanceId: string): string {
  return `${sourceRoomId}:${sourceInstanceId}`;
}

function getSnapshotObjectLinks(snapshot: CourseSnapshot): CourseObjectLink[] {
  return Array.isArray(snapshot.objectLinks)
    ? snapshot.objectLinks
    : snapshot.pressurePlateLinks;
}

function setSnapshotObjectLinks(snapshot: CourseSnapshot, links: CourseObjectLink[]): void {
  snapshot.objectLinks = links;
  snapshot.pressurePlateLinks = links.map((link) => ({ ...link }));
}

export function getCourseObjectLink(
  snapshot: CourseSnapshot | null,
  sourceRoomId: string,
  sourceInstanceId: string
): CourseObjectLink | null {
  if (!snapshot) {
    return null;
  }

  return (
    getSnapshotObjectLinks(snapshot).find(
      (link) =>
        link.triggerRoomId === sourceRoomId &&
        link.triggerInstanceId === sourceInstanceId
    ) ?? null
  );
}

export function setCourseObjectLink(
  snapshot: CourseSnapshot,
  link: CourseObjectLink | null,
  source: { triggerRoomId: string; triggerInstanceId: string }
): void {
  const sourceKey = getSourceKey(source.triggerRoomId, source.triggerInstanceId);
  const nextLinks = getSnapshotObjectLinks(snapshot).filter(
    (entry) => getSourceKey(entry.triggerRoomId, entry.triggerInstanceId) !== sourceKey
  );
  if (link) {
    nextLinks.push(link);
  }
  setSnapshotObjectLinks(snapshot, nextLinks);
}

export function clearCourseObjectLinksForInstance(
  snapshot: CourseSnapshot,
  roomId: string,
  instanceId: string
): void {
  setSnapshotObjectLinks(
    snapshot,
    getSnapshotObjectLinks(snapshot).filter(
      (link) =>
        !(
          (link.triggerRoomId === roomId && link.triggerInstanceId === instanceId) ||
          (link.targetRoomId === roomId && link.targetInstanceId === instanceId)
        )
    )
  );
}
