import { DREAM_SCRIPT } from './config';
import {
  CREATIVE_CHECKLIST_ITEMS,
  type CreativeChecklistItem,
  type CreativeChecklistItemState,
  type TutorialProgressV1,
} from './model';

export type TutorialCoachmarkActionId =
  | 'finish_dream'
  | 'edit_room'
  | 'take_room'
  | 'make_own_room'
  | 'restore_bridge'
  | 'continue_to_claim'
  | 'skip_checklist_item'
  | 'retry_claim'
  | 'skip_tutorial';

export interface TutorialCoachmarkAction {
  id: TutorialCoachmarkActionId;
  label: string;
  primary?: boolean;
  checklistItem?: CreativeChecklistItem;
}

export interface TutorialChecklistViewItem {
  id: CreativeChecklistItem;
  label: string;
  state: CreativeChecklistItemState;
}

export type TutorialAccountCreationState = 'idle' | 'sending' | 'sent' | 'error';

export interface TutorialAccountCreationViewModel {
  email: string;
  state: TutorialAccountCreationState;
  debugMagicLink?: string | null;
}

export interface TutorialCoachmarkOptions {
  accountCreation?: TutorialAccountCreationViewModel | null;
}

export interface TutorialCoachmarkViewModel {
  tone: 'dream' | 'guide' | 'success' | 'claim';
  title: string;
  body: string;
  dreamLines?: readonly string[];
  checklist?: TutorialChecklistViewItem[];
  accountCreation?: TutorialAccountCreationViewModel;
  actions: TutorialCoachmarkAction[];
  persistentSkip: boolean;
}

const CHECKLIST_LABELS: Record<CreativeChecklistItem, string> = {
  background: 'Choose a background',
  ground: 'Draw ground with Essentials',
  decoration: 'Add a decoration',
  collectible: 'Add a collectible',
  enemy: 'Add an enemy',
  spawn_and_goal: 'Place a spawn and reach-exit goal',
};

export function buildTutorialCoachmark(
  progress: TutorialProgressV1,
  options: TutorialCoachmarkOptions = {},
): TutorialCoachmarkViewModel | null {
  switch (progress.stage) {
    case 'dream':
      return {
        tone: 'dream',
        title: 'A room is dreaming',
        body: 'Listen closely.',
        dreamLines: DREAM_SCRIPT,
        actions: [{ id: 'finish_dream', label: 'Wake Up', primary: true }],
        persistentSkip: true,
      };
    case 'wake':
      return {
        tone: 'guide',
        title: 'Wake up',
        body: 'The room is waiting for you.',
        actions: [],
        persistentSkip: true,
      };
    case 'room_traversal':
      return {
        tone: 'guide',
        title: 'Move through the dream',
        body: 'Use the arrow keys or WASD. On a phone, use the movement stick and Jump.',
        actions: [],
        persistentSkip: true,
      };
    case 'bridge_prompt':
      return {
        tone: 'guide',
        title: 'The room needs an answer',
        body: 'Open a private copy. The real room will not be changed.',
        actions: [{ id: 'edit_room', label: 'Edit Room', primary: true }],
        persistentSkip: true,
      };
    case 'bridge_edit':
      return {
        tone: 'guide',
        title: 'Build a way across',
        body: 'Draw at least three Essentials tiles across the water, then choose Test Room.',
        actions: [],
        persistentSkip: true,
      };
    case 'bridge_playtest':
      return {
        tone: 'guide',
        title: 'Test your answer',
        body: 'Reach the existing exit. This real playtest is what proves the bridge works.',
        actions: [],
        persistentSkip: true,
      };
    case 'bridge_complete':
      return {
        tone: 'success',
        title: 'The room remembered your answer.',
        body: 'You can take this bridge room into the world, or begin again and make the room yours.',
        actions: [
          { id: 'take_room', label: 'Take This Room to the World', primary: true },
          { id: 'make_own_room', label: 'Make My Own Room' },
        ],
        persistentSkip: true,
      };
    case 'creative_edit':
      return {
        tone: 'guide',
        title: 'Make a room of your own',
        body: 'The checklist is optional. Skip any step or continue whenever your draft feels ready.',
        checklist: CREATIVE_CHECKLIST_ITEMS.map((id) => ({
          id,
          label: CHECKLIST_LABELS[id],
          state: progress.creativeChecklist[id],
        })),
        actions: [
          { id: 'continue_to_claim', label: 'Continue to the World', primary: true },
          { id: 'restore_bridge', label: 'Restore Bridge Room' },
        ],
        persistentSkip: true,
      };
    case 'awaiting_claim':
      if (options.accountCreation) {
        const sent = options.accountCreation.state === 'sent';
        return {
          tone: 'claim',
          title: sent ? 'Check your email' : 'Create your WAMP account',
          body: sent
            ? `We sent a one-time link to ${options.accountCreation.email}. Open it on this device. The link will bring you back, and your room will still be waiting.`
            : 'Enter your email and we’ll send you a one-time link. Open it on this device; the link will bring you back to place your room in the world.',
          accountCreation: options.accountCreation,
          actions: [],
          persistentSkip: true,
        };
      }
      return {
        tone: 'claim',
        title: 'Choose where this dream will wake',
        body: 'Select a frontier room, then choose Build Here. Your private draft stays safe until the claim succeeds.',
        actions: [],
        persistentSkip: true,
      };
    case 'completed':
      return {
        tone: 'success',
        title: 'Now it has a place in the world.',
        body: 'This is your normal room editor now. Publish only when you want to.',
        actions: [],
        persistentSkip: false,
      };
    case 'dismissed':
      return null;
  }
}
