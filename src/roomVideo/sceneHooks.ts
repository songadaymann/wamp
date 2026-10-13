import Phaser from 'phaser';
import { bindRoomVideoControls, installRoomVideoEditing, setActiveRoomVideoRuntime } from './editing';
import {
  destroyRoomVideoFrame,
  roomVideoPointerDown,
  roomVideoPointerMove,
  roomVideoPointerUp,
  syncCourseRoomVideo,
  syncEditorRoomVideo,
} from './frames';

interface VideoSceneClass {
  prototype: {
    create(data?: unknown): void;
    update(time: number, delta?: number): void;
  };
}

interface CourseSceneClass extends VideoSceneClass {
  prototype: VideoSceneClass['prototype'] & {
    renderUi(): void;
    getSelectedSlice(): { runtime: object } | null;
  };
}

function wrapInput(scene: Phaser.Scene): void {
  const input = scene.input;
  const originalOn = input.on.bind(input);
  const wrapped = ((event: string | symbol, fn: (...args: unknown[]) => void, context?: unknown) => {
    if (event === 'pointerdown') {
      return originalOn(event, ((pointer: Phaser.Input.Pointer) => {
        if (pointer.leftButtonDown() && roomVideoPointerDown(scene, pointer)) return;
        fn.call(context, pointer);
      }) as never, context as never);
    }
    if (event === 'pointermove') {
      return originalOn(event, ((pointer: Phaser.Input.Pointer) => {
        if (roomVideoPointerMove(scene, pointer)) return;
        fn.call(context, pointer);
      }) as never, context as never);
    }
    if (event === 'pointerup' || event === 'pointerupoutside') {
      return originalOn(event, ((...args: unknown[]) => {
        if (roomVideoPointerUp(scene)) return;
        fn.apply(context, args);
      }) as never, context as never);
    }
    return originalOn(event as never, fn as never, context as never);
  }) as typeof input.on;
  input.on = wrapped;
}

function hookUpdate(sceneClass: VideoSceneClass, sync: (scene: Phaser.Scene) => void): void {
  const originalUpdate = sceneClass.prototype.update;
  sceneClass.prototype.update = function updateRoomVideo(time: number, delta?: number) {
    originalUpdate.call(this, time, delta);
    sync(this as unknown as Phaser.Scene);
  };
}

export function installRoomVideoEditorHooks(editorScene: unknown, courseScene: unknown): void {
  const editor = editorScene as VideoSceneClass;
  const course = courseScene as CourseSceneClass;
  installRoomVideoEditing();
  bindRoomVideoControls(document);
  hookUpdate(editor, syncEditorRoomVideo);
  hookUpdate(course, syncCourseRoomVideo);

  const originalCreate = course.prototype.create;
  course.prototype.create = function createCourseVideoInput(this: Phaser.Scene, data?: unknown) {
    wrapInput(this);
    return originalCreate.call(this, data);
  };
  const originalRender = course.prototype.renderUi;
  course.prototype.renderUi = function renderCourseVideo(this: CourseSceneClass['prototype']) {
    setActiveRoomVideoRuntime(this.getSelectedSlice()?.runtime ?? null);
    originalRender.call(this);
  };

  const forget = (scene: Phaser.Scene) => {
    destroyRoomVideoFrame(scene);
    setActiveRoomVideoRuntime(null);
  };
  const editorCreate = editor.prototype.create;
  editor.prototype.create = function createEditorVideoCleanup(this: Phaser.Scene, data?: unknown) {
    const result = editorCreate.call(this, data);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => forget(this));
    return result;
  };
  const courseCreate = course.prototype.create;
  course.prototype.create = function createCourseVideoCleanup(this: Phaser.Scene, data?: unknown) {
    const result = courseCreate.call(this, data);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => forget(this));
    return result;
  };
}
