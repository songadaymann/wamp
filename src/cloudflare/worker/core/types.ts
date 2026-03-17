import type { ApiTokenRecord, ApiTokenScope, AuthUser } from '../../../auth/model';
import type {
  AgentAccount,
  AgentTokenRecord,
  RequestAuthSource,
  RequestPrincipal,
} from '../../../agents/model';
import type { CourseSnapshot } from '../../../courses/model';
import type { RoomCoordinates, RoomRecord, RoomSnapshot, RoomVersionRecord } from '../../../persistence/roomModel';
import type { RunResult } from '../../../runs/model';

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
}

export interface AssetsBinding {
  fetch(request: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  ASSETS: AssetsBinding;
  DB: D1Database;
  ADMIN_API_KEY?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_DEBUG_MAGIC_LINKS?: string;
  APP_BASE_URL?: string;
  ENABLE_TEST_RESET?: string;
  ROOM_DAILY_CLAIM_LIMIT?: string;
  ROOM_MINT_CHAIN_ID?: string;
  ROOM_MINT_CHAIN_NAME?: string;
  ROOM_MINT_DISABLED?: string;
  ROOM_MINT_AUTH_PRIVATE_KEY?: string;
  ROOM_MINT_RPC_URL?: string;
  ROOM_MINT_CONTRACT_ADDRESS?: string;
  ROOM_MINT_BLOCK_EXPLORER_URL?: string;
  PLAYFUN_ENABLED?: string;
  PLAYFUN_API_KEY?: string;
  PLAYFUN_SECRET_KEY?: string;
  PLAYFUN_GAME_ID?: string;
  PLAYFUN_BASE_URL?: string;
}

export interface RoomRow {
  id: string;
  x: number;
  y: number;
  draft_json: string;
  published_json: string | null;
  draft_title: string | null;
  published_title: string | null;
  claimer_user_id: string | null;
  claimer_principal_type: 'user' | 'agent' | null;
  claimer_agent_id: string | null;
  claimer_display_name: string | null;
  claimed_at: string | null;
  last_published_by_user_id: string | null;
  last_published_by_principal_type: 'user' | 'agent' | null;
  last_published_by_agent_id: string | null;
  last_published_by_display_name: string | null;
  minted_chain_id: number | null;
  minted_contract_address: string | null;
  minted_token_id: string | null;
  minted_owner_wallet_address: string | null;
  minted_owner_synced_at: string | null;
}

export interface RoomVersionRow {
  version: number;
  snapshot_json: string;
  title: string | null;
  created_at: string;
  published_by_user_id: string | null;
  published_by_principal_type: 'user' | 'agent' | null;
  published_by_agent_id: string | null;
  published_by_display_name: string | null;
  reverted_from_version: number | null;
}

export interface AgentRow {
  id: string;
  owner_user_id: string;
  display_name: string;
  description: string | null;
  avatar_url: string | null;
  avatar_seed: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AgentTokenRow {
  id: string;
  agent_id: string;
  label: string;
  scopes_json: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface AgentJoinRow extends AgentRow {
  owner_email: string | null;
  owner_wallet_address: string | null;
  owner_display_name: string;
  owner_created_at: string;
}

export interface AgentTokenJoinRow extends AgentTokenRow {
  owner_user_id: string;
  agent_display_name: string;
  agent_description: string | null;
  agent_avatar_url: string | null;
  agent_avatar_seed: string | null;
  agent_is_active: number;
  agent_created_at: string;
  agent_updated_at: string;
  owner_email: string | null;
  owner_wallet_address: string | null;
  owner_display_name: string;
  owner_created_at: string;
}

export interface CourseRow {
  id: string;
  owner_user_id: string;
  owner_display_name: string;
  draft_json: string;
  published_json: string | null;
  draft_title: string | null;
  published_title: string | null;
  draft_version: number;
  published_version: number | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface CourseVersionRow {
  version: number;
  snapshot_json: string;
  title: string | null;
  created_at: string;
  published_by_user_id: string | null;
  published_by_display_name: string | null;
}

export interface CourseRoomRefRow {
  course_id: string;
  course_version: number;
  room_order: number;
  room_id: string;
  room_x: number;
  room_y: number;
  room_version: number;
  room_title: string | null;
}

export interface PersistRoomRecordInput {
  draft: RoomSnapshot;
  published: RoomSnapshot | null;
  claimerUserId: string | null;
  claimerPrincipalType: 'user' | 'agent' | null;
  claimerAgentId: string | null;
  claimerDisplayName: string | null;
  claimedAt: string | null;
  lastPublishedByUserId: string | null;
  lastPublishedByPrincipalType: 'user' | 'agent' | null;
  lastPublishedByAgentId: string | null;
  lastPublishedByDisplayName: string | null;
  mintedChainId: number | null;
  mintedContractAddress: string | null;
  mintedTokenId: string | null;
  mintedOwnerWalletAddress: string | null;
  mintedOwnerSyncedAt: string | null;
}

export interface PersistRoomVersionInput {
  snapshot: RoomSnapshot;
  createdAt: string;
  publishedByUserId: string | null;
  publishedByPrincipalType: 'user' | 'agent' | null;
  publishedByAgentId: string | null;
  publishedByDisplayName: string | null;
  revertedFromVersion: number | null;
  onConflictUpdate: boolean;
}

export interface PersistCourseRecordInput {
  draft: CourseSnapshot;
  published: CourseSnapshot | null;
  ownerUserId: string;
  ownerDisplayName: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface PersistCourseVersionInput {
  snapshot: CourseSnapshot;
  createdAt: string;
  publishedByUserId: string | null;
  publishedByDisplayName: string | null;
  onConflictUpdate: boolean;
}

export interface CourseRunRow {
  attempt_id: string;
  course_id: string;
  course_version: number;
  goal_type: string;
  goal_json: string;
  user_id: string;
  user_display_name: string;
  started_at: string;
  finished_at: string | null;
  result: RunResult;
  elapsed_ms: number | null;
  deaths: number;
  score: number;
  collectibles_collected: number;
  enemies_defeated: number;
  checkpoints_reached: number;
}

export interface RoomRunRow {
  attempt_id: string;
  room_id: string;
  room_x: number;
  room_y: number;
  room_version: number;
  goal_type: string;
  goal_json: string;
  user_id: string;
  user_display_name: string;
  started_at: string;
  finished_at: string | null;
  result: RunResult;
  elapsed_ms: number | null;
  deaths: number;
  score: number;
  collectibles_collected: number;
  enemies_defeated: number;
  checkpoints_reached: number;
}

export interface UserStatsRow {
  user_id: string;
  user_display_name: string;
  total_points: number;
  total_score: number;
  total_deaths: number;
  total_collectibles: number;
  total_enemies_defeated: number;
  total_checkpoints: number;
  total_rooms_published: number;
  completed_runs: number;
  failed_runs: number;
  abandoned_runs: number;
  best_score: number;
  fastest_clear_ms: number | null;
  updated_at: string;
}

export interface PointEventRow {
  id: string;
  user_id: string;
  event_type: string;
  source_key: string;
  points: number;
  breakdown_json: string | null;
  created_at: string;
}

export interface PlayfunPointSyncRow {
  point_event_id: string;
  user_id: string;
  ogp_id: string;
  points: number;
  status: 'pending' | 'sent' | 'failed' | string;
  attempt_count: number;
  created_at: string;
  last_attempted_at: string | null;
  synced_at: string | null;
  last_error: string | null;
}

export interface PlayfunUserLinkRow {
  user_id: string;
  ogp_id: string;
  player_id: string | null;
  game_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  user_id: string;
  user_display_name: string;
  body: string;
  created_at: string;
}

export interface UserRow {
  id: string;
  email: string | null;
  wallet_address: string | null;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface SessionJoinRow {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
  email: string | null;
  wallet_address: string | null;
  display_name: string;
  user_created_at: string;
}

export interface MagicLinkJoinRow {
  id: string;
  user_id: string;
  email: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
  wallet_address: string | null;
  display_name: string;
  user_created_at: string;
}

export interface WalletChallengeRow {
  id: string;
  address: string;
  nonce_hash: string;
  message_text: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface ApiTokenRow {
  id: string;
  user_id: string;
  label: string;
  scopes_json: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  email: string | null;
  wallet_address: string | null;
  display_name: string;
  user_created_at: string;
}

export interface AuthSession {
  sessionId: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
  user: AuthUser;
}

export interface RequestAuth {
  source: RequestAuthSource;
  user: AuthUser;
  principal: RequestPrincipal;
  agent: AgentAccount | null;
  session: AuthSession | null;
  scopes: ApiTokenScope[] | null;
  apiToken: ApiTokenRecord | null;
  agentToken: AgentTokenRecord | null;
  isAdmin: boolean;
}

export interface RoomMintConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  contractAddress: `0x${string}`;
  blockExplorerUrl: string | null;
}

export interface RoomMintChainState {
  chainId: number;
  contractAddress: string;
  tokenId: string;
  ownerWalletAddress: string;
  ownerSyncedAt: string;
}

export interface RoomMutationLoadOptions {
  roomId: string;
  coordinates: RoomCoordinates;
  actor: AuthUser | null;
}

export type RoomPermissionsBuilder = (
  record: RoomRecord,
  viewerUserId: string | null,
  viewerWalletAddress: string | null,
  viewerIsAdmin?: boolean
) => RoomRecord['permissions'];

export type RoomVersionListLoader = (env: Env, roomId: string) => Promise<RoomVersionRecord[]>;
