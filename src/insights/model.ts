import type { RoomCoordinates } from '../persistence/roomModel';
export interface RoomInsightTarget { contentType: 'room' | 'expanded_room' | 'course'; contentId: string; version?: number }
export interface RoomInsightSummary {
  attempts: number; uniquePlayers: number; completions: number; failures: number; abandonments: number;
  clearRate: number | null; medianClearMs: number | null; averageDeaths: number | null;
  totalDeaths: number; lastPlayedAt: string | null; mappedAttempts: number; mappedDeaths: number;
}
export interface DeathMapCell { roomX: number; roomY: number; tileX: number; tileY: number; deaths: number }
export interface RoomInsightsResponse {
  target: RoomInsightTarget; title: string | null; summary: RoomInsightSummary; deathMap: DeathMapCell[];
  cells: RoomCoordinates[]; deathMapTruncated: boolean;
}
export function insightTargetForRoom(room: { roomId: string; roomVersion: number; expandedRoom?: { expandedRoomId: string; expandedRoomVersion: number | null } | null }): RoomInsightTarget {
  return room.expandedRoom ? { contentType: 'expanded_room', contentId: room.expandedRoom.expandedRoomId, version: room.expandedRoom.expandedRoomVersion ?? room.roomVersion }
    : { contentType: 'room', contentId: room.roomId, version: room.roomVersion };
}
export function insightTargetKey(target: RoomInsightTarget): string {
  return `${target.contentType === 'course' ? 'expanded_room:course' : target.contentType}:${target.contentId}`;
}
export function emptyInsightSummary(): RoomInsightSummary {
  return { attempts: 0, uniquePlayers: 0, completions: 0, failures: 0, abandonments: 0, clearRate: null,
    medianClearMs: null, averageDeaths: null, totalDeaths: 0, lastPlayedAt: null, mappedAttempts: 0, mappedDeaths: 0 };
}
export function insightSummaryText(stats: RoomInsightSummary): string {
  return stats.attempts ? `${stats.attempts.toLocaleString()} attempts · ${stats.completions.toLocaleString()} clears · ${Math.round(stats.clearRate! * 100)}% clear · ${stats.averageDeaths!.toFixed(1)} deaths / attempt` : 'No finished attempts yet';
}
