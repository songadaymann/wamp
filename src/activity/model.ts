type ActivityKind = 'completion' | 'rating' | 'comment' | 'top1' | 'dethroned';
export interface BuilderActivity {
  id: number;
  kind: ActivityKind;
  actorName: string;
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
  emailAvailable: boolean;
}
export interface ActivityResponse {
  entries: BuilderActivity[];
  unreadCount: number;
  latestId: number;
  nextBefore: number | null;
  preferences: ActivityPreferences;
}
export function activityDescription(entry: BuilderActivity): string {
  const action = entry.kind === 'completion' ? 'cleared'
    : entry.kind === 'rating' ? `rated${entry.qualityStars === null ? '' : ` ${entry.qualityStars}/5`}`
    : entry.kind === 'comment' ? 'left an approved comment on'
    : entry.kind === 'dethroned' ? 'took your #1 on' : 'took #1 on';
  return `${entry.actorName} ${action} ${entry.contentTitle}`;
}
