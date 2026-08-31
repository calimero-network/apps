/**
 * Where did the renderer actually put things? Finds the painted bounding box of a
 * few known-colour elements and compares it with the element's declared geometry.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright'; // pnpm dlx playwright, or use the app's @playwright/test

const OUT = new URL('.', import.meta.url).pathname; // this directory
const elements = JSON.parse(readFileSync(`${OUT}/northwind-elements.json`, 'utf8'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });

await page.addInitScript(() => {
  localStorage.setItem('mero-tokens', JSON.stringify({
    access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LWlkZW50aXR5In0.sig',
    refresh_token: 'r', expires_at: Date.now() + 3600000,
  }));
  localStorage.setItem('mero:node_url', 'http://localhost:2430');
  localStorage.setItem('mero:application_id', 'app-1');
});
await page.route('**/auth/validate', (r) => r.fulfill({ status: 200 }));
await page.route('**/admin-api/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { contexts: [], identities: ['test-identity'] } }) }));
await page.route('**/jsonrpc', (route) => {
  const body = route.request().postDataJSON();
  const m = body?.params?.method ?? '';
  const v = m === 'get_elements' ? elements
    : m === 'get_members' ? [{ id: 'test-identity', username: 'Fran', avatar: null, joinedAt: 1 }]
    : m === 'can_edit' ? true : m === 'my_role' ? 'owner' : [];
  const bytes = Array.from(new TextEncoder().encode(JSON.stringify(v)));
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? 1, result: { output: bytes } }) });
});

await page.goto('http://localhost:5199/teams/team-1/projects/ctx-1');
await page.waitForSelector('[data-testid="fabric-canvas"]');
await page.waitForTimeout(3000);

// Four rect fills that each appear exactly once in the design.
const uniqueFills = ['#FF00FF', '#00FFFF', '#FEF3C7'];
const targets = uniqueFills.map((f) => {
  const hits = elements.filter((e) => e.fill === f);
  return { fill: f, count: hits.length, el: hits[0] };
});

const res = await page.evaluate((targets) => {
  const c = document.querySelector('[data-testid="fabric-canvas"]');
  const ctx = c.getContext('2d');
  const { width, height } = c;
  const d = ctx.getImageData(0, 0, width, height).data;
  return targets.map((t) => {
    const r = parseInt(t.fill.slice(1, 3), 16), g = parseInt(t.fill.slice(3, 5), 16), b = parseInt(t.fill.slice(5, 7), 16);
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(d[i] - r) <= 2 && Math.abs(d[i+1] - g) <= 2 && Math.abs(d[i+2] - b) <= 2) {
        n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return { ...t, n, minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  });
}, targets);

console.log('label'.padEnd(18), 'declared xy'.padEnd(13), 'painted xy'.padEnd(13), 'offset'.padEnd(12), 'size decl/painted');
for (const r of res) {
  if (r.count !== 1 || r.n === 0) { console.log(`${(r.el?.label ?? r.fill).padEnd(18)} skipped (count=${r.count}, px=${r.n})`); continue; }
  const dx = r.minX - r.el.x, dy = r.minY - r.el.y;
  console.log(
    (r.el.label ?? r.fill).padEnd(18),
    `${r.el.x},${r.el.y}`.padEnd(13),
    `${r.minX},${r.minY}`.padEnd(13),
    `${dx},${dy}`.padEnd(12),
    `${r.el.width}x${r.el.height} / ${r.w}x${r.h}`,
  );
}
await browser.close();
