import type { ChatModerationViewer } from '../chat/model';
import type { AuthSessionResponse, AuthUser } from './model';

export interface AuthDebugState {
  loading: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  source: AuthSessionResponse['source'] | null;
  roomDailyClaimLimit: number | null;
  roomClaimsUsedToday: number;
  roomClaimsRemainingToday: number | null;
  status: string;
  debugMagicLink: string | null;
  walletConnected: boolean;
  walletAddress: string | null;
  walletProjectConfigured: boolean;
  storageBackend: 'auto' | 'local' | 'remote';
  testResetEnabled: boolean;
  chatModeration: ChatModerationViewer;
}
