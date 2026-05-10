import type { ApiTokenRecord, ApiTokenScope, AuthUser } from '../../../auth/model';
import type { AgentAccount, AgentTokenRecord, RequestAuthSource, RequestPrincipal } from '../../../agents/model';
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
  CHAT_OWNER_EMAILS?: string;
  PARTYKIT_HOST?: string;
  PARTYKIT_PARTY?: string;
  PARTYKIT_INTERNAL_TOKEN?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_DEBUG_MAGIC_LINKS?: string;
  AUTH_TRUSTED_REDIRECT_HOSTS?: string;
  APP_BASE_URL?: string;
  REOWN_PROJECT_ID?: string;
  VITE_REOWN_PROJECT_ID?: string;
  WALLET_CONNECT_PROJECT_ID?: string;
  VITE_WALLET_CONNECT_PROJECT_ID?: string;
  ENABLE_TEST_RESET?: string;
  ROOM_DAILY_CLAIM_LIMIT?: string;
  ROOM_DAILY_PUBLISH_LIMIT?: string;
  PLAYFUN_ROOM_DAILY_CLAIM_LIMIT?: string;
  PLAYFUN_ROOM_MAX_PLACED_OBJECTS?: string;
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
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_IMAGES_API_TOKEN?: string;
  CLOUDFLARE_IMAGES_ACCOUNT_HASH?: string;
  CLOUDFLARE_IMAGES_BACKGROUND_VARIANT?: string;
  CLOUDFLARE_IMAGES_THUMB_VARIANT?: string;
  BACKGROUND_UPLOAD_MAX_BYTES?: string;
  BACKGROUND_UPLOAD_MIN_TRUST_TIER?: string;
  BACKGROUND_UPLOAD_AUTO_APPROVE_TRUST_TIER?: string;
  BACKGROUND_UPLOAD_SKIP_AI_MODERATION?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_IMAGE_MODERATION_MODEL?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  GUESTBOOK_IP_HASH_SALT?: string;
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
  minted_metadata_room_version: number | null;
  minted_metadata_updated_at: string | null;
  minted_metadata_hash: string | null;
  canonical_version: number | null;
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
  leaderboard_source_version: number | null;
}

export interface MusicPhraseBatchRow {
  id: string;
  room_id: string;
  room_version: number;
  room_title: string | null;
  room_x: number;
  room_y: number;
  creator_user_id: string | null;
  creator_principal_type: 'user' | 'agent' | null;
  creator_agent_id: string | null;
  creator_display_name: string;
  created_at: string;
}

export interface MusicPhraseRow {
  id: string;
  batch_id: string;
  room_id: string;
  room_version: number;
  room_title: string | null;
  room_x: number;
  room_y: number;
  creator_user_id: string | null;
  creator_principal_type: 'user' | 'agent' | null;
  creator_agent_id: string | null;
  creator_display_name: string;
  instrument_id: string;
  ordinal: number;
  label: string;
  fingerprint: string;
  payload_json: string;
  source_key_tonic: string | null;
  source_key_mode: string | null;
  created_at: string;
}

export interface MusicPhraseJoinRow extends MusicPhraseRow {
  source_phrase_ids_csv: string | null;
}

export interface GuestbookEntryRow {
  id: string;
  display_name: string;
  body: string;
  user_id: string | null;
  guest_session_id?: string | null;
  ip_hash?: string | null;
  user_agent?: string | null;
  turnstile_verified_at?: string | null;
  created_at: string;
  hidden_at?: string | null;
  hidden_by_user_id?: string | null;
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
  canonicalVersion: number | null;
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
  mintedMetadataRoomVersion: number | null;
  mintedMetadataUpdatedAt: string | null;
  mintedMetadataHash: string | null;
}

export interface PersistRoomVersionInput {
  snapshot: RoomSnapshot;
  createdAt: string;
  publishedByUserId: string | null;
  publishedByPrincipalType: 'user' | 'agent' | null;
  publishedByAgentId: string | null;
  publishedByDisplayName: string | null;
  revertedFromVersion: number | null;
  leaderboardSourceVersion: number | null;
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
  verification_status?: 'not_required' | 'passed' | 'failed' | 'timeout' | null;
  verification_reason?: string | null;
  verification_nonce?: string | null;
  verification_snapshot_hash?: string | null;
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
  verification_status?: 'not_required' | 'passed' | 'failed' | 'timeout' | null;
  verification_reason?: string | null;
  verification_nonce?: string | null;
  verification_snapshot_hash?: string | null;
}

export interface RoomRushRunRow {
  attempt_id: string;
  client_run_id: string;
  user_id: string;
  user_display_name: string;
  difficulty: string;
  start_rule: string;
  result: RunResult;
  unique_rooms: number;
  elapsed_ms: number;
  deaths: number;
  start_room_id: string;
  start_x: number;
  start_y: number;
  finish_room_id: string;
  finish_x: number;
  finish_y: number;
  route_json: string;
  finished_at: string;
  created_at: string;
}

