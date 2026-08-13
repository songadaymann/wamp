/**
 * Phase 2: post the daily map screenshot to X/Twitter.
 *
 * This is intentionally a no-op until credentials are configured.
 *
 * Gather from the X Developer Portal (developer.x.com), then store as Worker secrets:
 * - TWITTER_API_KEY            (API Key / Consumer Key)
 * - TWITTER_API_KEY_SECRET     (API Key Secret / Consumer Secret)
 * - TWITTER_ACCESS_TOKEN       (Access Token for the posting account)
 * - TWITTER_ACCESS_TOKEN_SECRET
 *
 * Also needed outside secrets:
 * - Posting account handle (e.g. @wampland)
 * - Paid API tier that allows posting + media upload
 * - Caption template preference
 *
 * App permissions must be Read and Write. OAuth 1.0a user tokens are required
 * for classic media upload + tweet-as-user flows.
 */

export interface TwitterPostInput {
  pngBytes: ArrayBuffer;
  fileName: string;
  caption: string;
}

export interface TwitterEnv {
  TWITTER_API_KEY?: string;
  TWITTER_API_KEY_SECRET?: string;
  TWITTER_ACCESS_TOKEN?: string;
  TWITTER_ACCESS_TOKEN_SECRET?: string;
}

export async function maybePostToTwitter(
  _env: TwitterEnv,
  _input: TwitterPostInput,
): Promise<{ posted: boolean; reason: string }> {
  return {
    posted: false,
    reason: 'Twitter posting is not enabled yet (phase 2).',
  };
}

export function buildDailyCaption(easternDate: string, roomCount: number): string {
  const displayDate = easternDate.replace(/_/g, '-');
  return `WAMP map — ${displayDate} — ${roomCount} published rooms`;
}
