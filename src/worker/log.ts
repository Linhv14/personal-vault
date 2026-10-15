function describe(error: unknown) {
  return error instanceof Error
    ? { error: error.name, message: error.message, stack: error.stack }
    : { error: "unknown", message: String(error) };
}

export function logError(event: string, error: unknown, fields: Record<string, unknown> = {}) {
  console.error({ level: "error", event, ...fields, ...describe(error) });
}

export function logInfo(event: string, fields: Record<string, unknown> = {}) {
  console.log({ level: "info", event, ...fields });
}
