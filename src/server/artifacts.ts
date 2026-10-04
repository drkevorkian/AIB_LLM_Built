import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import type {
  ArtifactMedia,
  ArtifactPreview,
  ArtifactReference,
  ArtifactVersion,
} from '../shared/contracts.js';
import { maxArtifactBytes } from '../shared/contracts.js';
import { AppError } from './errors.js';

const invalid = (message = 'Invalid or unsupported artifact bytes or archive.') =>
  new AppError(400, message);
export function artifactHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function validateFilename(name: string): void {
  if (
    !name ||
    name.length > 120 ||
    Buffer.byteLength(name) > 240 ||
    name === '.' ||
    name === '..' ||
    /[\\/:<>"|?*]/.test(name) ||
    /[ .]$/.test(name) ||
    /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name) ||
    Array.from(name).some((c) => {
      const n = c.codePointAt(0)!;
      return (
        n < 32 ||
        (n >= 127 && n <= 159) ||
        (n >= 0xd800 && n <= 0xdfff) ||
        (n >= 0x202a && n <= 0x202e) ||
        (n >= 0x2066 && n <= 0x2069)
      );
    })
  )
    throw invalid('Use a bounded filename without paths, reserved names or control characters.');
}
export function decodeArtifact(base64: string): Buffer {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > maxArtifactBytes)
    throw new AppError(413, 'An artifact version is limited to 512 KiB.');
  if (bytes.toString('base64') !== base64) throw invalid('Use canonical base64 artifact bytes.');
  return bytes;
}
function utf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw invalid('Text artifacts must contain valid UTF-8.');
  }
}
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function nestedArchive(name: string, bytes: Buffer): boolean {
  return (
    /\.(zip|zipx|jar|docx|xlsx|pptx|odt|ods|odp|tar|gz|tgz|bz2|xz|7z|rar)$/i.test(name) ||
    (bytes.length >= 4 && [0x04034b50, 0x06054b50].includes(bytes.readUInt32LE(0))) ||
    bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ||
    bytes.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) ||
    bytes.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0])) ||
    bytes.subarray(0, 3).toString('ascii') === 'BZh' ||
    bytes.subarray(257, 262).toString('ascii') === 'ustar' ||
    bytes.subarray(0, 4).toString('ascii') === 'Rar!'
  );
}
function validateZipExtras(bytes: Buffer): void {
  for (let p = 0; p < bytes.length;) {
    if (p + 4 > bytes.length) throw invalid('Truncated ZIP extra field.');
    const id = bytes.readUInt16LE(p);
    const length = bytes.readUInt16LE(p + 2);
    if (p + 4 + length > bytes.length || id === 1 || id === 0x7075)
      throw invalid('ZIP64, alternate path or truncated ZIP extra fields are unsupported.');
    p += 4 + length;
  }
}
/** Classic ZIP subset; never extracts a member to the filesystem. APPNOTE is linked in ADR 0023. */
export function archiveManifest(bytes: Buffer): NonNullable<ArtifactPreview['entries']> {
  try {
    let end = -1;
    for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 22 - 65535); p--)
      if (
        bytes.readUInt32LE(p) === 0x06054b50 &&
        p + 22 + bytes.readUInt16LE(p + 20) === bytes.length
      ) {
        end = p;
        break;
      }
    if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw invalid();
    const count = bytes.readUInt16LE(end + 10);
    const size = bytes.readUInt32LE(end + 12);
    const start = bytes.readUInt32LE(end + 16);
    if (!count || count > 32 || count !== bytes.readUInt16LE(end + 8) || start + size !== end)
      throw invalid('ZIP files require 1–32 regular members within the bounded classic format.');
    let cursor = start;
    let expanded = 0;
    const seen = new Set<string>();
    const ranges: { start: number; end: number }[] = [];
    const entries: NonNullable<ArtifactPreview['entries']> = [];
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
      const flags = bytes.readUInt16LE(cursor + 8),
        method = bytes.readUInt16LE(cursor + 10);
      const crc = bytes.readUInt32LE(cursor + 16),
        compressed = bytes.readUInt32LE(cursor + 20),
        inflated = bytes.readUInt32LE(cursor + 24);
      const nameLength = bytes.readUInt16LE(cursor + 28),
        extra = bytes.readUInt16LE(cursor + 30),
        comment = bytes.readUInt16LE(cursor + 32);
      const attributes = bytes.readUInt32LE(cursor + 38),
        local = bytes.readUInt32LE(cursor + 42);
      const next = cursor + 46 + nameLength + extra + comment;
      if (
        next > end ||
        !nameLength ||
        flags & ~0x806 ||
        (method === 0 && flags & 6) ||
        ![0, 8].includes(method) ||
        bytes.readUInt16LE(cursor + 6) > 20 ||
        bytes.readUInt16LE(cursor + 34) ||
        attributes & 16 ||
        ![0, 0x8000].includes((attributes >>> 16) & 0xf000) ||
        inflated > maxArtifactBytes ||
        inflated > Math.max(1, compressed) * 100 ||
        compressed > maxArtifactBytes ||
        local + 30 > start
      )
        throw invalid('ZIP member flags, type, size or expansion ratio are unsupported.');
      expanded += inflated;
      if (expanded > 4 * 1024 * 1024) throw invalid('ZIP expanded bytes exceed 4 MiB.');
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      validateZipExtras(bytes.subarray(cursor + 46 + nameLength, next - comment));
      if (!(flags & 0x800) && nameBytes.some((value) => value > 127))
        throw invalid('ZIP Unicode filenames require the UTF-8 flag.');
      const filename = utf8(nameBytes);
      if (
        filename.length > 240 ||
        filename.startsWith('/') ||
        filename.split('/').some((part) => !part)
      )
        throw invalid('Unsafe ZIP member path.');
      filename.split('/').forEach(validateFilename);
      const key = filename.normalize('NFC').toLowerCase();
      if (seen.has(key)) throw invalid('ZIP member paths must be distinct.');
      seen.add(key);
      if (
        bytes.readUInt32LE(local) !== 0x04034b50 ||
        bytes.readUInt16LE(local + 4) > 20 ||
        bytes.readUInt16LE(local + 6) !== flags ||
        bytes.readUInt16LE(local + 8) !== method ||
        bytes.readUInt32LE(local + 14) !== crc ||
        bytes.readUInt32LE(local + 18) !== compressed ||
        bytes.readUInt32LE(local + 22) !== inflated ||
        bytes.readUInt16LE(local + 26) !== nameLength
      )
        throw invalid('ZIP central and local records disagree.');
      const bodyStart = local + 30 + nameLength + bytes.readUInt16LE(local + 28);
      const bodyEnd = bodyStart + compressed;
      if (bodyEnd > start || !bytes.subarray(local + 30, local + 30 + nameLength).equals(nameBytes))
        throw invalid();
      validateZipExtras(bytes.subarray(local + 30 + nameLength, bodyStart));
      ranges.push({ start: local, end: bodyEnd });
      const packed = bytes.subarray(bodyStart, bodyEnd);
      let original = packed;
      if (method === 8) {
        // Node's info option returns this documented object; the typings omit its overload.
        const result = inflateRawSync(packed, {
          maxOutputLength: Math.max(1, inflated),
          info: true,
        }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        if (result.engine.bytesWritten !== packed.length)
          throw invalid('ZIP deflate stream contains trailing bytes.');
        original = result.buffer;
      }
      if (
        original.length !== inflated ||
        crc32(original) !== crc ||
        nestedArchive(filename, original)
      )
        throw invalid('ZIP member content, checksum or nested archive is invalid.');
      entries.push({ filename, byteSize: original.length, sha256: artifactHash(original) });
      cursor = next;
    }
    ranges.sort((a, b) => a.start - b.start);
    if (
      cursor !== end ||
      ranges[0]!.start !== 0 ||
      ranges.at(-1)!.end !== start ||
      ranges.some((range, i) => i > 0 && range.start !== ranges[i - 1]!.end)
    )
      throw invalid('ZIP contains overlapping, extra or self-extracting records.');
    return entries;
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw invalid();
  }
}
export function inspectArtifact(
  mediaType: ArtifactMedia,
  filename: string,
  bytes: Buffer,
): { kind: ArtifactReference['previewKind']; text?: string; entries?: ArtifactPreview['entries'] } {
  validateFilename(filename);
  if (bytes.length > maxArtifactBytes)
    throw new AppError(413, 'An artifact version is limited to 512 KiB.');
  if (mediaType === 'application/zip') return { kind: 'archive', entries: archiveManifest(bytes) };
  if (bytes.length >= 4 && [0x04034b50, 0x06054b50].includes(bytes.readUInt32LE(0)))
    throw invalid('ZIP bytes must use the ZIP media type and archive validation.');
  if (
    mediaType === 'text/plain' ||
    mediaType === 'text/markdown' ||
    mediaType === 'application/json'
  ) {
    const text = utf8(bytes);
    if (
      Array.from(text).some((c) => {
        const n = c.codePointAt(0)!;
        return (n < 32 && ![9, 10, 13].includes(n)) || (n >= 127 && n <= 159);
      })
    )
      throw invalid('Text artifacts contain unsupported control characters.');
    if (mediaType === 'application/json') {
      try {
        JSON.parse(text);
      } catch {
        throw invalid('JSON artifact syntax is invalid.');
      }
    }
    return { kind: 'text', text };
  }
  if (
    mediaType === 'image/png' &&
    !(
      bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.subarray(12, 16).toString('ascii') === 'IHDR'
    )
  )
    throw invalid('PNG signature is invalid.');
  if (
    mediaType === 'image/jpeg' &&
    !(
      bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes.at(-2) === 255 &&
      bytes.at(-1) === 217
    )
  )
    throw invalid('JPEG signature is invalid.');
  if (
    mediaType === 'application/pdf' &&
    !(
      bytes.subarray(0, 5).toString('ascii') === '%PDF-' &&
      bytes.subarray(-1024).includes(Buffer.from('%%EOF'))
    )
  )
    throw invalid('PDF signature is invalid.');
  return { kind: 'metadata' };
}
export function artifactReference(version: ArtifactVersion): ArtifactReference {
  const { clientId: _clientId, commandHash: _commandHash, ...reference } = structuredClone(version);
  return reference;
}
