import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function launch(port = 9333) {
  const profile = mkdtempSync(path.join(tmpdir(), "7key-shots-"));
  const proc = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      "--headless=new",
      `--user-data-dir=${profile}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let targets = [];
  for (let i = 0; i < 150; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const payload = await response.json();
      targets = Array.isArray(payload) ? payload : [];
      if (targets.length) {
        break;
      }
    } catch {
      targets = [];
    }
    await sleep(200);
  }
  const page = targets?.find((t) => t.type === "page");
  if (!page) {
    proc.kill();
    throw new Error(`Chrome did not expose a page on port ${port}`);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      listeners.forEach((l) => l(msg));
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  const api = {
    send,
    async viewport(width, height, scale = 2, dark = true) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: false,
      });
      await send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }],
      });
    },
    async goto(url, wait = 1500) {
      const loaded = new Promise((r) => {
        const l = (m) => {
          if (m.method === "Page.loadEventFired") {
            listeners.splice(listeners.indexOf(l), 1);
            r();
          }
        };
        listeners.push(l);
      });
      await send("Page.navigate", { url });
      await loaded;
      await sleep(wait);
    },
    async eval(fn, ...args) {
      const expression = `(${fn})(...${JSON.stringify(args)})`;
      const r = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      }
      return r.result.value;
    },
    async shot(file, format = "png") {
      const r = await send("Page.captureScreenshot", {
        format,
        quality: format === "jpeg" ? 92 : undefined,
      });
      writeFileSync(file, Buffer.from(r.data, "base64"));
    },
    on(fn) {
      listeners.push(fn);
    },
    close() {
      ws.close();
      proc.kill();
    },
  };
  return api;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
