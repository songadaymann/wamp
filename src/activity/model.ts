type ActivityKind = 'completion' | 'rating' | 'comment' | 'top1' | 'dethroned' | 'edited';
export interface BuilderActivity {
  id: number;
  kind: ActivityKind;
  actorName: string;
  guestActivityRef?: number;
  contentTitle: string;
  contentVersion: number;
  contentPath: string;
  qualityStars: number | null;
  createdAt: string;
  unread: boolean;
}
export interface ActivityPreferences {
  weeklyDigest: boolean;
  dethroneAlerts: boolean;
  dailyFeatures?: boolean;
  emailAvailable: boolean;
}
export interface ActivityFeedResponse {
  entries: BuilderActivity[];
  latestId: number;
  nextBefore: number | null;
}
export interface ActivityResponse extends ActivityFeedResponse {
  unreadCount: number;
  preferences: ActivityPreferences;
}
export interface GuestActivityResponse extends ActivityFeedResponse {
  guestName: string;
}
export function activityDescription(entry: BuilderActivity): string {
  const action = entry.kind === 'completion' ? 'cleared'
    : entry.kind === 'rating' ? `rated${entry.qualityStars === null ? '' : ` ${entry.qualityStars}/5`}`
    : entry.kind === 'comment' ? 'left an approved comment on'
    : entry.kind === 'dethroned' ? 'took your #1 on'
    : entry.kind === 'edited' ? 'published changes to your room' : 'took #1 on';
  return `${entry.actorName} ${action} ${entry.contentTitle}`;
}
