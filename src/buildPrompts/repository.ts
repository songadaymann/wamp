import { apiRequest } from '../api/request';
import type { BuildPrompt, BuildPromptEntry, BuildPromptsResponse } from './model';
export interface BuildPromptRepository {
  current(): Promise<{ prompt: BuildPrompt | null; serverTime: string }>;
  load(slug?: string, offset?: number): Promise<BuildPromptsResponse>;
  enter(slug: string, targetKey: string, version: number): Promise<{ entry: BuildPromptEntry }>;
  withdraw(slug: string): Promise<void>;
}
export function createBuildPromptRepository(): BuildPromptRepository {
  return {
    current: () => apiRequest('/api/build-prompts/current', { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    load: (slug, offset = 0) => apiRequest(`/api/build-prompts?${new URLSearchParams({ ...(slug ? { slug } : {}), offset: String(offset) })}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    enter: (slug, targetKey, version) => apiRequest(`/api/build-prompts/${encodeURIComponent(slug)}/entry`, { method: 'POST', signal: AbortSignal.timeout(15000), body: JSON.stringify({ targetKey, version }) }),
    withdraw: async slug => { await apiRequest(`/api/build-prompts/${encodeURIComponent(slug)}/entry`, { method: 'DELETE', signal: AbortSignal.timeout(15000) }); },
  };
}
