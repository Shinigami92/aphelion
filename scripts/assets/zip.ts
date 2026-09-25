/** Reading zip archives: whole ones on disk, or single entries of remote ones by byte range. */

import { inflateRawSync } from 'node:zlib';
import { C, mb, UA } from './io.ts';

/**
 * Pull one entry out of a zip.
 *
 * Node ships no zip reader, but these archives are the simple case — a few
 * deflated entries with their sizes in the local headers — so walking them is
 * shorter than taking on a dependency or shelling out to `unzip`.
 */
export function unzipEntry(buf: Buffer, nameFragment: string): Buffer | null {
  let pos = 0;
  while (pos + 30 <= buf.length && buf.readUInt32LE(pos) === 0x04034b50) {
    const flags = buf.readUInt16LE(pos + 6);
    const method = buf.readUInt16LE(pos + 8);
    const csize = buf.readUInt32LE(pos + 18);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const name = buf.toString('ascii', pos + 30, pos + 30 + nameLen);
    const start = pos + 30 + nameLen + extraLen;
    // Bit 3 puts the sizes after the data instead, which would mean scanning for
    // the descriptor; these archives do not use it, so refuse rather than guess.
    if (flags & 0x08) {
      return null;
    }
    if (name.includes(nameFragment)) {
      const data = buf.subarray(start, start + csize);
      if (method === 0) {
        return Buffer.from(data);
      }
      if (method === 8) {
        return inflateRawSync(data);
      }
      return null;
    }
    pos = start + csize;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2c-b. PDS3 elevation grids inside a remote archive  (public domain)
//
// Titan's topography is the one grid here that is neither a single raster
// download nor a shape model. The Cassini RADAR team's GTDR ships as a 256 MB
// zip of 235 files — twenty-odd competing shape models at two resolutions —
// of which Aphelion wants two hemispheres totalling under a megabyte. So this
// path reads the archive over HTTP range requests instead of downloading it,
// and takes every projection parameter from each file's own attached PDS3
// label rather than from anything asserted here. That matters more than usual:
// the two hemispheres carry *different* SAMPLE_PROJECTION_OFFSETs, and the
// product is in west longitude where every other map in this project is in
// east, so a hard-coded layout would have half a chance of being mirrored and
// no way to notice.
// ---------------------------------------------------------------------------

/** A single HTTP range request. Returns null unless the server honours it. */
async function fetchRange(url: string, range: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Range: `bytes=${range}` } });
    // 200 means the server ignored the range and is sending the whole file;
    // reading that as if it were the requested slice is how you get a plausible
    // but wrong parse, so refuse it and let the caller fall back.
    if (res.status !== 206) {
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Pull named entries out of a zip without downloading the whole archive.
 *
 * Walks the same structures `unzipEntry` does, only over the network: the end
 * of the central directory (in the last 64 KB), the directory itself, then each
 * wanted entry's local header and payload. Anything unexpected — no ranges, a
 * zip64 directory, a name that is not there — returns null, and the caller
 * falls back to fetching the archive in full.
 */
export async function fetchZipEntries(
  url: string,
  names: string[],
): Promise<Map<string, Buffer> | null> {
  const tail = await fetchRange(url, '-65536');
  if (!tail) {
    return null;
  }

  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > tail.length) {
    return null;
  }
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  // Zip64 parks 0xffffffff here and puts the real values in a separate record.
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    return null;
  }

  const cd = await fetchRange(url, `${cdOffset}-${cdOffset + cdSize - 1}`);
  if (!cd || cd.length !== cdSize) {
    return null;
  }

  const found = new Map<string, Buffer>();
  let pos = 0;
  while (pos + 46 <= cd.length && cd.readUInt32LE(pos) === 0x02014b50) {
    const csize = cd.readUInt32LE(pos + 20);
    const nameLen = cd.readUInt16LE(pos + 28);
    const extraLen = cd.readUInt16LE(pos + 30);
    const commentLen = cd.readUInt16LE(pos + 32);
    const localOffset = cd.readUInt32LE(pos + 42);
    const name = cd.toString('ascii', pos + 46, pos + 46 + nameLen);
    const wanted = names.find((n) => name.includes(n));
    if (wanted !== undefined && wanted !== '' && !found.has(wanted)) {
      // The local header repeats the name and may carry a different extra field
      // than the central one, so over-fetch and let unzipEntry read the real
      // lengths out of the header it finds at byte 0.
      const slack = 1024;
      const raw = await fetchRange(url, `${localOffset}-${localOffset + csize + slack - 1}`);
      // A range clipped at end-of-file would hand inflate a truncated stream,
      // which throws rather than returning null; either way, give up on ranges
      // and let the caller fetch the archive whole.
      let entry: Buffer | null = null;
      try {
        entry = raw ? unzipEntry(raw, wanted) : null;
      } catch {
        entry = null;
      }
      if (!entry) {
        return null;
      }
      found.set(wanted, entry);
      console.log(`  ${C.dim('ranged ')} ${name} ${C.dim(mb(entry.length))}`);
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return found.size === names.length ? found : null;
}
