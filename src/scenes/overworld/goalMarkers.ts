import { buildPlayGoalFlags } from '../../goals/goalSchema';
import Phaser from 'phaser';
import {
  COURSE_GOAL_DEFINITIONS,
  type CourseMarkerPoint,
  type CourseSnapshot,
} from '../../courses/model';
import {
  createGoalMarkerFlagSprite,
  type GoalMarkerFlagVariant,
} from '../../goals/markerFlags';
import { ROOM_GOAL_DEFINITIONS, type GoalMarkerPoint } from '../../goals/roomGoals';
import { type RoomCoordinates } from '../../persistence/roomModel';
import { type ActiveExpandedRoomRunState } from './expandedRoomRuns';
import { type GoalRunState } from './goalRuns';

const GOAL_MARKER_SPRITE_DEPTH = 29;
const GOAL_MARKER_LABEL_DEPTH = 30;

interface PlayGoalMarkerDescriptor {
  point: GoalMarkerPoint;
  label: string | null;
  textColor: string;
  variant?: GoalMarkerFlagVariant;
  textureKey?: string;
  spriteOffsetY?: number;
  alpha?: number;
}

interface OverworldGoalMarkerControllerHost {
  scene: Phaser.Scene;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  getSelectedCoordinates(): RoomCoordinates;
  getActiveCourseSnapshot(): CourseSnapshot | null;
}

export class OverworldGoalMarkerController {
  private goalMarkerSprites: Phaser.GameObjects.Sprite[] = [];
  private goalMarkerLabels: Phaser.GameObjects.Text[] = [];

  constructor(private readonly host: OverworldGoalMarkerControllerHost) {}

  destroy(): void {
    for (const sprite of this.goalMarkerSprites) {
      sprite.destroy();
    }
    this.goalMarkerSprites = [];
    for (const label of this.goalMarkerLabels) {
      label.destroy();
    }
    this.goalMarkerLabels = [];
  }

  redrawMarkers(
    currentGoalRun: GoalRunState | null,
    activeCourseRun: ActiveExpandedRoomRunState | null,
  ): void {
    this.destroy();

    if (!currentGoalRun && !activeCourseRun) {
      return;
    }

    const markers = activeCourseRun
      ? this.getCourseMarkerDescriptors(activeCourseRun)
      : this.getGoalMarkerDescriptors(currentGoalRun!);
    for (const marker of markers) {
      const sprite = marker.variant
        ? createGoalMarkerFlagSprite(
            this.host.scene,
            marker.variant,
            marker.point.x,
            marker.point.y + (marker.spriteOffsetY ?? 2),
            GOAL_MARKER_SPRITE_DEPTH,
          )
        : this.host.scene.add.sprite(
            marker.point.x,
            marker.point.y + (marker.spriteOffsetY ?? 0),
            marker.textureKey ?? 'spawn_point',
            0,
          );
      sprite.setOrigin(0.5, 1);
      sprite.setDepth(GOAL_MARKER_SPRITE_DEPTH);
      if (marker.alpha !== undefined) {
        sprite.setAlpha(marker.alpha);
      }
      this.goalMarkerSprites.push(sprite);

      if (marker.label) {
        const label = this.host.scene.add.text(marker.point.x, marker.point.y - 28, marker.label, {
          fontFamily: 'Courier New',
          fontSize: '12px',
          color: marker.textColor,
          stroke: '#050505',
          strokeThickness: 4,
        });
        label.setOrigin(0.5, 1);
        label.setDepth(GOAL_MARKER_LABEL_DEPTH);
        this.goalMarkerLabels.push(label);
      }
    }
  }

  toWorldGoalPoint(
    roomCoordinates: RoomCoordinates,
    point: GoalMarkerPoint,
  ): GoalMarkerPoint {
    const origin = this.host.getRoomOrigin(roomCoordinates);
    return {
      x: origin.x + point.x,
      y: origin.y + point.y,
    };
  }

  toWorldCoursePoint(point: CourseMarkerPoint): GoalMarkerPoint {
    const roomRef =
      this.host.getActiveCourseSnapshot()?.roomRefs.find((candidate) => candidate.roomId === point.roomId) ??
      null;

    const origin = this.host.getRoomOrigin(roomRef?.coordinates ?? this.host.getSelectedCoordinates());
    return {
      x: origin.x + point.x,
      y: origin.y + point.y,
    };
  }

  private getGoalMarkerDescriptors(runState: GoalRunState): PlayGoalMarkerDescriptor[] {
    const markers: PlayGoalMarkerDescriptor[] = [];

    if (runState.qualificationState === 'practice') {
      markers.push({
        point: runState.rankedStartPoint,
        label: 'START',
        textColor: '#9fdcff',
        textureKey: 'spawn_point',
        spriteOffsetY: 0,
        alpha: 0.94,
      });
    }

    return [
      ...markers,
      ...buildPlayGoalFlags(runState.goal, ROOM_GOAL_DEFINITIONS, runState).map(marker => ({
        ...marker, point: this.toWorldGoalPoint(runState.roomCoordinates, marker.point),
      })),
    ];
  }

  private getCourseMarkerDescriptors(runState: ActiveExpandedRoomRunState): PlayGoalMarkerDescriptor[] {
    const goal = runState.course.goal;
    if (!goal) {
      return [];
    }

    const markers: PlayGoalMarkerDescriptor[] = [];

    if (runState.course.startPoint) {
      markers.push({
        point: this.toWorldCoursePoint(runState.course.startPoint),
        label: 'S',
        variant: 'checkpoint-pending',
        textColor: '#9fdcff',
      });
    }

    return [
      ...markers,
      ...buildPlayGoalFlags(goal, COURSE_GOAL_DEFINITIONS, runState).map(marker => ({
        ...marker, point: this.toWorldCoursePoint(marker.point),
      })),
    ];
  }
}
