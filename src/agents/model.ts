import type { ApiTokenScope } from '../auth/model';

export type AgentStatus = 'active' | 'disabled';
export type PrincipalKind = 'user' | 'agent';
export type RequestAuthSource = 'session' | 'playfun' | 'api_token' | 'agent_token';

export const AGENT_TOKEN_SCOPES = [
  'rooms:read',
  'rooms:write',
  'leaderboards:read',
] as const;

export type AgentTokenScope = typeof AGENT_TOKEN_SCOPES[number];

export interface AgentAccount {
  id: string;
  ownerUserId: string;
  displayName: string;
  description: string | null;
  avatarUrl: string | null;
  avatarSeed: string | null;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTokenRecord {
  id: string;
  agentId: string;
  label: string;
  scopes: AgentTokenScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface RequestPrincipal {
  kind: PrincipalKind;
  id: string;
  displayName: string;
  ownerUserId: string;
  agentId: string | null;
}

export interface AgentAccountListResponse {
  agents: AgentAccount[];
}

export interface AgentAccountCreateRequestBody {
  displayName: string;
  description?: string | null;
  avatarUrl?: string | null;
  avatarSeed?: string | null;
}

export interface AgentAccountCreateResponse {
  agent: AgentAccount;
}

export interface AgentTokenListResponse {
  tokens: AgentTokenRecord[];
}

export interface AgentTokenCreateRequestBody {
  label: string;
  scopes?: AgentTokenScope[] | null;
}

export interface AgentTokenCreateResponse {
  token: string;
  record: AgentTokenRecord;
}

export function normalizeAgentTokenScopeList(scopes: ApiTokenScope[]): AgentTokenScope[] {
  return AGENT_TOKEN_SCOPES.filter((scope) =>
    scopes.includes(scope as ApiTokenScope)
  ) as AgentTokenScope[];
}
