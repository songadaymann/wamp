import type { PostRunRatingRequestDetail } from '../../progression/postRunRatingEvents';

export type PostRunPromptMode = 'rating' | 'guest-claim';
export type PostRunPromptStatus = 'active' | 'waiting' | 'rated' | 'skipped';

export interface QueuedPostRunPrompt {
  mode: PostRunPromptMode;
  detail: PostRunRatingRequestDetail;
}

export interface PostRunPromptQueueEntry extends QueuedPostRunPrompt {
  key: string;
  status: PostRunPromptStatus;
}

export interface PostRunPromptQueueSnapshot {
  entries: PostRunPromptQueueEntry[];
  currentIndex: number;
  total: number;
}

export class PostRunRatingQueue {
  private readonly waiting: QueuedPostRunPrompt[] = [];
  private batch: PostRunPromptQueueEntry[] | null = null;
  private currentIndex = -1;

  enqueue(prompt: QueuedPostRunPrompt): boolean {
    const key = getPostRunPromptKey(prompt.detail);
    if (this.hasKey(key)) {
      return false;
    }

    if (this.batch && this.currentIndex >= 0) {
      this.batch.push({ ...prompt, key, status: 'waiting' });
    } else {
      this.waiting.push(prompt);
    }
    return true;
  }

  beginBatch(): PostRunPromptQueueEntry | null {
    if (this.batch && this.currentIndex >= 0) {
      return this.batch[this.currentIndex] ?? null;
    }
    if (this.waiting.length === 0) {
      return null;
    }

    this.batch = this.waiting.splice(0).map((prompt) => ({
      ...prompt,
      key: getPostRunPromptKey(prompt.detail),
      status: 'waiting' as const,
    }));
    this.currentIndex = 0;
    this.batch[0].status = 'active';
    return this.batch[0];
  }

  getCurrent(): PostRunPromptQueueEntry | null {
    if (!this.batch || this.currentIndex < 0) {
      return null;
    }
    return this.batch[this.currentIndex] ?? null;
  }

  markCurrentRated(): void {
    const current = this.getCurrent();
    if (current) {
      current.status = 'rated';
    }
  }

  advanceCurrent(disposition: 'rated' | 'skipped'): PostRunPromptQueueEntry | null {
    const current = this.getCurrent();
    if (!current || !this.batch) {
      return null;
    }

    if (current.status !== 'rated') {
      current.status = disposition;
    }
    this.currentIndex += 1;
    if (this.currentIndex >= this.batch.length) {
      this.currentIndex = -1;
      return null;
    }

    this.batch[this.currentIndex].status = 'active';
    return this.batch[this.currentIndex];
  }

  getSnapshot(): PostRunPromptQueueSnapshot {
    return {
      entries: this.batch?.map((entry) => ({ ...entry })) ?? [],
      currentIndex: this.currentIndex,
      total: this.batch?.length ?? 0,
    };
  }

  finishBatch(): void {
    this.batch = null;
    this.currentIndex = -1;
  }

  dismissAll(): void {
    this.waiting.length = 0;
    this.finishBatch();
  }

  private hasKey(key: string): boolean {
    return (
      this.waiting.some((prompt) => getPostRunPromptKey(prompt.detail) === key)
      || Boolean(this.batch?.some((entry) => entry.key === key))
    );
  }
}

export function getPostRunPromptKey(detail: PostRunRatingRequestDetail): string {
  return `${detail.contentType}:${detail.contentId}:${detail.version}`;
}
