import { sealedFileSize } from "#core/files.js";
import { PLAN_LIMITS } from "#core/org-model.js";
import type { Env } from "./types.js";

export type AttachmentsMode = "all" | "paid" | "off";

const MIB = 1024 * 1024;
const DEFAULT_FILE_MAX_BYTES = 25 * MIB;
const DEFAULT_ACCOUNT_FILES_BYTES = 250 * MIB;
export const FILES_PER_ITEM = 20;
export const ORPHAN_SECONDS = 24 * 60 * 60;
export const PENDING_SECONDS = 60 * 60;

export function attachmentsMode(env: Env): AttachmentsMode {
  if (!env.FILES) {
    return "off";
  }
  return env.ATTACHMENTS === "paid" || env.ATTACHMENTS === "off" ? env.ATTACHMENTS : "all";
}

function bytes(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function fileLimits(env: Env) {
  const fileMax = bytes(env.FILE_MAX_BYTES, DEFAULT_FILE_MAX_BYTES);
  return {
    fileMax,
    sealedMax: sealedFileSize(fileMax),
    accountBytes: bytes(env.ACCOUNT_FILES_BYTES, DEFAULT_ACCOUNT_FILES_BYTES),
    perItem: FILES_PER_ITEM,
  };
}

export function personalFileKey(accountId: string, fileId: string): string {
  return `a/${accountId}/${fileId}`;
}

const PAID_PLANS = Object.entries(PLAN_LIMITS)
  .filter(([, limits]) => limits.attachments)
  .map(([plan]) => plan);

export async function mayAttach(env: Env, accountId: string): Promise<boolean> {
  const mode = attachmentsMode(env);
  if (mode !== "paid") {
    return mode === "all";
  }
  const row = await env.DB.prepare(
    `SELECT 1 AS paid FROM org_members m JOIN orgs o ON o.id = m.org_id
      WHERE m.account_id = ? AND o.plan IN (${PAID_PLANS.map(() => "?").join(", ")}) LIMIT 1`,
  )
    .bind(accountId, ...PAID_PLANS)
    .first<{ paid: number }>();
  return row !== null;
}
