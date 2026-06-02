import {
  clearCourseObjectLinksForInstance,
  getCourseObjectLink,
  setCourseObjectLink,
} from './objectLinks';
import type { CoursePressurePlateLink, CourseSnapshot } from './model';

export function getCoursePressurePlateLink(
  snapshot: CourseSnapshot | null,
  triggerRoomId: string,
  triggerInstanceId: string
): CoursePressurePlateLink | null {
  return getCourseObjectLink(snapshot, triggerRoomId, triggerInstanceId);
}

export function setCoursePressurePlateLink(
  snapshot: CourseSnapshot,
  link: CoursePressurePlateLink | null,
  source: { triggerRoomId: string; triggerInstanceId: string }
): void {
  setCourseObjectLink(snapshot, link, source);
}

export function clearCoursePressurePlateLinksForInstance(
  snapshot: CourseSnapshot,
  roomId: string,
  instanceId: string
): void {
  clearCourseObjectLinksForInstance(snapshot, roomId, instanceId);
}
