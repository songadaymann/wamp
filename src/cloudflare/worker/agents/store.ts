import type {
  AgentAccount,
  AgentTokenCreateRequestBody,
  AgentTokenRecord,
  AgentTokenScope,
} from '../../../agents/model';
import type { ApiTokenScope, AuthUser } from '../../../auth/model';
import { HttpError } from '../core/http';
import type {
  AgentJoinRow,
  AgentRow,
  AgentTokenJoinRow,
  AgentTokenRow,
  Env,
  RequestAuth,
} from '../core/types';
import { generateOpaqueToken, hashToken, normalizeApiTokenScopes } from '../auth/store';

export const AGENT_TOKEN_PREFIX = 'epagt_';
export const DEFAULT_AGENT_TOKEN_SCOPES: AgentTokenScope[] = [
  'rooms:read',
  'rooms:write',
  'leaderboards:read',
];

const AGENT_ALLOWED_SCOPE_SET = new Set<ApiTokenScope>(DEFAULT_AGENT_TOKEN_SCOPES);

export async function findAgentByDisplayName(
  env: Env,
  displayName: string
): Promise<AgentAccount | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        id,
        owner_user_id,
        display_name,
        description,
        avatar_url,
        avatar_seed,
        is_active,
        created_at,
        updated_at
      FROM agents
      WHERE lower(display_name) = lower(?)
      LIMIT 1
    `
  )
    .bind(displayName)
    .first<AgentRow>();

  return row ? mapAgentRow(row) : null;
}

export async function listAgentsForOwner(env: Env, ownerUserId: string): Promise<AgentAccount[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        id,
        owner_user_id,
        display_name,
        description,
        avatar_url,
        avatar_seed,
        is_active,
        created_at,
        updated_at
      FROM agents
      WHERE owner_user_id = ?
      ORDER BY created_at DESC, id DESC
    `
  )
    .bind(ownerUserId)
    .all<AgentRow>();

  return result.results.map(mapAgentRow);
}

export async function loadAgentForOwner(
  env: Env,
  agentId: string,
  ownerUserId: string
): Promise<AgentAccount | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        id,
        owner_user_id,
        display_name,
        description,
        avatar_url,
        avatar_seed,
        is_active,
        created_at,
        updated_at
      FROM agents
      WHERE id = ? AND owner_user_id = ?
      LIMIT 1
    `
  )
    .bind(agentId, ownerUserId)
    .first<AgentRow>();

  return row ? mapAgentRow(row) : null;
}

export async function createAgentForOwner(
  env: Env,
  ownerUserId: string,
  input: {
    displayName: string;
    description: string | null;
    avatarUrl: string | null;
    avatarSeed: string | null;
  }
): Promise<AgentAccount> {
  const now = new Date().toISOString();
  const agent: AgentAccount = {
    id: crypto.randomUUID(),
    ownerUserId,
    displayName: input.displayName,
    description: input.description,
    avatarUrl: input.avatarUrl,
    avatarSeed: input.avatarSeed,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO agents (
          id,
          owner_user_id,
          display_name,
          description,
          avatar_url,
          avatar_seed,
          is_active,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `
    ).bind(
      agent.id,
      agent.ownerUserId,
      agent.displayName,
      agent.description,
      agent.avatarUrl,
      agent.avatarSeed,
      agent.createdAt,
      agent.updatedAt
    ),
  ]);

  return agent;
}

export async function disableAgentForOwner(
  env: Env,
  agentId: string,
  ownerUserId: string,
  updatedAt: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE agents
        SET is_active = 0, updated_at = ?
        WHERE id = ? AND owner_user_id = ?
      `
    ).bind(updatedAt, agentId, ownerUserId),
  ]);
}

export async function listAgentTokensForOwner(
  env: Env,
  agentId: string,
  ownerUserId: string
): Promise<AgentTokenRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        t.id,
        t.agent_id,
        t.label,
        t.scopes_json,
        t.created_at,
        t.last_used_at,
        t.revoked_at
      FROM agent_tokens t
      JOIN agents a ON a.id = t.agent_id
      WHERE t.agent_id = ?
        AND a.owner_user_id = ?
        AND t.revoked_at IS NULL
      ORDER BY t.created_at DESC, t.id DESC
    `
  )
    .bind(agentId, ownerUserId)
    .all<AgentTokenRow & { scopes_json: string }>();

  return result.results.map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    label: row.label,
    scopes: parseStoredAgentTokenScopes(row.scopes_json),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

export async function findAgentTokenIdForOwner(
  env: Env,
  tokenId: string,
  agentId: string,
  ownerUserId: string
): Promise<{ id: string } | null> {
  return env.DB.prepare(
    `
      SELECT t.id
      FROM agent_tokens t
      JOIN agents a ON a.id = t.agent_id
      WHERE t.id = ?
        AND t.agent_id = ?
        AND a.owner_user_id = ?
      LIMIT 1
    `
  )
    .bind(tokenId, agentId, ownerUserId)
    .first<{ id: string }>();
}

