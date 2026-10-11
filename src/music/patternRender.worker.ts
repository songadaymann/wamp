import { renderPatternRequest, type PatternDrumSamples, type PatternRenderRequest } from './patternRenderCore';

/** Messages from patternRenderClient: drum samples once per set, then render requests. */
export type PatternRenderWorkerMessage =
  | { type: 'drums'; drumsId: number; samples: [string, Float32Array][] }
  | { type: 'render'; id: number; drumsId: number | null; request: PatternRenderRequest };

export type PatternRenderWorkerReply =
  | { id: number; channels: Float32Array[] }
  | { id: number; error: string };

type WorkerScope = {
  addEventListener(type: 'message', listener: (event: MessageEvent<PatternRenderWorkerMessage>) => void): void;
  postMessage(message: PatternRenderWorkerReply, transfer: Transferable[]): void;
};

const NO_DRUM_SAMPLES: PatternDrumSamples = new Map();
const drumSets = new Map<number, PatternDrumSamples>();
const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'drums') {
    drumSets.set(message.drumsId, new Map(message.samples));
    return;
  }
  try {
    const drums = message.drumsId === null ? NO_DRUM_SAMPLES : drumSets.get(message.drumsId) ?? NO_DRUM_SAMPLES;
    const channels = renderPatternRequest(message.request, drums);
    scope.postMessage({ id: message.id, channels }, channels.map((channel) => channel.buffer));
  } catch (error) {
    scope.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }, []);
  }
});
