type ActivityKind = 'completion' | 'rating' | 'comment' | 'top1' | 'dethroned' | 'edited' | 'featured' | 'daily' | 'prompt_result';
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
  recognition?: { promptSlug?: string; promptTitle?: string; rank?: number | null; entryCount?: number; date?: string };
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
  if (entry.kind === 'featured') return `${entry.contentTitle} was added to Featured`;
  if (entry.kind === 'daily') return `${entry.contentTitle} is Room of the Day${entry.recognition?.date ? ` for ${entry.recognition.date}` : ''}`;
  if (entry.kind === 'prompt_result') {
    const prompt = entry.recognition?.promptTitle || 'Build Prompt';
    return entry.recognition?.rank ? `${entry.contentTitle} placed #${entry.recognition.rank} in ${prompt}`
      : `${prompt} results are in: ${entry.recognition?.entryCount ?? 0} entries. Your entry: ${entry.contentTitle}`;
  }
  const action = entry.kind === 'completion' ? 'cleared'
    : entry.kind === 'rating' ? `rated${entry.qualityStars === null ? '' : ` ${entry.qualityStars}/5`}`
    : entry.kind === 'comment' ? 'left an approved comment on'
    : entry.kind === 'dethroned' ? 'took your #1 on'
    : entry.kind === 'edited' ? 'published changes to your room' : 'took #1 on';
  return `${entry.actorName} ${action} ${entry.contentTitle}`;
}
