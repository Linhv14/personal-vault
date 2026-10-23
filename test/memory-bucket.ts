export function memoryBucket() {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    objects,
    binding: {
      async put(key: string, value: ReadableStream | ArrayBuffer | Uint8Array | null) {
        const bytes =
          value instanceof ReadableStream
            ? new Uint8Array(await new Response(value).arrayBuffer())
            : new Uint8Array(value instanceof ArrayBuffer ? value : (value ?? new Uint8Array()));
        objects.set(key, bytes);
        return { key, size: bytes.length };
      },
      async get(key: string) {
        const bytes = objects.get(key);
        return bytes
          ? {
              key,
              size: bytes.length,
              body: new Response(bytes).body,
              arrayBuffer: async () => bytes.buffer,
            }
          : null;
      },
      async head(key: string) {
        const bytes = objects.get(key);
        return bytes ? { key, size: bytes.length } : null;
      },
      async delete(keys: string | string[]) {
        for (const key of typeof keys === "string" ? [keys] : keys) {
          objects.delete(key);
        }
      },
      async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
        const keys = [...objects.keys()]
          .filter((key) => key.startsWith(options.prefix ?? ""))
          .sort();
        return {
          objects: keys.map((key) => ({ key, size: objects.get(key)!.length })),
          truncated: false,
        };
      },
    },
  };
}
