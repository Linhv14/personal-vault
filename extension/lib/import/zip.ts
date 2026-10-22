export class ZipError extends Error {}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const ZIP64_MARKER = 0xffffffff;

export interface ZipEntry {
  name: string;
  read(): Promise<Uint8Array>;
}

function findEndOfCentralDirectory(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= earliest; offset--) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new ZipError("Not a zip archive");
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(view);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (offset === ZIP64_MARKER) {
    throw new ZipError("ZIP64 archives are not supported");
  }

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new ZipError("Damaged zip directory");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    entries.push({
      name,
      async read() {
        if (compressedSize === ZIP64_MARKER || localOffset === ZIP64_MARKER) {
          throw new ZipError("ZIP64 archives are not supported");
        }
        if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
          throw new ZipError("Damaged zip entry");
        }
        const start =
          localOffset +
          30 +
          view.getUint16(localOffset + 26, true) +
          view.getUint16(localOffset + 28, true);
        const data = bytes.subarray(start, start + compressedSize);
        if (method === STORED) {
          return data;
        }
        if (method === DEFLATED) {
          return inflate(data);
        }
        throw new ZipError(`Unsupported zip compression method ${method}`);
      },
    });
  }
  return entries;
}
