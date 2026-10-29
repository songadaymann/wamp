import type { KeepPlayingClear } from '../progression/keepPlayingEvents';
import type { GuestRunProgressRecord } from '../progression/guestRunProgress';
import type { RunRepository } from './runRepository';
import type { RoomDiscoveryEntry } from './model';

/** Requested only on tap; personal discovery is a private, comparatively expensive read. */
export async function findKeepPlayingDestination(options: {
  clear: KeepPlayingClear; signedIn: boolean; local: GuestRunProgressRecord[];
  sessionClears: Set<string>; load: RunRepository['loadRoomDiscovery'];
  current: () => boolean;
}): Promise<RoomDiscoveryEntry | null> {
  const beaten=new Set([options.clear.contentId,...options.sessionClears]);
  if(!options.signedIn)for(const record of options.local) {
    beaten.add(record.contentId);if(record.expandedRoomId)beaten.add(record.expandedRoomId);
  }
  const eligible=(entry:RoomDiscoveryEntry)=> !entry.cooperative && entry.goalType !== null
    && !beaten.has(entry.roomId) && !beaten.has(entry.expandedRoom?.expandedRoomId ?? '')
    && !beaten.has(entry.expandedRoom?.legacyCourseId ?? '');
  const difficulties=options.clear.difficulty ? [options.clear.difficulty,null] : [null];
  for(const difficulty of difficulties) {
    let cursor:string|null=null;
    for(let page=0;page<4;page+=1) {
      if(!options.current())return null;
      const response=await options.load(difficulty,options.signedIn?'unbeaten':'popular',48,false,cursor);
      if(!options.current())return null;
      const found=response.results.find(eligible);if(found)return found;
      if(!response.nextCursor || response.nextCursor===cursor)break;
      cursor=response.nextCursor;
    }
  }
  return null;
}
