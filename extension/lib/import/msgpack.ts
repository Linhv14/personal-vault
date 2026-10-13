export type MsgpackValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | MsgpackValue[]
  | { [key: string]: MsgpackValue };

export class MsgpackError extends Error {}

export function decodeMsgpack(input: Uint8Array): MsgpackValue {
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer);
  const text = new TextDecoder();
  let offset = 0;

  const take = (length: number): Uint8Array => {
    if (offset + length > bytes.length) throw new MsgpackError("Truncated MessagePack data");
    const slice = bytes.subarray(offset, offset + length);
    offset += length;
    return slice;
  };
  const uint = (size: 1 | 2 | 4): number => {
    const value =
      size === 1
        ? view.getUint8(offset)
        : size === 2
          ? view.getUint16(offset)
          : view.getUint32(offset);
    offset += size;
    return value;
  };
  const array = (length: number): MsgpackValue[] => Array.from({ length }, () => read());
  const map = (length: number): { [key: string]: MsgpackValue } => {
    const out: { [key: string]: MsgpackValue } = {};
    for (let index = 0; index < length; index++) {
      const key = read();
      out[typeof key === "string" ? key : String(key)] = read();
    }
    return out;
  };

  function read(): MsgpackValue {
    if (offset >= bytes.length) throw new MsgpackError("Truncated MessagePack data");
    const type = view.getUint8(offset++);
    if (type <= 0x7f) return type;
    if (type >= 0xe0) return type - 0x100;
    if (type >= 0x80 && type <= 0x8f) return map(type & 0x0f);
    if (type >= 0x90 && type <= 0x9f) return array(type & 0x0f);
    if (type >= 0xa0 && type <= 0xbf) return text.decode(take(type & 0x1f));
    switch (type) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return take(uint(1)).slice();
      case 0xc5:
        return take(uint(2)).slice();
      case 0xc6:
        return take(uint(4)).slice();
      case 0xca: {
        const value = view.getFloat32(offset);
        offset += 4;
        return value;
      }
      case 0xcb: {
        const value = view.getFloat64(offset);
        offset += 8;
        return value;
      }
      case 0xcc:
        return uint(1);
      case 0xcd:
        return uint(2);
      case 0xce:
        return uint(4);
      case 0xcf: {
        const value = view.getBigUint64(offset);
        offset += 8;
        return value;
      }
      case 0xd0: {
        const value = view.getInt8(offset);
        offset += 1;
        return value;
      }
      case 0xd1: {
        const value = view.getInt16(offset);
        offset += 2;
        return value;
      }
      case 0xd2: {
        const value = view.getInt32(offset);
        offset += 4;
        return value;
      }
      case 0xd3: {
        const value = view.getBigInt64(offset);
        offset += 8;
        return value;
      }
      case 0xd9:
        return text.decode(take(uint(1)));
      case 0xda:
        return text.decode(take(uint(2)));
      case 0xdb:
        return text.decode(take(uint(4)));
      case 0xdc:
        return array(uint(2));
      case 0xdd:
        return array(uint(4));
      case 0xde:
        return map(uint(2));
      case 0xdf:
        return map(uint(4));
      default:
        throw new MsgpackError(`Unsupported MessagePack type 0x${type.toString(16)}`);
    }
  }

  const value = read();
  if (offset !== bytes.length) throw new MsgpackError("Trailing bytes after MessagePack value");
  return value;
}