export interface RoomDifficultyVoteRow {
  room_id: string;
  room_version: number;
  user_id: string;
  difficulty: string;
  created_at: string;
  updated_at: string;
  carried_from_version: number | null;
}

export interface UserProgressRow {
  user_id: string;
  total_pxp: number;
  total_bxp: number;
  total_cxp: number;
  player_level: number;
  builder_level: number;
  curator_level: number;
  hidden_trust_score: number;
  trust_tier_internal: string;
  founder_number: number | null;
  builder_claim_limit_override: number | null;
  builder_publish_limit_override: number | null;
  builder_object_limit_override: number | null;
  builder_collectible_limit_override: number | null;
  builder_cap_override_reason: string | null;
  builder_cap_override_updated_at: string | null;
  builder_cap_override_updated_by: string | null;
  badge_count: number;
  trophy_count: number;
  first_identity_qualified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BackgroundImageUploadRow {
  id: string;
  cloudflare_image_id: string;
  owner_user_id: string;
  owner_display_name: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  image_width: number | null;
  image_height: number | null;
  status: string;
  moderation_status: string;
  moderation_score: number | null;
  moderation_labels_json: string | null;
  moderation_reason: string | null;
  moderation_model: string | null;
  upload_requested_at: string;
  uploaded_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_reason: string | null;
  cloudflare_deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BackgroundUploadPermissionRow {
  user_id: string;
  can_upload: number;
  auto_approve: number;
  reason: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface ProgressEventRow {
  id: string;
  user_id: string;
  event_type: string;
  source_type: string;
  source_id: string;
  dedupe_key: string;
  amount: number;
  breakdown_json: string | null;
  created_at: string;
}

export interface RoomRatingRow {
  room_id: string;
  lineage_key: string;
  version_key: number;
  user_id: string;
  quality_stars: number | null;
  difficulty_choice: string | null;
  auto_difficulty_choice: string | null;
  trust_weight: number;
  completed_attempt_id: string | null;
  first_rated_at: string;
  updated_at: string;
  rewarded_at: string | null;
}

export interface CourseRatingRow {
  course_id: string;
  lineage_key: string;
  version_key: number;
  user_id: string;
  quality_stars: number | null;
  difficulty_choice: string | null;
  auto_difficulty_choice: string | null;
  trust_weight: number;
  completed_attempt_id: string | null;
  first_rated_at: string;
  updated_at: string;
  rewarded_at: string | null;
}

export interface ContentTrophyRow {
  content_type: string;
  content_id: string;
  version_key: number;
  trophy_type: string;
  metric_value: number;
  weighted_vote_count: number;
  awarded_at: string;
}

export interface BadgeAwardRow {
  user_id: string;
  badge_id: string;
  source_type: string;
  source_id: string;
  metadata_json: string | null;
  awarded_at: string;
}

export interface RoomVersionAttributionRow {
  room_id: string;
  version_key: number;
  prior_version_key: number | null;
  percent_change: number;
  contributor_weight_breakdown: string;
  created_at: string;
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

export interface SuspiciousInvalidationAuditRow {
  id: string;
  target_user_id: string;
  target_user_display_name: string;
  operator_label: string;
  reason: string;
  room_run_attempt_ids_json: string;
  course_run_attempt_ids_json: string;
  affected_point_event_ids_json: string;
  affected_playfun_sync_json: string;
  affected_creator_user_ids_json: string;
  remote_follow_up_required: number;
  snapshot_json: string;
  created_at: string;
}

export interface ChatMessageRow {
  id: string;
  user_id: string;
  user_display_name: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  deleted_by_user_id: string | null;
}

export interface ChatAdminRow {
  user_id: string;
  display_name: string;
  granted_by_user_id: string;
  granted_by_display_name: string | null;
  created_at: string;
}

export interface ChatBanRow {
  user_id: string;
  display_name: string;
  banned_by_user_id: string;
  banned_by_display_name: string | null;
  created_at: string;
}

export interface UserRow {
  id: string;
  email: string | null;
  wallet_address: string | null;
  display_name: string;
  username?: string | null;
  avatar_url: string | null;
  bio: string | null;
  selected_avatar_id: string | null;
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
  username?: string | null;
  avatar_url: string | null;
  bio: string | null;
  selected_avatar_id: string | null;
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
  username?: string | null;
  avatar_url: string | null;
  bio: string | null;
  selected_avatar_id: string | null;
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
  username?: string | null;
  avatar_url: string | null;
  bio: string | null;
  selected_avatar_id: string | null;
  user_created_at: string;
}

export interface CryptopunkAvatarPackRow {
  punk_id: number;
  avatar_id: string;
  status: string;
  requested_by_user_id: string | null;
  request_count: number;
  generation_job_id: string | null;
  asset_base_url: string | null;
  manifest_url: string | null;
  head_image_url: string | null;
  base_texture_url: string | null;
  base_atlas_url: string | null;
  combat_texture_url: string | null;
  combat_atlas_url: string | null;
  punk_type: string | null;
  accessories_json: string | null;
  error_message: string | null;
  created_at: string;
  requested_at: string | null;
  generation_started_at: string | null;
  generated_at: string | null;
  updated_at: string;
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
