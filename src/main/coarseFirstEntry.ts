import {
  COARSE_FIRST_MAIN_TIMEOUT_MS,
  startMainAfterEarlyWorldTiles,
} from './coarseFirstStartup';
import { getGameSettings } from '../settings/userSettings';
import { applyTextPreferences } from '../settings/textPreferences';

applyTextPreferences(getGameSettings(), document);

void startMainAfterEarlyWorldTiles({
  handle: window.__wampEarlyWorldTiles,
  timeoutMs: COARSE_FIRST_MAIN_TIMEOUT_MS,
  importMain: () => import('../main'),
});
