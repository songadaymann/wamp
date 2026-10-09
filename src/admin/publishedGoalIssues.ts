export type PublishedGoalIssueKind = 'missing_exit' | 'missing_finish' | 'no_enemies';

export interface PublishedGoalIssue {
  roomId: string;
  x: number;
  y: number;
  title: string | null;
  version: number;
  issue: PublishedGoalIssueKind;
}

export interface PublishedGoalIssuesResponse {
  generatedAt: string;
  counts: Record<PublishedGoalIssueKind, number>;
  items: PublishedGoalIssue[];
  nextCursor: string | null;
}

export function getPublishedGoalIssueText(issue: PublishedGoalIssueKind): string {
  switch (issue) {
    case 'missing_exit': return 'Reach Exit has no exit marker';
    case 'missing_finish': return 'Checkpoint Sprint has no finish marker';
    case 'no_enemies': return 'Defeat All has no enemies';
  }
}
