import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const [, , staticRoot, port] = process.argv;
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};
async function forward(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const upstream = await fetch(`http://127.0.0.1:8787${req.url}`, {
    method: req.method,
    headers: { ...req.headers, host: "127.0.0.1:8787" },
    body: chunks.length ? Buffer.concat(chunks) : undefined,
    redirect: "manual",
  });
  const headers = {};
  upstream.headers.forEach((v, k) => {
    if (
      ![
        "content-encoding",
        "content-length",
        "content-security-policy",
        "x-frame-options",
      ].includes(k)
    )
      headers[k] = v;
  });
  res.writeHead(upstream.status, headers);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
http
  .createServer(async (req, res) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/app")) return forward(req, res);
    try {
      const file = path.join(staticRoot, decodeURIComponent(req.url.split("?")[0]));
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": types[path.extname(file)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(Number(port));
