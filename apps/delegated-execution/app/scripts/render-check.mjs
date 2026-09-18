/**
 * Load the page in a real browser against the stored states people actually
 * have, and fail on a blank screen.
 *
 * ## Why this exists
 *
 * `tsc -b`, `vitest run` and `npm run build` were all green while the deployed
 * page was a black screen. None of them renders the component, and the throw
 * needed `localStorage` to reach: the status strip called
 * `new URL(settings.nodeUrl).host` inline, `URL` rejects anything without a
 * scheme, and that value is typed by hand into a field that has never validated
 * it. A stored `relay.example` therefore threw during render — which in React
 * takes the whole page, not the one label — and because the bad value is the
 * persisted one, every reload reproduced it.
 *
 * A unit test now covers `hostOf`. This covers the thing the unit test cannot:
 * that the component actually mounts against a hostile blob.
 *
 * ## Running it
 *
 *     npm run build
 *     npx vite preview --port 4174 &
 *     npm i --no-save playwright
 *     node scripts/render-check.mjs
 *
 * In a sandbox where Playwright's download is pinned, point it at the
 * preinstalled browser:
 *
 *     PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/render-check.mjs
 *
 * Playwright is deliberately not a dependency in `package.json` — this is a
 * frontend-only demo and a browser download has no business in its install.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4174';
const DEFAULTS = {
  cloudUrl: 'https://manager.cloud.calimero.network', portalUrl: 'https://cloud.calimero.network',
  namespaceId: '', invitationJson: '', nodeKey: '', contextId: '',
  nodeUrl: '', relayUrl: '', admitUrl: '',
};
const ID = {
  accountId: 'aa'.repeat(32), deviceId: 'bb'.repeat(32),
  devicePublicKey: 'cc'.repeat(32), deviceSecret: 'dd'.repeat(32),
  credential: 'ee'.repeat(64), rootSecret: 'ff'.repeat(32),
};
const CLAIM = {
  accountId: 'aa'.repeat(32), cloudUrl: 'https://manager.example',
  provenAt: Date.now(), linked: true, sessionToken: 'tok', email: 'a@b.c',
};

// Every key the app reads at mount, and the values that have actually been
// stored by earlier versions or by hand. `settings` alone was not enough: the
// blank screen was in the strip, and the strip reads all four.
const cases = [
  ['fresh tab', {}],
  ['bare host', { settings: { nodeUrl: 'relay.example' } }],
  ['whitespace', { settings: { nodeUrl: ' ' } }],
  ['no scheme', { settings: { nodeUrl: 'localhost:2428' } }],
  ['typo scheme', { settings: { nodeUrl: 'htp:/relay.example' } }],
  ['valid url', { settings: { nodeUrl: 'https://relay.example' } }],
  ['populated', { settings: { nodeUrl: 'relay.example', nodeKey: 'ab'.repeat(32), contextId: 'cd'.repeat(32), namespaceId: 'ff'.repeat(32), invitationJson: '{"invitation":{"group_id":"' + 'ab'.repeat(32) + '","admitters":["aa"]}}' } }],
  ['garbage settings', { settings: 'RAW' }],
  ['identity held', { identity: ID }],
  ['identity + bad url', { identity: ID, settings: { nodeUrl: 'relay.example' } }],
  ['claim linked', { identity: ID, claim: CLAIM }],
  ['claim unlinked', { identity: ID, claim: { ...CLAIM, linked: false, sessionToken: '', email: undefined } }],
  ['claim half-written', { identity: ID, claim: { accountId: 'aa'.repeat(32), cloudUrl: 'https://x.example' } }],
  ['garbage identity', { identity: 'RAW' }],
  ['garbage claim', { claim: 'RAW' }],
  ['pending link', { identity: ID, pendingLink: { cloudUrl: 'https://manager.example', accountId: 'aa'.repeat(32) } }],
  ['everything at once', { identity: ID, claim: CLAIM, settings: { nodeUrl: 'relay.example', relayUrl: ' ', nodeKey: 'zz', contextId: 'x' }, pendingLink: { cloudUrl: 'https://m.example', accountId: 'aa'.repeat(32) } }],
];
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
let bad = 0;
for (const [name, patch] of cases) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((p) => {
    const KEYS = {
      identity: 'calimero.delegated-demo.identity',
      settings: 'calimero.delegated-demo.settings',
      claim: 'calimero.delegated-demo.account-claim',
      pendingLink: 'calimero.delegated-demo.pending-link',
    };
    for (const [name, key] of Object.entries(KEYS)) {
      const value = p[name];
      if (value === undefined) continue;
      // 'RAW' seeds a blob that is not JSON at all, which is what a value
      // written by an older shape (or a truncated write) looks like.
      localStorage.setItem(key, value === 'RAW' ? '{not json' : JSON.stringify(value));
    }
  }, { ...patch, settings: patch.settings === 'RAW' ? 'RAW' : patch.settings ? { ...DEFAULTS, ...patch.settings } : undefined });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const len = (await page.locator('body').innerText()).length;
  const ok = len > 1000 && errs.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok   ' : 'BLANK'}  ${name.padEnd(14)} chars=${String(len).padEnd(6)} ${errs[0] || ''}`);
  await page.close();
}
await browser.close();
console.log(bad === 0 ? '\nALL RENDER' : `\n${bad} BROKEN`);
process.exit(bad === 0 ? 0 : 1);
