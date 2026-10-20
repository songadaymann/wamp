import { listScreenshots, type ScreenshotR2Bucket } from './storage';
import { SCREENSHOT_KEY_PREFIX } from './config';
import { MAX_ARCHIVE_FILES, streamZipArchive } from './zip';

export async function screenshotArchive(bucket: ScreenshotR2Bucket, month: string | null): Promise<ReadableStream<Uint8Array>> {
  const files = await listScreenshots(bucket, month ? `${SCREENSHOT_KEY_PREFIX}${month}_` : SCREENSHOT_KEY_PREFIX, MAX_ARCHIVE_FILES);
  return streamZipArchive(files.map(file => ({
    name: file.fileName, size: file.size,
    async open() {
      const object = await bucket.get(file.key);
      if (!object) throw new Error('Screenshot disappeared during archive download.');
      if (object.size !== file.size || (file.etag && object.etag !== file.etag)) {
        await object.body.cancel(); throw new Error('Screenshot changed during archive download.');
      }
      return object.body;
    },
  })));
}
