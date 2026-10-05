import { getAuthDebugState } from '../auth/client';
import { getActiveWorldId } from '../worlds/clientContext';
import type { BuildPrompt } from './model';
import { createBuildPromptRepository, type BuildPromptRepository } from './repository';
export const BUILD_PROMPT_PUBLISH_REQUEST = 'build-prompt-publish-request';
export const BUILD_PROMPT_ENTRY_RESULT = 'build-prompt-entry-result';
export interface PromptPublishChoice { slug: string | null }
export interface PromptPublishRequest {
  userId: string; targetKey: string; prompt: BuildPrompt | null; loadError: boolean;
  resolve: (choice: PromptPublishChoice | null) => void;
}
export interface PromptEntryResult {
  userId: string; slug: string; title: string; error: string | null;
  retry: () => Promise<void>;
}
export async function prepareBuildPromptEntry(userId: string | null, targetKey: string,
  repository: BuildPromptRepository = createBuildPromptRepository(), win: Window = window): Promise<PromptPublishChoice | null> {
  if (!userId || getAuthDebugState().schoolManaged || getActiveWorldId() || targetKey.includes('world-seed:')) return { slug: null };
  let prompt: BuildPrompt | null = null, loadError = false;
  try { prompt = (await repository.current()).prompt; } catch { loadError = true; }
  if (getAuthDebugState().user?.id !== userId) return null;
  if (!prompt && !loadError) return { slug: null };
  return new Promise(resolve => {
    const request = new CustomEvent<PromptPublishRequest>(BUILD_PROMPT_PUBLISH_REQUEST, {
      cancelable: true, detail: { userId, targetKey, prompt, loadError, resolve },
    });
    if (win.dispatchEvent(request)) resolve({ slug: null });
  });
}
export async function completeBuildPromptEntry(choice: PromptPublishChoice, userId: string, targetKey: string,
  version: number, title: string, repository: BuildPromptRepository = createBuildPromptRepository(), win: Window = window): Promise<void> {
  const slug = choice.slug;
  if (!slug || getAuthDebugState().user?.id !== userId) return;
  const retry = async () => {
    if (getAuthDebugState().user?.id !== userId) return;
    let error: string | null = null;
    try { await repository.enter(slug, targetKey, version); }
    catch (failure) { error = failure instanceof Error ? failure.message : 'The entry could not be saved.'; }
    if (getAuthDebugState().user?.id === userId) win.dispatchEvent(new CustomEvent<PromptEntryResult>(BUILD_PROMPT_ENTRY_RESULT, {
      detail: { userId, slug, title, error, retry },
    }));
  };
  await retry();
}
