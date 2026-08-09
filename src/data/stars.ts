/**
 * The packed star catalogue's format.
 *
 * Kept out of the render layer on purpose: `pnpm validate` reads the same file
 * under Node, and it should be checking the bytes that ship rather than a second
 * implementation of how to read them. Nothing here touches Three.js or the DOM.
 *
 * See src/data/generated/stars.ts for the layout this mirrors, and
 * src/render/sky.ts for what is done with the result.
 */

import { STAR_CATALOGUE } from './generated/stars.ts'

/** Radians per milliarcsecond. */
const MAS = ((1 / 3_600_000) * Math.PI) / 180

/** Bytes per star across all five blocks. */
const BYTES_PER_STAR = 13

export interface StarData {
  count: number
  /** Unit vectors at J2000, ICRF equatorial, xyz per star. */
  direction: Float32Array
  /** Tangential proper motion in the same frame, radians per Julian year. */
  properMotion: Float32Array
  /** Johnson V. */
  magnitude: Float32Array
  /** sRGB chromaticity, three bytes per star. */
  colour: Uint8Array
}

/**
 * Unpack public/sky/stars.bin.
 *
 * The packed form exists to keep the file small on disk; everything is widened
 * here into the layout the GPU wants, once. Right ascension and declination
 * become a unit vector, and the catalogue's two proper-motion components become
 * a tangential velocity in the same frame — which is what lets the vertex shader
 * advance a star to any date with a single multiply-add.
 *
 * Returns null rather than throwing for anything unexpected: a missing or stale
 * catalogue should cost the stars, not the application.
 */
export function unpackStars(buffer: ArrayBuffer): StarData | null {
  if (buffer.byteLength < STAR_CATALOGUE.headerBytes) return null
  const header = new DataView(buffer)
  if (header.getUint32(0, true) !== STAR_CATALOGUE.magic) return null
  if (header.getUint32(4, true) !== STAR_CATALOGUE.version) return null
  const count = header.getUint32(8, true)
  // The generated module and the binary are written in the same pass, so a
  // disagreement means one of them is stale.
  if (count !== STAR_CATALOGUE.count) return null
  if (buffer.byteLength < STAR_CATALOGUE.headerBytes + count * BYTES_PER_STAR) return null

  let at = STAR_CATALOGUE.headerBytes
  const ra = new Uint16Array(buffer, at, count)
  at += count * 2
  const dec = new Int16Array(buffer, at, count)
  at += count * 2
  const pm = new Int16Array(buffer, at, count * 2)
  at += count * 4
  const mag = new Int16Array(buffer, at, count)
  at += count * 2
  const rgb = new Uint8Array(buffer, at, count * 3)

  const direction = new Float32Array(count * 3)
  const properMotion = new Float32Array(count * 3)
  const magnitude = new Float32Array(count)

  const RA_SCALE = (Math.PI * 2) / 65536
  const DEC_SCALE = Math.PI / 2 / 32767

  for (let i = 0; i < count; i++) {
    const alpha = ra[i]! * RA_SCALE
    const delta = dec[i]! * DEC_SCALE
    const ca = Math.cos(alpha)
    const sa = Math.sin(alpha)
    const cd = Math.cos(delta)
    const sd = Math.sin(delta)

    direction[i * 3] = cd * ca
    direction[i * 3 + 1] = cd * sa
    direction[i * 3 + 2] = sd

    // East and north unit vectors at the star. The catalogue's pmRA already
    // carries the cos(dec) factor, so it is a true angular rate along east and
    // the two components combine with no further scaling — which is also why
    // this stays well behaved at Polaris, where dividing by cos(dec) would not.
    const muE = pm[i * 2]! * MAS
    const muN = pm[i * 2 + 1]! * MAS
    properMotion[i * 3] = muE * -sa + muN * -sd * ca
    properMotion[i * 3 + 1] = muE * ca + muN * -sd * sa
    properMotion[i * 3 + 2] = muN * cd

    magnitude[i] = mag[i]! / 1000
  }

  return { count, direction, properMotion, magnitude, colour: rgb }
}
