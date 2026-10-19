import { OverworldFramePipeline } from '../framePipeline';

/** The stage plan captures live ports; construction does not read scene state. */
export function createFramePipeline(host: ConstructorParameters<typeof OverworldFramePipeline>[0]): OverworldFramePipeline {
  return new OverworldFramePipeline(host);
}
