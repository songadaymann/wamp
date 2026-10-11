import { renderPatternRequest, type PatternDrumSamples, type PatternRenderRequest } from './patternRenderCore';
import type { PatternRenderWorkerMessage, PatternRenderWorkerReply } from './patternRender.worker';

/**
 * Room music is synthesized sample by sample, which took 10-20 ms per pattern on a
 * desktop and far longer on phones and for long arrangements. That ran on the main thread
 * as you entered the room (F223). It now runs in a module worker; where workers are
 * unavailable, or the worker fails, the same code runs here instead.
 */
type Pending = { resolve: (channels: Float32Array[]) => void; reject: (error: Error) => void };

let worker: Worker | null | undefined;
let nextRequestId = 1;
let nextDrumsId = 1;
const pending = new Map<number, Pending>();
const drumIds = new WeakMap<PatternDrumSamples, number>();

export async function renderPatternChannels(
  request: PatternRenderRequest,
  drumSamples: PatternDrumSamples,
): Promise<Float32Array[]> {
  const renderWorker = getWorker();
  if (renderWorker) {
    try {
      return await postRender(renderWorker, request, drumSamples);
    } catch {
      // The worker failed to load or render; this request renders here.
    }
  }
  return renderPatternRequest(request, drumSamples);
}

function getWorker(): Worker | null {
  if (worker !== undefined) {
    return worker;
  }
  if (typeof Worker === 'undefined') {
    worker = null;
    return worker;
  }
  try {
    const created = new Worker(new URL('./patternRender.worker.ts', import.meta.url), { type: 'module' });
    created.addEventListener('message', (event: MessageEvent<PatternRenderWorkerReply>) => settle(event.data));
    created.addEventListener('error', () => disableWorker(created, 'Music render worker failed.'));
    created.addEventListener('messageerror', () => disableWorker(created, 'Music render worker message failed.'));
    worker = created;
  } catch {
    worker = null;
  }
  return worker;
}

function postRender(
  renderWorker: Worker,
  request: PatternRenderRequest,
  drumSamples: PatternDrumSamples,
): Promise<Float32Array[]> {
  let drumsId: number | null = null;
  if (drumSamples.size > 0) {
    drumsId = drumIds.get(drumSamples) ?? null;
    if (drumsId === null) {
      drumsId = nextDrumsId++;
      drumIds.set(drumSamples, drumsId);
      // Copied, not transferred: the main thread keeps using these samples.
      post(renderWorker, { type: 'drums', drumsId, samples: [...drumSamples.entries()] });
    }
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    post(renderWorker, { type: 'render', id, drumsId, request });
  });
}

function post(renderWorker: Worker, message: PatternRenderWorkerMessage): void {
  renderWorker.postMessage(message);
}

function settle(reply: PatternRenderWorkerReply): void {
  const request = pending.get(reply.id);
  if (!request) {
    return;
  }
  pending.delete(reply.id);
  if ('error' in reply) {
    request.reject(new Error(reply.error));
  } else {
    request.resolve(reply.channels);
  }
}

/** A worker that cannot load or answer is dropped; waiting renders fall back to this thread. */
function disableWorker(failed: Worker, reason: string): void {
  if (worker === failed) {
    worker = null;
  }
  failed.terminate();
  for (const request of pending.values()) {
    request.reject(new Error(reason));
  }
  pending.clear();
}
