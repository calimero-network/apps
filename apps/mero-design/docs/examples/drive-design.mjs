/**
 * Loads the Northwind design into the real Mero Design app (mocked node) and
 * screenshots the actual Fabric canvas — so what you see is the app's renderer,
 * not a mockup of it.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright'; // pnpm dlx playwright, or use the app's @playwright/test

const OUT = new URL('.', import.meta.url).pathname; // this directory
const elements = JSON.parse(readFileSync(`${OUT}/northwind-elements.json`, 'utf8'));
const BASE = process.env.BASE ?? 'http://localhost:5199';

const MEMBER = { id: 'test-identity', username: 'Fran', avatar: null, joinedAt: 1000 };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));

await page.addInitScript(() => {
  localStorage.setItem(
    'mero-tokens',
    JSON.stringify({
      access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LWlkZW50aXR5In0.sig',
      refresh_token: 'fake-refresh',
      expires_at: Date.now() + 3600000,
    }),
  );
  localStorage.setItem('mero:node_url', 'http://localhost:2430');
  localStorage.setItem('mero:application_id', 'app-1');
});

await page.route('**/auth/validate', (r) => r.fulfill({ status: 200 }));
await page.route('**/admin-api/identities**', (r) =>
  r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { identities: ['test-identity'] } }),
  }),
);
await page.route('**/admin-api/contexts**', (r) =>
  r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { contexts: [{ contextId: 'ctx-1', applicationId: 'app-1' }] } }),
  }),
);

const seen = new Set();
await page.route('**/jsonrpc', (route) => {
  const body = route.request().postDataJSON();
  const method = body?.params?.method ?? '';
  seen.add(method);
  let value;
  switch (method) {
    case 'get_elements': value = elements; break;
    case 'get_members': value = [MEMBER]; break;
    case 'get_comments': value = []; break;
    case 'get_cursors': value = []; break;
    case 'get_board':
      value = { name: 'Northwind Analytics', description: 'Dashboard design', elementCount: elements.length, memberCount: 1 };
      break;
    case 'my_role': value = 'owner'; break;
    case 'can_edit': value = true; break;
    case 'list_roles': value = [{ member: 'test-identity', role: 'owner' }]; break;
    default: value = null;
  }
  const bytes = Array.from(new TextEncoder().encode(JSON.stringify(value)));
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? 1, result: { output: bytes } }),
  });
});

await page.goto(`${BASE}/teams/team-1/projects/ctx-1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="fabric-canvas"]', { timeout: 20000 });
await page.waitForTimeout(3500);

const rendered = await page.evaluate(() => {
  const c = document.querySelector('[data-testid="fabric-canvas"]');
  const ctx = c.getContext('2d');
  const { width, height } = c;
  const d = ctx.getImageData(0, 0, width, height).data;
  const colors = new Set();
  let painted = 0;
  for (let i = 0; i < d.length; i += 28) {
    if (d[i + 3] > 0) {
      painted++;
      colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    }
  }
  return { canvas: `${width}x${height}`, distinctColors: colors.size, sampledPainted: painted };
});
console.log('renderer:', JSON.stringify(rendered));
console.log('rpc methods called:', [...seen].join(', '));

await page.screenshot({ path: `${OUT}/design-app.png` });

await page.mouse.move(700, 500);
for (let i = 0; i < 9; i++) await page.mouse.wheel(0, 120);
await page.waitForTimeout(800);
await page.locator('[data-testid="fabric-canvas"]').screenshot({ path: `${OUT}/design-canvas.png` });

console.log(errs.length ? `ERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : 'no page errors');
await browser.close();
