import Phaser from 'phaser';
import {
  type CourseMarkerPoint,
  type CourseRecord,
  type CourseSnapshot,
} from '../../courses/model';
import {
  createGoalMarkerFlagSprite,
  type GoalMarkerFlagVariant,
} from '../../goals/markerFlags';
import { type GoalMarkerPoint } from '../../goals/roomGoals';
import { type RoomCoordinates } from '../../persistence/roomModel';
import { type ActiveCourseRunState } from './courseRuns';
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
  getCourseComposerRecord(): CourseRecord | null;
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
    activeCourseRun: ActiveCourseRunState | null,
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

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return [...this.goalMarkerSprites, ...this.goalMarkerLabels];
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
      this.host.getCourseComposerRecord()?.draft.roomRefs.find((candidate) => candidate.roomId === point.roomId) ??
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

    switch (runState.goal.type) {
      case 'reach_exit':
        return runState.goal.exit
          ? [
              ...markers,
              {
                point: this.toWorldGoalPoint(runState.roomCoordinates, runState.goal.exit),
                label: null,
                variant: (runState.result === 'completed' ? 'finish-cleared' : 'finish-pending') as GoalMarkerFlagVariant,
                textColor: runState.result === 'completed' ? '#f6e6a6' : '#ffefef',
              },
            ]
          : markers;
      case 'checkpoint_sprint':
        return [
          ...markers,
          ...runState.goal.checkpoints.map((checkpoint, index) => {
            const reached = index < runState.nextCheckpointIndex;
            return {
              point: this.toWorldGoalPoint(runState.roomCoordinates, checkpoint),
              label: `${index + 1}`,
              variant: (reached ? 'checkpoint-reached' : 'checkpoint-pending') as GoalMarkerFlagVariant,
              textColor: reached ? '#a9ffd0' : '#ffefef',
            };
          }),
          ...(runState.goal.finish
            ? [{
                point: this.toWorldGoalPoint(runState.roomCoordinates, runState.goal.finish),
                label: null,
                variant: (runState.result === 'completed' ? 'finish-cleared' : 'finish-pending') as GoalMarkerFlagVariant,
                textColor: runState.result === 'completed' ? '#f6e6a6' : '#ffefef',
              }]
            : []),
        ];
      default:
        return markers;
    }
  }

  private getCourseMarkerDescriptors(runState: ActiveCourseRunState): PlayGoalMarkerDescriptor[] {
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

    if (goal.type === 'reach_exit' && goal.exit) {
      markers.push({
        point: this.toWorldCoursePoint(goal.exit),
        label: null,
        variant: (runState.result === 'completed' ? 'finish-cleared' : 'finish-pending') as GoalMarkerFlagVariant,
        textColor: runState.result === 'completed' ? '#f6e6a6' : '#ffefef',
      });
    }

    if (goal.type === 'checkpoint_sprint') {
      for (let index = 0; index < goal.checkpoints.length; index += 1) {
        const checkpoint = goal.checkpoints[index];
        const reached = index < runState.nextCheckpointIndex;
        markers.push({
          point: this.toWorldCoursePoint(checkpoint),
          label: `${index + 1}`,
          variant: (reached ? 'checkpoint-reached' : 'checkpoint-pending') as GoalMarkerFlagVariant,
          textColor: reached ? '#a9ffd0' : '#ffefef',
        });
      }

      if (goal.finish) {
        markers.push({
          point: this.toWorldCoursePoint(goal.finish),
          label: null,
          variant: (runState.result === 'completed' ? 'finish-cleared' : 'finish-pending') as GoalMarkerFlagVariant,
          textColor: runState.result === 'completed' ? '#f6e6a6' : '#ffefef',
        });
      }
    }

    return markers;
  }
}
