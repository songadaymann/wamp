import type { PagesWorkerHandler } from './model';
import { createPagesWorker } from './routes';
import legacyWorker from './workerLegacy.js';

export type {
  PagesWorkerEnv,
  PagesWorkerExecutionContext,
  PagesWorkerHandler,
} from './model';

const worker = createPagesWorker(legacyWorker);

export default worker satisfies PagesWorkerHandler;
