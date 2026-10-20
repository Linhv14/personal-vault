import { defineConfig } from "@playwright/test";
import path from "node:path";
import { API_URL, ARTIFACTS_DIR } from "./e2e-browser/env.ts";

export default defineConfig({
  testDir: "e2e-browser",
  testMatch: "*.spec.ts",
  outputDir: path.join(ARTIFACTS_DIR, "results"),
  globalSetup: "./e2e-browser/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(ARTIFACTS_DIR, "report"), open: "never" }],
  ],
  use: {
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node e2e-browser/worker.ts",
    url: `${API_URL}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
