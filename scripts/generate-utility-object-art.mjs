import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..', 'public', 'assets', 'objects');

function crc32(buffer) {
  let crc = ~0;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function png(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPixel(pixels, width, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width) return;
  const offset = (y * width + x) * 4;
  pixels[offset] = r;
  pixels[offset + 1] = g;
  pixels[offset + 2] = b;
  pixels[offset + 3] = a;
}

function fillCircle(pixels, width, cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) setPixel(pixels, width, x, y, color[0], color[1], color[2]);
    }
  }
}

function ballSheet() {
  const width = 256;
  const height = 128;
  const pixels = Buffer.alloc(width * height * 4);
  for (let frame = 0; frame < 4; frame += 1) {
    const ox = 16;
    const oy = frame * 32 + 16;
    fillCircle(pixels, width, ox, oy, 13, [232, 236, 214]);
    fillCircle(pixels, width, ox, oy, 12, [186, 194, 168]);
    fillCircle(pixels, width, ox - 3, oy - 4 + frame, 4, [244, 247, 232]);
    fillCircle(pixels, width, ox + 4, oy + 3, 2, [92, 74, 58]);
  }
  return png(width, height, pixels);
}

function triangleThumb() {
  const width = 32;
  const height = 32;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x + y < 30) continue;
      const edge = x < 2 || y > 29 || Math.abs(x + y - 30) < 2;
      const color = edge ? [44, 49, 56] : [138, 143, 152];
      setPixel(pixels, width, x, y, color[0], color[1], color[2]);
    }
  }
  return png(width, height, pixels);
}

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'rolling-ball.png'), ballSheet());
fs.writeFileSync(path.join(root, 'triangle-piece.png'), triangleThumb());