export async function createAgentTokenForOwner(
  env: Env,
  ownerUserId: string,
  agentId: string,
  body: AgentTokenCreateRequestBody
): Promise<AgentTokenRecord & { rawToken: string }> {
  const scopes = normalizeAgentTokenScopes(body.scopes);
  const createdAt = new Date().toISOString();
  const tokenId = crypto.randomUUID();
  const rawToken = `${AGENT_TOKEN_PREFIX}${generateOpaqueToken(40)}`;
  const tokenHash = await hashToken(rawToken);

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO agent_tokens (
          id,
          agent_id,
          label,
          token_hash,
          scopes_json,
          created_at,
          last_used_at,
          revoked_at,
          created_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `
    ).bind(tokenId, agentId, body.label, tokenHash, JSON.stringify(scopes), createdAt, ownerUserId),
  ]);

  return {
    id: tokenId,
    agentId,
    label: body.label,
    scopes,
    createdAt,
    lastUsedAt: null,
    revokedAt: null,
    rawToken,
  };
}

export async function revokeAgentTokenForOwner(
  env: Env,
  tokenId: string,
  agentId: string,
  ownerUserId: string,
  revokedAt: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE agent_tokens
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE id = ?
          AND agent_id = ?
          AND agent_id IN (
            SELECT id
            FROM agents
            WHERE owner_user_id = ?
          )
      `
    ).bind(revokedAt, tokenId, agentId, ownerUserId),
  ]);
}

export async function loadAgentTokenAuth(
  env: Env,
  rawToken: string
): Promise<RequestAuth | null> {
  const tokenHash = await hashToken(rawToken);
  const row = await env.DB.prepare(
    `
      SELECT
        t.id,
        t.agent_id,
        t.label,
        t.scopes_json,
        t.created_at,
        t.last_used_at,
        t.revoked_at,
        a.owner_user_id,
        a.display_name AS agent_display_name,
        a.description AS agent_description,
        a.avatar_url AS agent_avatar_url,
        a.avatar_seed AS agent_avatar_seed,
        a.is_active AS agent_is_active,
        a.created_at AS agent_created_at,
        a.updated_at AS agent_updated_at,
        u.email AS owner_email,
        u.wallet_address AS owner_wallet_address,
        u.display_name AS owner_display_name,
        u.created_at AS owner_created_at
      FROM agent_tokens t
      JOIN agents a ON a.id = t.agent_id
      JOIN users u ON u.id = a.owner_user_id
      WHERE t.token_hash = ?
      LIMIT 1
    `
  )
    .bind(tokenHash)
    .first<AgentTokenJoinRow>();

  if (!row || row.revoked_at || row.agent_is_active !== 1) {
    return null;
  }

  const scopes = parseStoredAgentTokenScopes(row.scopes_json);
  const ownerUser: AuthUser = {
    id: row.owner_user_id,
    email: row.owner_email,
    walletAddress: row.owner_wallet_address,
    displayName: row.owner_display_name,
    createdAt: row.owner_created_at,
  };
  const agent = mapAgentFromTokenJoinRow(row);
  const lastUsedAt = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE agent_tokens
        SET last_used_at = ?
        WHERE id = ?
      `
    ).bind(lastUsedAt, row.id),
  ]);

  return {
    source: 'agent_token',
    user: ownerUser,
    principal: {
      kind: 'agent',
      id: agent.id,
      displayName: agent.displayName,
      ownerUserId: ownerUser.id,
      agentId: agent.id,
    },
    agent,
    session: null,
    scopes: scopes as ApiTokenScope[],
    apiToken: null,
    agentToken: {
      id: row.id,
      agentId: row.agent_id,
      label: row.label,
      scopes,
      createdAt: row.created_at,
      lastUsedAt,
      revokedAt: row.revoked_at,
    },
    isAdmin: false,
  };
}

export function normalizeAgentTokenScopes(value: unknown): AgentTokenScope[] {
  if (value === undefined || value === null) {
    return [...DEFAULT_AGENT_TOKEN_SCOPES];
  }

  const scopes = normalizeApiTokenScopes(value);
  const invalid = scopes.filter((scope) => !AGENT_ALLOWED_SCOPE_SET.has(scope));
  if (invalid.length > 0) {
    throw new HttpError(
      400,
      `Agent tokens do not support these scopes yet: ${invalid.join(', ')}`
    );
  }

  const normalized = scopes.filter((scope): scope is AgentTokenScope =>
    AGENT_ALLOWED_SCOPE_SET.has(scope)
  );
  if (normalized.length === 0) {
    throw new HttpError(400, 'Choose at least one agent token scope.');
  }

  return normalized;
}

function parseStoredAgentTokenScopes(raw: string): AgentTokenScope[] {
  try {
    return normalizeAgentTokenScopes(JSON.parse(raw));
  } catch {
    throw new HttpError(500, 'Stored agent token scopes are invalid.');
  }
}

function mapAgentRow(row: AgentRow): AgentAccount {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    displayName: row.display_name,
    description: row.description,
    avatarUrl: row.avatar_url,
    avatarSeed: row.avatar_seed,
    status: row.is_active === 1 ? 'active' : 'disabled',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentJoinRow(row: AgentJoinRow): AgentAccount {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    displayName: row.display_name,
    description: row.description,
    avatarUrl: row.avatar_url,
    avatarSeed: row.avatar_seed,
    status: row.is_active === 1 ? 'active' : 'disabled',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentFromTokenJoinRow(row: AgentTokenJoinRow): AgentAccount {
  return {
    id: row.agent_id,
    ownerUserId: row.owner_user_id,
    displayName: row.agent_display_name,
    description: row.agent_description,
    avatarUrl: row.agent_avatar_url,
    avatarSeed: row.agent_avatar_seed,
    status: row.agent_is_active === 1 ? 'active' : 'disabled',
    createdAt: row.agent_created_at,
    updatedAt: row.agent_updated_at,
  };
}
