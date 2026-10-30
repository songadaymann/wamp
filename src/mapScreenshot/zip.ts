/** ZIP32/store with data descriptors: only metadata and one input chunk stay in memory. */
export interface ZipStreamEntry {
  name: string;
  size: number;
  open(): Promise<ReadableStream<Uint8Array>>;
}
export const MAX_ARCHIVE_FILES = 10_000;
const MAX_ZIP32 = 0xffff_ffff;
const encoder = new TextEncoder();
const FLAGS = 0x0808;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
export class ArchiveLimitError extends Error {}

export function streamZipArchive(files: ZipStreamEntry[]): ReadableStream<Uint8Array> {
  if (files.length > MAX_ARCHIVE_FILES) throw new ArchiveLimitError('Archive has too many files. Choose a month.');
  const entries = files.map(file => ({ ...file, encoded: encoder.encode(file.name) }));
  let total = 22;
  for (const file of entries) {
    if (!file.name || /[/\\]/.test(file.name) || file.name === '..' || file.encoded.length > 65535) throw new Error('Invalid ZIP filename.');
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_ZIP32) throw new ArchiveLimitError('Archive file is too large. Choose a month.');
    total += file.size + 30 + 16 + 46 + file.encoded.length * 2;
  }
  if (total > MAX_ZIP32) throw new ArchiveLimitError('Archive exceeds ZIP32 limits. Choose a month.');
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let cancelled = false;
  const abortController = new AbortController();
  async function* generate(): AsyncGenerator<Uint8Array> {
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const file of entries) {
      if (cancelled) return;
      const opening = file.open().then(async input => {
        if (cancelled) { await input.cancel(); throw new Error('Archive download cancelled.'); }
        return input;
      });
      let onAbort: () => void = () => undefined;
      const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(new Error('Archive download cancelled.')); });
      abortController.signal.addEventListener('abort', onAbort, { once: true });
      let input: ReadableStream<Uint8Array>;
      try { input = await Promise.race([opening, aborted]); }
      finally { abortController.signal.removeEventListener('abort', onAbort); }
      const reader = input.getReader(); currentReader = reader;
      try {
        if (cancelled) return;
        const local = header(30 + file.encoded.length, 0x04034b50);
        const view = new DataView(local.buffer);
        view.setUint16(4, 20, true); view.setUint16(6, FLAGS, true); view.setUint16(12, 33, true);
        view.setUint16(26, file.encoded.length, true); local.set(file.encoded, 30);
        yield local;
        let size = 0, crc = 0xffff_ffff;
        while (!cancelled) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength;
          if (size > file.size) throw new Error('Screenshot grew during archive download.');
          for (const byte of next.value) crc = crcTable[(crc ^ byte) & 255]! ^ crc >>> 8;
          yield next.value;
        }
        if (cancelled) return;
        if (size !== file.size) throw new Error('Screenshot was truncated during archive download.');
        crc = (crc ^ 0xffff_ffff) >>> 0;
        const descriptor = header(16, 0x08074b50), desc = new DataView(descriptor.buffer);
        desc.setUint32(4, crc, true); desc.setUint32(8, size, true); desc.setUint32(12, size, true);
        yield descriptor;
        const index = header(46 + file.encoded.length, 0x02014b50), iv = new DataView(index.buffer);
        iv.setUint16(4, 20, true); iv.setUint16(6, 20, true); iv.setUint16(8, FLAGS, true); iv.setUint16(14, 33, true);
        iv.setUint32(16, crc, true); iv.setUint32(20, size, true); iv.setUint32(24, size, true);
        iv.setUint16(28, file.encoded.length, true); iv.setUint32(42, offset, true); index.set(file.encoded, 46);
        central.push(index); offset += local.length + size + descriptor.length;
      } finally {
        await reader.cancel().catch(() => undefined); reader.releaseLock(); currentReader = null;
      }
    }
    const centralOffset = offset;
    for (const part of central) { yield part; offset += part.length; }
    const end = header(22, 0x06054b50), ev = new DataView(end.buffer);
    ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, offset - centralOffset, true); ev.setUint32(16, centralOffset, true);
    yield end;
  }
  const iterator = generate();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); }
      catch (error) { controller.error(error); }
    },
    async cancel(reason) { cancelled = true; abortController.abort(); await currentReader?.cancel(reason); await iterator.return(undefined); },
  }, { highWaterMark: 0 });
}
function header(size: number, signature: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size); new DataView(bytes.buffer).setUint32(0, signature, true); return bytes;
}
