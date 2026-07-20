import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface QueueConsumerConfig {
  queue: string;
  max_batch_size: number;
  max_batch_timeout: number;
  max_retries: number;
  max_concurrency: number;
  dead_letter_queue: string;
}

interface RendererWranglerConfig {
  r2_buckets: Array<{ bucket_name: string }>;
  queues: { consumers: QueueConsumerConfig[] };
  env: {
    safety: {
      r2_buckets: Array<{ bucket_name: string }>;
      queues: { consumers: QueueConsumerConfig[] };
    };
  };
}

function readRendererConfig(): RendererWranglerConfig {
  return JSON.parse(
    readFileSync(new URL('../../../wrangler.world-tile-renderer.jsonc', import.meta.url), 'utf8'),
  ) as RendererWranglerConfig;
}

describe('world tile renderer deployment configuration', () => {
  it('uses bounded consumers with retries and required environment-specific DLQs', () => {
    const config = readRendererConfig();
    const production = config.queues.consumers[0];
    const safety = config.env.safety.queues.consumers[0];

    for (const consumer of [production, safety]) {
      expect(consumer).toMatchObject({
        max_batch_size: 4,
        max_batch_timeout: 1,
        max_retries: 5,
        max_concurrency: 2,
      });
      expect(consumer.dead_letter_queue).toBe(`${consumer.queue}-dlq`);
    }
    expect(safety.queue).not.toBe(production.queue);
    expect(safety.dead_letter_queue).not.toBe(production.dead_letter_queue);
  });

  it('keeps production and safety R2 buckets isolated', () => {
    const config = readRendererConfig();
    expect(config.r2_buckets[0]?.bucket_name).toBe('everybodys-platformer-world-tiles');
    expect(config.env.safety.r2_buckets[0]?.bucket_name).toBe(
      'everybodys-platformer-safety-world-tiles',
    );
    expect(config.env.safety.r2_buckets[0]?.bucket_name).not.toBe(
      config.r2_buckets[0]?.bucket_name,
    );
  });
});
