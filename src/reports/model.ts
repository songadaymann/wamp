export const REPORT_TARGET_TYPES = ['room', 'user', 'chat_message', 'guest_room'] as const;
export type ReportTargetType = typeof REPORT_TARGET_TYPES[number];

export const REPORT_REASONS = ['offensive', 'harassment', 'spam', 'cheating', 'other'] as const;
export type ReportReason = typeof REPORT_REASONS[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  offensive: 'Offensive or inappropriate',
  harassment: 'Harassment or bullying',
  spam: 'Spam or vandalism',
  cheating: 'Cheating',
  other: 'Something else',
};

export const REPORT_DETAILS_LIMIT = 500;

export interface ReportTarget {
  type: ReportTargetType;
  id: string;
  /** What the player sees, e.g. a room title or a player's name. */
  label: string;
}

export interface ContentReportRequestBody {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string;
}

export interface ContentReportResponse {
  ok: true;
  alreadyReported: boolean;
}

export interface AdminContentReport {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  targetLabel: string;
  targetUserId: string | null;
  reason: ReportReason;
  details: string;
  reporterSignedIn: boolean;
  status: 'open' | 'resolved' | 'dismissed';
  openReportsForTarget: number;
  createdAt: string;
}

export interface AdminContentReportsResponse {
  reports: AdminContentReport[];
}
