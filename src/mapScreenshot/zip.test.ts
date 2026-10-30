import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamZipArchive } from './zip';

function entry(name: string, bytes: Uint8Array) {
  return { name, size: bytes.length, open: async () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }) };
}
describe('streaming map archives', () => {
  it('round trips binary, empty files and empty archives through the system ZIP reader', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wamp-zip-'));
    try {
      const file = join(dir, 'maps.zip');
      const bytes = new Uint8Array([0, 1, 2, 128, 255]);
      writeFileSync(file, Buffer.from(await new Response(streamZipArchive([entry('first.png', bytes), entry('empty.png', new Uint8Array())])).arrayBuffer()));
      execFileSync('unzip', ['-t', file]);
      expect(execFileSync('unzip', ['-p', file, 'first.png'])).toEqual(Buffer.from(bytes));
      expect(execFileSync('unzip', ['-p', file, 'empty.png'])).toHaveLength(0);
      const empty = Buffer.from(await new Response(streamZipArchive([])).arrayBuffer());
      writeFileSync(join(dir, 'empty.zip'), empty);
      execFileSync('python3', ['-c', 'import sys,zipfile; assert zipfile.ZipFile(sys.argv[1]).namelist() == []', join(dir, 'empty.zip')]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('streams more than the Worker memory limit with one reader and bounded chunks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wamp-zip-large-')), file = join(dir, 'maps.zip');
    let opened = 0, active = 0, maxActive = 0, generated = 0;
    const size = 80 * 1024 * 1024;
    const files = ['a.png', 'b.png'].map(name => ({ name, size, async open() {
      opened++; active++; maxActive = Math.max(active, maxActive); let remaining = size;
      return new ReadableStream<Uint8Array>({ pull(c) {
        if (!remaining) { active--; c.close(); return; }
        const bytes = new Uint8Array(Math.min(65536, remaining)); bytes.fill(37); remaining -= bytes.length; generated += bytes.length; c.enqueue(bytes);
      } }, { highWaterMark: 0 });
    } }));
    const archive = streamZipArchive(files); expect(opened).toBe(0); expect(generated).toBe(0);
    const reader = archive.getReader(), fd = openSync(file, 'w');
    try {
      const first = await reader.read(); expect(first.value!.length).toBeLessThan(100); expect(opened).toBe(1); expect(generated).toBe(0);
      writeSync(fd, first.value!);
      while (true) { const part = await reader.read(); if (part.done) break; expect(part.value.length).toBeLessThanOrEqual(65536); writeSync(fd, part.value); }
      closeSync(fd); expect(generated).toBe(size * 2); expect(maxActive).toBe(1); expect(active).toBe(0);
      execFileSync('unzip', ['-t', file], { timeout: 20000 });
    } finally { reader.releaseLock(); rmSync(dir, { recursive: true, force: true }); }
  }, 30000);
  it('cancels an outstanding read without opening later files', async () => {
    let cancelled = 0, later = 0;
    const reader = streamZipArchive([{ name: 'first.png', size: 1, async open() {
      return new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }, { highWaterMark: 0 });
    } }, { name: 'later.png', size: 0, async open() { later++; return new ReadableStream(); } }]).getReader();
    await reader.read(); const pending = reader.read(); await Promise.resolve(); await reader.cancel(); await pending;
    expect(cancelled).toBe(1); expect(later).toBe(0);
  });
  it.each([0, 2])('rejects changed lengths instead of finishing a corrupt ZIP (%i)', async size => {
    await expect(new Response(streamZipArchive([{ ...entry('a.png', new Uint8Array([1])), size }])).arrayBuffer()).rejects.toThrow(/Screenshot/);
  });
  it('does not block cancellation on a pending object open, then cleans the late stream', async () => {
    let resolve!: (stream: ReadableStream<Uint8Array>) => void; let cancelled = 0;
    const reader = streamZipArchive([{ name: 'pending.png', size: 0, open: () => new Promise(r => { resolve = r; }) }]).getReader();
    const pending = reader.read(); await Promise.resolve(); await reader.cancel(); await pending;
    resolve(new ReadableStream({ cancel() { cancelled++; } }, { highWaterMark: 0 }));
    for (let n = 0; n < 6; n++) await Promise.resolve(); expect(cancelled).toBe(1);
  });
  it('propagates storage errors and rejects oversized selections before opening files', async () => {
    const failing = { name: 'a.png', size: 1, open: async (): Promise<ReadableStream<Uint8Array>> => { throw new Error('Storage unavailable'); } };
    await expect(new Response(streamZipArchive([failing])).arrayBuffer()).rejects.toThrow('Storage unavailable');
    expect(() => streamZipArchive([{ ...failing, size: 0xffff_ffff }])).toThrow(/Choose a month/);
    expect(() => streamZipArchive(Array.from({ length: 10001 }, () => failing))).toThrow(/Choose a month/);
    expect(() => streamZipArchive([{ ...failing, name: '../secret' }])).toThrow(/filename/);
  });
});
