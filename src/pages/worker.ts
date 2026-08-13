import type { PagesWorkerHandler } from './model';
import { createPagesWorker } from './routes';

export type {
  PagesWorkerEnv,
  PagesWorkerExecutionContext,
  PagesWorkerHandler,
} from './model';

const worker = createPagesWorker();

export default worker satisfies PagesWorkerHandler;
