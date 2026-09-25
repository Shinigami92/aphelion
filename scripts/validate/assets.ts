/** Where the shipped assets are, and a PNG decoder to read them back. */

import path from 'node:path';
import { inflateSync } from 'node:zlib';

export const PUBLIC_DIR = path.resolve(import.meta.dirname, '..', '..', 'public');
export const SHAPES_DIR = path.join(PUBLIC_DIR, 'shapes');

/**
 * Just enough PNG to read back what fetch-assets.ts writes: 8-bit truecolour,
 * no interlacing. Decoding here rather than trusting the numbers the encoder
 * reported means this check covers the file that actually ships.
 */
export function decodePng(buf: Buffer): {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
} {
  let pos = 8; // skip signature
  let width = 0;
  let height = 0;
  let channels = 3;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      // Colour type 2 is the relief maps' packed RGB; type 0 is the greyscale
      // the photomosaic builders write.
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 0) || data[12] !== 0) {
        throw new Error(`unexpected PNG format: depth ${data[8]}, colour ${data[9]}`);
      }
      channels = data[9] === 2 ? 3 : 1;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x];
      const left = x >= channels ? out[dst + x - channels] : 0;
      const up = y > 0 ? out[dst - stride + x] : 0;
      if (filter === 0) {
        out[dst + x] = cur;
      } else if (filter === 1) {
        out[dst + x] = (cur + left) & 0xff;
      } else if (filter === 2) {
        out[dst + x] = (cur + up) & 0xff;
      } else {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
  }
  return { width, height, channels, data: out };
}
