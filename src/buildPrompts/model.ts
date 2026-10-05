export interface BuildPrompt {
  slug: string;
  title: string;
  constraint: string;
  startsAt: string;
  endsAt: string;
  settledAt: string | null;
  entryCount: number;
}
export interface BuildPromptEntry {
  targetKey: string;
  contentType: 'room' | 'expanded_room';
  contentId: string;
  version: number;
  roomId: string;
  roomVersion: number;
  coordinates: { x: number; y: number };
  title: string;
  builderUserId: string;
  builderDisplayName: string;
  cellCount: number;
  legacyCourseId: string | null;
  available: boolean;
  voteCount: number;
  adjustedAverage: number | null;
  winnerRank: number | null;
  submittedAt: string;
}
export interface BuildPromptsResponse {
  serverTime: string;
  current: BuildPrompt | null;
  recent: BuildPrompt[];
  prompt: BuildPrompt | null;
  entries: BuildPromptEntry[];
  nextOffset: number | null;
  viewerEntry: BuildPromptEntry | null;
}
export interface BuildPromptInput {
  slug: string;
  title: string;
  constraint: string;
  startsAt: string;
}
export const BUILD_PROMPT_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const BUILD_PROMPT_PAGE_SIZE = 48;
