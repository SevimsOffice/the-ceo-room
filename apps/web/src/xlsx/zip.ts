/**
 * Just enough of the ZIP format to look inside an .xlsx before (and beside) the xlsx library:
 * the central directory (names and declared sizes, read without inflating anything, so a zip bomb
 * is refused before it is unpacked) and single entries (inflated with the platform's
 * DecompressionStream, for the few small XML parts the library does not expose: number formats).
 */

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate */
  method: number;
  compressedSize: number;
  /** declared uncompressed size; Infinity for ZIP64 entries (sizes beyond 4 GB markers) */
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const u16 = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number): number => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/** The central directory's entries, or null when the bytes have no readable directory. */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] | null {
  // the end-of-central-directory record: 22 bytes plus a comment of at most 64 KB, at the end
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(bytes, i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(bytes, eocd + 10);
  const size = u32(bytes, eocd + 12);
  const offset = u32(bytes, eocd + 16);
  if (count === 0xffff || offset === 0xffffffff || offset + size > bytes.length) {
    // ZIP64 (or a directory pointing outside the file): far beyond anything the template needs
    return count === 0xffff || offset === 0xffffffff ? [{ name: '', method: 0, compressedSize: 0, uncompressedSize: Infinity, localHeaderOffset: 0 }] : null;
  }
  const entries: ZipEntry[] = [];
  let at = offset;
  const decoder = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== CENTRAL) return null;
    const nameLen = u16(bytes, at + 28);
    const extraLen = u16(bytes, at + 30);
    const commentLen = u16(bytes, at + 32);
    const compressed = u32(bytes, at + 20);
    const uncompressed = u32(bytes, at + 24);
    entries.push({
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen)),
      method: u16(bytes, at + 10),
      compressedSize: compressed,
      uncompressedSize: uncompressed === 0xffffffff || compressed === 0xffffffff ? Infinity : uncompressed,
      localHeaderOffset: u32(bytes, at + 42),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Sum of the entries' declared uncompressed sizes (what unpacking the file would take). */
export function unzippedSize(entries: readonly ZipEntry[]): number {
  return entries.reduce((t, e) => t + e.uncompressedSize, 0);
}

/** One entry's bytes (stored or deflated), or null when it cannot be read. Never more than its declared size. */
export async function readZipEntry(bytes: Uint8Array, e: ZipEntry): Promise<Uint8Array | null> {
  const at = e.localHeaderOffset;
  if (!Number.isFinite(e.uncompressedSize) || at + 30 > bytes.length || u32(bytes, at) !== LOCAL) return null;
  const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
  const data = bytes.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data.slice(0, e.uncompressedSize);
  if (e.method !== 8 || typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const out = new Uint8Array(e.uncompressedSize);
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > out.length) {
        await reader.cancel();
        return null; // larger than declared: not trusted
      }
      out.set(value, n);
      n += value.length;
    }
    return out.subarray(0, n);
  } catch {
    return null;
  }
}
