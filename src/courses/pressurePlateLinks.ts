import type { CoursePressurePlateLink, CourseSnapshot } from './model';

function getTriggerKey(triggerRoomId: string, triggerInstanceId: string): string {
  return `${triggerRoomId}:${triggerInstanceId}`;
}

export function getCoursePressurePlateLink(
  snapshot: CourseSnapshot | null,
  triggerRoomId: string,
  triggerInstanceId: string
): CoursePressurePlateLink | null {
  if (!snapshot) {
    return null;
  }

  return (
    snapshot.pressurePlateLinks.find(
      (link) =>
        link.triggerRoomId === triggerRoomId &&
        link.triggerInstanceId === triggerInstanceId
    ) ?? null
  );
}

export function setCoursePressurePlateLink(
  snapshot: CourseSnapshot,
  link: CoursePressurePlateLink | null,
  source: { triggerRoomId: string; triggerInstanceId: string }
): void {
  const sourceKey = getTriggerKey(source.triggerRoomId, source.triggerInstanceId);
  const nextLinks = snapshot.pressurePlateLinks.filter(
    (entry) => getTriggerKey(entry.triggerRoomId, entry.triggerInstanceId) !== sourceKey
  );
  if (link) {
    nextLinks.push(link);
  }
  snapshot.pressurePlateLinks = nextLinks;
}

export function clearCoursePressurePlateLinksForInstance(
  snapshot: CourseSnapshot,
  roomId: string,
  instanceId: string
): void {
  snapshot.pressurePlateLinks = snapshot.pressurePlateLinks.filter(
    (link) =>
      !(
        (link.triggerRoomId === roomId && link.triggerInstanceId === instanceId) ||
        (link.targetRoomId === roomId && link.targetInstanceId === instanceId)
      )
  );
}
