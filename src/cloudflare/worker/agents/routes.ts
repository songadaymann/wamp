import type {
  AgentAccountCreateRequestBody,
  AgentAccountCreateResponse,
  AgentAccountListResponse,
  AgentTokenCreateRequestBody,
  AgentTokenCreateResponse,
  AgentTokenListResponse,
} from '../../../agents/model';
import { HttpError, jsonResponse, noContentResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { requireCurrentSession } from '../auth/request';
import { findUserByDisplayName } from '../auth/store';
import {
  createAgentForOwner,
  createAgentTokenForOwner,
  disableAgentForOwner,
  findAgentByDisplayName,
  findAgentTokenIdForOwner,
  listAgentsForOwner,
  listAgentTokensForOwner,
  loadAgentForOwner,
  revokeAgentTokenForOwner,
} from './store';

export async function handleAgentRequest(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === '/api/agents' && request.method === 'GET') {
    return handleListAgents(request, env);
  }

  if (url.pathname === '/api/agents' && request.method === 'POST') {
    return handleCreateAgent(request, env);
  }

  const agentMatch = /^\/api\/agents\/([^/]+)$/.exec(url.pathname);
  if (agentMatch && request.method === 'DELETE') {
    return handleDisableAgent(request, env, decodeURIComponent(agentMatch[1]));
  }

  const agentTokensMatch = /^\/api\/agents\/([^/]+)\/tokens$/.exec(url.pathname);
  if (agentTokensMatch && request.method === 'GET') {
    return handleListAgentTokens(request, env, decodeURIComponent(agentTokensMatch[1]));
  }
  if (agentTokensMatch && request.method === 'POST') {
    return handleCreateAgentToken(request, env, decodeURIComponent(agentTokensMatch[1]));
  }

  const agentTokenDeleteMatch = /^\/api\/agents\/([^/]+)\/tokens\/([^/]+)$/.exec(url.pathname);
  if (agentTokenDeleteMatch && request.method === 'DELETE') {
    return handleDeleteAgentToken(
      request,
      env,
      decodeURIComponent(agentTokenDeleteMatch[1]),
      decodeURIComponent(agentTokenDeleteMatch[2])
    );
  }

  throw new HttpError(404, 'Agent route not found.');
}

async function handleListAgents(request: Request, env: Env): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'manage agents');
  const responseBody: AgentAccountListResponse = {
    agents: await listAgentsForOwner(env, session.user.id),
  };
  return jsonResponse(request, responseBody);
}

async function handleCreateAgent(request: Request, env: Env): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'create agents');
  const body = await parseAgentCreateBody(request);
  const existingUser = await findUserByDisplayName(env, body.displayName);
  if (existingUser) {
    throw new HttpError(409, 'That agent display name is already claimed by a user.');
  }
  const existingAgent = await findAgentByDisplayName(env, body.displayName);
  if (existingAgent) {
    throw new HttpError(409, 'That agent display name has already been claimed.');
  }

  const responseBody: AgentAccountCreateResponse = {
    agent: await createAgentForOwner(env, session.user.id, body),
  };
  return jsonResponse(request, responseBody, { status: 201 });
}

async function handleDisableAgent(
  request: Request,
  env: Env,
  agentId: string
): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'disable agents');
  const existing = await loadAgentForOwner(env, agentId, session.user.id);
  if (!existing) {
    throw new HttpError(404, 'Agent not found.');
  }

  await disableAgentForOwner(env, agentId, session.user.id, new Date().toISOString());
  return noContentResponse(request);
}

async function handleListAgentTokens(
  request: Request,
  env: Env,
  agentId: string
): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'manage agent tokens');
  const existing = await loadAgentForOwner(env, agentId, session.user.id);
  if (!existing) {
    throw new HttpError(404, 'Agent not found.');
  }

  const responseBody: AgentTokenListResponse = {
    tokens: await listAgentTokensForOwner(env, agentId, session.user.id),
  };
  return jsonResponse(request, responseBody);
}

async function handleCreateAgentToken(
  request: Request,
  env: Env,
  agentId: string
): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'manage agent tokens');
  const existing = await loadAgentForOwner(env, agentId, session.user.id);
  if (!existing) {
    throw new HttpError(404, 'Agent not found.');
  }
  if (existing.status !== 'active') {
    throw new HttpError(409, 'Disabled agents cannot receive new tokens.');
  }

  const body = await parseAgentTokenCreateBody(request);
  const created = await createAgentTokenForOwner(env, session.user.id, agentId, body);
  const responseBody: AgentTokenCreateResponse = {
    token: created.rawToken,
    record: {
      id: created.id,
      agentId: created.agentId,
      label: created.label,
      scopes: created.scopes,
      createdAt: created.createdAt,
      lastUsedAt: created.lastUsedAt,
      revokedAt: created.revokedAt,
    },
  };
  return jsonResponse(request, responseBody, { status: 201 });
}

async function handleDeleteAgentToken(
  request: Request,
  env: Env,
  agentId: string,
  tokenId: string
): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'manage agent tokens');
  const existing = await findAgentTokenIdForOwner(env, tokenId, agentId, session.user.id);
  if (!existing) {
    throw new HttpError(404, 'Agent token not found.');
  }

  await revokeAgentTokenForOwner(env, tokenId, agentId, session.user.id, new Date().toISOString());
  return noContentResponse(request);
}

async function parseAgentCreateBody(
  request: Request
): Promise<Required<Omit<AgentAccountCreateRequestBody, never>>> {
  const body = await parseJsonBody<AgentAccountCreateRequestBody>(request);
  const displayName = normalizeDisplayName(body.displayName);
  const description = normalizeOptionalText(body.description, 280);
  const avatarUrl = normalizeOptionalText(body.avatarUrl, 512);
  const avatarSeed = normalizeOptionalText(body.avatarSeed, 128);

  if (!displayName) {
    throw new HttpError(400, 'displayName is required.');
  }

  if (displayName.length > 24) {
    throw new HttpError(400, 'Display name must be 24 characters or fewer.');
  }

  return {
    displayName,
    description,
    avatarUrl,
    avatarSeed,
  };
}

async function parseAgentTokenCreateBody(request: Request): Promise<AgentTokenCreateRequestBody> {
  const body = await parseJsonBody<AgentTokenCreateRequestBody>(request);
  const label = typeof body.label === 'string' ? body.label.trim() : '';

  if (!label) {
    throw new HttpError(400, 'label is required.');
  }

  if (label.length > 64) {
    throw new HttpError(400, 'label must be 64 characters or fewer.');
  }

  return {
    label,
    scopes: body.scopes ?? null,
  };
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}
