import type { GuestRunSaveResult } from '../guestRooms/runService';

export function guestRunClaimCopy(progress: GuestRunSaveResult | null | undefined) {
  if (progress?.status === 'saved') return {
    heading: 'Clear ready to save',
    copy: 'Sign in within 14 days to save this verified clear. New clears can earn XP.',
    button: 'Save Progress', signInMessage: 'Sign in to save your verified clears and earn XP.',
    inPlay: 'Verified clear · Sign in to earn XP',
  };
  if (progress?.status === 'queued') return {
    heading: 'Clear waiting to save',
    copy: progress.durable
      ? 'Waiting for a connection to verify this clear. Keep your browser data while we retry.'
      : 'Keep this tab open while we retry saving your clear.',
    button: 'Sign In', signInMessage: 'Sign in to earn XP and save verified clears.',
    inPlay: progress.durable
      ? 'Waiting to verify · Sign in to earn XP once saved'
      : 'Keep this tab open · Waiting to verify for XP',
  };
  return {
    heading: 'Room cleared',
    copy: 'This clear could not be verified. Sign in and replay to earn XP.',
    button: 'Sign In', signInMessage: 'Sign in and replay to earn XP and save your clears.',
    inPlay: 'Clear unverified · Sign in and replay to earn XP',
  };
}
