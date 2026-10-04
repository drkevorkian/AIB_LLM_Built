import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../src/server/artifacts.js';

/** Independent wire fixture writes every classic record field explicitly. */
export function zipFixture(
  members: {
    name: string;
    body: Buffer;
    method?: number;
    flags?: number;
    attributes?: number;
    extra?: Buffer;
    packed?: Buffer;
  }[],
): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name),
      method = member.method ?? 0;
    const packed = member.packed ?? (method === 8 ? deflateRawSync(member.body) : member.body);
    const extra = member.extra ?? Buffer.alloc(0);
    const crc = crc32(member.body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(member.flags ?? 0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(member.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50);
    head.writeUInt16LE(0x314, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(member.flags ?? 0x800, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(member.body.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt16LE(extra.length, 30);
    head.writeUInt32LE(member.attributes ?? 0x8000 * 65536, 38);
    head.writeUInt32LE(offset, 42);
    locals.push(local, name, extra, packed);
    central.push(head, name, extra);
    offset += local.length + name.length + extra.length + packed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
