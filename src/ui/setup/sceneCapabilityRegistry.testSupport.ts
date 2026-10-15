import { SCENE_CAPABILITY_METHODS, type SceneCapabilities } from './sceneCapabilityRegistry';

/** Keep focused fixtures complete; an unexpected call to an unrelated action fails explicitly. */
export function sceneCapabilityFixture<Key extends keyof SceneCapabilities>(key: Key, overrides: Partial<SceneCapabilities[Key]>): SceneCapabilities[Key] {
  const methods = Object.fromEntries(Object.keys(SCENE_CAPABILITY_METHODS[key]).map(method => [method, () => {
    throw new Error(`Unexpected ${key} fixture action: ${method}`);
  }]));
  return Object.assign(methods, overrides) as unknown as SceneCapabilities[Key];
}
