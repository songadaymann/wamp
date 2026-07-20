import type { BrowserWorker } from '@cloudflare/puppeteer';

export interface D1RunMeta {
  changes?: number;
}

export interface D1RunResult<T = Record<string, unknown>> {
  meta?: D1RunMeta;
  results?: T[];
  success?: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run<T = Record<string, unknown>>(): Promise<D1RunResult<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<Array<D1RunResult<T>>>;
}

export interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
  etag: string;
  httpEtag?: string;
  key: string;
  uploaded?: Date;
}

export interface R2ObjectSummary {
  etag: string;
  key: string;
  size: number;
  uploaded: Date;
}

export interface R2PutResult {
  etag: string;
  httpEtag?: string;
  key: string;
}

export interface R2Bucket {
  delete(keys: string | string[]): Promise<void>;
  get(key: string): Promise<R2ObjectBody | null>;
  list(options?: { cursor?: string; limit?: number; prefix?: string }): Promise<{
    cursor?: string;
    delimitedPrefixes: string[];
    objects: R2ObjectSummary[];
    truncated: boolean;
  }>;
  put(
    key: string,
    body: ArrayBuffer | ArrayBufferView,
    options?: {
      httpMetadata?: { cacheControl?: string; contentType?: string };
      customMetadata?: Record<string, string>;
    }
  ): Promise<R2PutResult>;
}

export interface QueueProducer<T> {
  send(body: T, options?: { contentType?: 'json'; delaySeconds?: number }): Promise<void>;
}

export interface QueueMessage<T = unknown> {
  attempts: number;
  body: T;
  id: string;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface QueueMessageBatch<T = unknown> {
  messages: QueueMessage<T>[];
  queue: string;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledControllerLike {
  cron: string;
  scheduledTime: number;
}

export interface WorldTileRendererEnv {
  DB: D1Database;
  WORLD_TILE_BROWSER: BrowserWorker;
  WORLD_TILE_RENDER_QUEUE: QueueProducer<unknown>;
  WORLD_TILES: R2Bucket;
  ADMIN_API_KEY?: string;
  WORLD_TILE_ENVIRONMENT?: string;
  WORLD_TILE_GENERATION_ENABLED?: string;
  WORLD_TILE_LEASE_SECONDS?: string;
  WORLD_TILE_PUBLIC_BASE_URL?: string;
}
