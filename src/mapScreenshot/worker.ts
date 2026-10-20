import { WorkerEntrypoint } from 'cloudflare:workers';
import type { MapScreenshotEnv } from './capture';
import { captureMapScreenshot } from './captureService';
export { default } from './http';

/** Available only to configured service bindings, never public HTTP. */
export class MapScreenshotAdmin extends WorkerEntrypoint<MapScreenshotEnv> {
  captureManual() { return captureMapScreenshot(this.env, 'manual'); }
}
