// Serves the shots build over http on a free port, and answers the few raw
// node requests (outside MeroJs) the app makes.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webp": "image/webp" };

export async function startServer() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = join(DIST, path);
    try {
      if (!(await stat(file)).isFile()) throw new Error();
    } catch {
      file = join(DIST, "index.html"); // SPA fallback: /login etc.
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r)); // port 0 = a free one
  const url = `http://127.0.0.1:${server.address().port}`;
  // Guard against a stale server answering on a reused port with another app.
  const html = await (await fetch(url + "/")).text();
  if (!html.includes('<meta name="shot-app" content="mero-chat"')) throw new Error(`${url} is not the mero-chat shots build`);
  return { url, close: () => server.close() };
}

export async function attachNode(page) {
  await page.route("http://node.mock/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/admin-api/identity") {
      const data = await page.evaluate(() => window.__SHOT_IDENTITY__);
      return route.fulfill({ json: { data } });
    }
    if (u.pathname === "/admin-api/applications") return route.fulfill({ json: { data: { apps: [] } } });
    console.log("[node.mock] unhandled", route.request().method(), u.pathname);
    return route.fulfill({ status: 404, json: { error: "not modelled" } });
  });
}
