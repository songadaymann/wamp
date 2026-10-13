import { describeRoomVideo, youtubeWatchUrl, type RoomVideo } from './model';

interface VideoState {
  video: RoomVideo | null;
  error: string | null;
}

const states = new WeakMap<object, VideoState>();
let activeRuntime: object | null = null;

export function ensureRoomVideoState(runtime: object): VideoState {
  let state = states.get(runtime);
  if (!state) {
    state = { video: null, error: null };
    states.set(runtime, state);
  }
  return state;
}

export function clearRoomVideoState(runtime: object): void {
  states.delete(runtime);
}

export function getRoomVideo(runtime: object | null | undefined): RoomVideo | null {
  if (!runtime) return null;
  return states.get(runtime)?.video ?? null;
}

export function setActiveRoomVideoRuntime(runtime: object | null): void {
  activeRuntime = runtime;
}

export function getActiveRoomVideoRuntime(): object | null {
  return activeRuntime;
}

export function roomVideoUiFields(runtime: object | null | undefined): {
  roomVideoUrl: string;
  roomVideoStatus: string;
  roomVideoLoop: boolean;
  roomVideoAutoplay: boolean;
  roomVideoTrigger: boolean;
  roomVideoVolume: number;
  roomVideoMuteMusic: boolean;
  roomVideoSnap: boolean;
  roomVideoHasVideo: boolean;
} {
  const state = runtime ? states.get(runtime) : undefined;
  const video = state?.video ?? null;
  return {
    roomVideoUrl: video ? youtubeWatchUrl(video.youtubeId) : '',
    roomVideoStatus: describeRoomVideo(video, state?.error ?? null),
    roomVideoLoop: video?.loop === true,
    roomVideoAutoplay: video?.autoplay === true,
    roomVideoTrigger: video?.trigger === true,
    roomVideoVolume: Math.round((video?.volume ?? 0.8) * 100),
    roomVideoMuteMusic: video?.muteMusic === true,
    roomVideoSnap: video?.snap === true,
    roomVideoHasVideo: video != null,
  };
}
