import { chromium, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EXTENSION_DIR } from "./env.ts";

export interface Harness {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}

async function launchExtension(profile: string): Promise<Harness> {
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: process.env.HEADED !== "1",
    locale: "en-US",
    viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
  await context.route("https://7key.online/**", (route) => route.fulfill({ status: 503 }));
  const serviceWorker =
    context.serviceWorkers().find((worker) => worker.url().endsWith("/background.js")) ??
    (await context.waitForEvent("serviceworker", {
      predicate: (worker) => worker.url().endsWith("/background.js"),
    }));
  return { context, extensionId: new URL(serviceWorker.url()).host, serviceWorker };
}

export function useExtension(): () => Harness {
  let harness: Harness | undefined;
  let profile = "";

  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    profile = mkdtempSync(path.join(tmpdir(), "7key-e2e-"));
    harness = await launchExtension(profile);
  });

  test.afterAll(async () => {
    if (!harness) {
      return;
    }
    await harness.context.close();
    rmSync(profile, { recursive: true, force: true });
  });

  return () => {
    if (!harness) {
      throw new Error("The extension is not running");
    }
    return harness;
  };
}

export function extensionUrl(harness: Harness, page: string): string {
  return `chrome-extension://${harness.extensionId}/${page}`;
}

export async function openPopup(harness: Harness): Promise<Page> {
  const page = await harness.context.newPage();
  await page.goto(extensionUrl(harness, "popup/popup.html"));
  return page;
}
