import {
  COARSE_FIRST_MAIN_TIMEOUT_MS,
  startMainAfterEarlyWorldTiles,
} from './coarseFirstStartup';

void startMainAfterEarlyWorldTiles({
  handle: window.__wampEarlyWorldTiles,
  timeoutMs: COARSE_FIRST_MAIN_TIMEOUT_MS,
  importMain: () => import('../main'),
});
