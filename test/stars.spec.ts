/**
 * The packed star catalogue.
 *
 * Reads the committed public/sky/stars.bin, the same bytes that ship, and
 * checks the widened layout plus the refusal paths: a stale or truncated file
 * must cost the stars, not the application.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STAR_CATALOGUE } from '../src/data/generated/stars.ts';
import { unpackStars } from '../src/data/stars.ts';

const file = readFileSync(new URL(`../public/${STAR_CATALOGUE.file}`, import.meta.url));
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

/** A copy of the catalogue with one header word replaced. */
const withHeader = (offset: number, value: number): ArrayBuffer => {
  const copy = buffer.slice(0);
  new DataView(copy).setUint32(offset, value, true);
  return copy;
};

describe('unpackStars', () => {
  const stars = unpackStars(buffer);

  it('unpacks every star into the GPU layout', () => {
    expect(stars).not.toBeNull();
    const s = stars!;
    expect(s.count).toBe(STAR_CATALOGUE.count);
    expect(s.direction).toHaveLength(s.count * 3);
    expect(s.properMotion).toHaveLength(s.count * 3);
    expect(s.magnitude).toHaveLength(s.count);
    expect(s.colour).toHaveLength(s.count * 3);
  });

  it('emits unit directions, magnitudes within the limit, and tangential proper motion', () => {
    const s = stars!;
    let worstNorm = 0;
    let worstRadial = 0;
    for (let i = 0; i < s.count; i++) {
      const [x, y, z] = [s.direction[i * 3], s.direction[i * 3 + 1], s.direction[i * 3 + 2]];
      const [px, py, pz] = [
        s.properMotion[i * 3],
        s.properMotion[i * 3 + 1],
        s.properMotion[i * 3 + 2],
      ];
      worstNorm = Math.max(worstNorm, Math.abs(Math.hypot(x, y, z) - 1));
      worstRadial = Math.max(worstRadial, Math.abs(x * px + y * py + z * pz));
    }
    expect(worstNorm).toBeLessThan(1e-5);
    expect(worstRadial).toBeLessThan(1e-12);
    expect(Math.max(...s.magnitude)).toBeLessThanOrEqual(STAR_CATALOGUE.magnitudeLimit + 0.001);
  });

  it('refuses a truncated, foreign, newer or stale file', () => {
    expect(unpackStars(new ArrayBuffer(4))).toBeNull();
    expect(unpackStars(buffer.slice(0, STAR_CATALOGUE.headerBytes + 100))).toBeNull();
    expect(unpackStars(withHeader(0, 0xdeadbeef))).toBeNull();
    expect(unpackStars(withHeader(4, STAR_CATALOGUE.version + 1))).toBeNull();
    expect(unpackStars(withHeader(8, STAR_CATALOGUE.count - 1))).toBeNull();
  });
});
