#!/usr/bin/env node
/**
 * Render the shared landing template into every app.
 *
 *   node scripts/landing/generate.mjs           # write
 *   node scripts/landing/generate.mjs --check   # verify, write nothing (CI)
 *
 * WHY A GENERATOR AND NOT A SHARED PACKAGE
 * Each app owning a real local file means it typechecks, tests and builds on its
 * own with no workspace indirection — which is what was asked for. The cost of
 * copying is that fourteen copies drift, and in a year no two are the same
 * again, which is the exact problem "one unified landing page" exists to solve.
 * So the copies are generated: the template is the single source, `--check`
 * fails CI the moment a copy diverges, and the only hand-owned files are each
 * app's `landing.config.ts` and its animation component.
 *
 * WHY THE COPY IS VERBATIM
 * There is no templating language here. `LandingPage.tsx`, `landing.css` and
 * `landingTypes.ts` are real TypeScript/CSS that import `./landing.config`, so
 * "rendering" is a byte-for-byte copy plus one generated config per app. That
 * makes the drift check a file comparison rather than a re-render, and it means
 * the template can be typechecked directly instead of only after substitution.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPS } from './apps.config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TEMPLATE = join(HERE, 'template');

/** Copied verbatim into every app. Anything here is NOT app-specific. */
const VERBATIM = ['LandingPage.tsx', 'landing.css', 'landingTypes.ts'];

/**
 * Verbatim too, but only into apps that can compile it.
 *
 * ⚠️ `mero-sign` has no `@calimero-network/mero-react` dependency at all — it
 * signs in through its own sidebar and takes the landing page's `onConnect`
 * prop. Writing this file there would be an unresolvable import and a broken
 * build, so the config simply carries no `loginPopup` for that app and the
 * template falls back to the callback.
 */
const NEEDS_MERO_REACT = 'loginPopup.tsx';

/**
 * ⚠️ `ownConnect` is as load-bearing as the dependency check.
 *
 * The popup calls `useMero()`, which THROWS outside a `MeroProvider`. Both
 * canvas games render this page from `mount.tsx` into a detached root with no
 * provider above it — so merely having the dependency is not enough, and wiring
 * it there took the entire landing page down with it: every one of the
 * twenty-one assertions failed, because the component never mounted.
 *
 * An `ownConnect` app has its own sign-in and passes `onConnect`, so it would
 * never have opened the popup anyway. Not importing it is both the fix and the
 * honest description.
 */
function wantsLoginPopup(app, entry) {
  return hasMeroReact(app) && !entry.ownConnect;
}

function hasMeroReact(app) {
  const pkg = join(ROOT, 'apps', app, 'app', 'package.json');
  if (!existsSync(pkg)) return false;
  const { dependencies = {} } = JSON.parse(readFileSync(pkg, 'utf8'));
  return Boolean(dependencies['@calimero-network/mero-react']);
}

const CHECK = process.argv.includes('--check');

/**
 * The app's own metadata table — the same one the registry publishes from, so
 * the landing page's title and description cannot drift from the listing.
 * Deliberately read here rather than duplicated into apps.config.mjs.
 */
function readCalimeroMeta(app) {
  const candidates = [];
  const logic = join(ROOT, 'apps', app, 'logic');
  const walk = (dir, depth = 0) => {
    if (depth > 3 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'target' || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'Cargo.toml') candidates.push(p);
    }
  };
  walk(logic);

  for (const f of candidates) {
    const src = readFileSync(f, 'utf8');
    const block = src.match(/^\[package\.metadata\.calimero\]\s*$([\s\S]*?)(?=^\[|\Z)/m);
    if (!block) continue;
    const body = block[1];
    const get = (k) => body.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
    const pkg = get('package');
    if (!pkg) continue;
    const name = get('name');
    const description = get('description');
    if (!name || !description) {
      throw new Error(`${app}: [package.metadata.calimero] is missing name or description (${f})`);
    }
    return { packageId: pkg, name, tagline: description };
  }
  throw new Error(`${app}: no [package.metadata.calimero] table with a package id found`);
}

/** The named mero-icons imports this app's features need, deduped and sorted. */
function iconImports(entry) {
  const names = [...new Set(entry.features.map((f) => f.icon))].sort();
  for (const n of names) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(n)) throw new Error(`bad icon name: ${n}`);
  }
  return names;
}

const q = (s) => JSON.stringify(s);

/**
 * One generated e2e spec per app, asserting the UNIFIED contract.
 *
 * Seven apps had a hand-written `landing.spec.ts` asserting their bespoke page —
 * different selectors, different copy, different counts, and between them no
 * agreement on what a landing page must do. Those are replaced by this, for the
 * same reason the page itself is generated: fourteen specs that drift are
 * fourteen specs that stop meaning anything.
 *
 * Needs no node and no auth. The landing page is the unauthenticated front
 * door, so a plain vite server is the whole harness.
 */
/**
 * Apps whose `/login` route this change deleted. The two canvas games and
 * `mero-sign` never had one, so asserting a redirect there would be asserting
 * a thing that was never true.
 */
const HAD_LOGIN_PAGE = new Set([
  'battleships', 'mero-calendar', 'mero-design', 'mero-drive', 'mero-forum',
  'mero-issue-tracker', 'mero-pass', 'mero-pixart', 'mero-sheets',
]);

function renderSpec(app, entry, meta) {
  meta = { ...meta, name: entry.displayName ?? meta.name };
  const desktopOnly = entry.availability === 'desktop';
  const badge = desktopOnly ? 'Desktop only' : entry.availability === 'web' ? 'Web only' : 'Web + Desktop';
  const docIds = entry.docs.map((d) => d.id);
  // Only the apps that HAD a `/login` route redirect one. The two canvas games
  // and `mero-sign` never had a login page to remove.
  const hadLoginPage = HAD_LOGIN_PAGE.has(app);
  // `ownConnect` apps hand the landing an `onConnect` callback and keep their
  // own sign-in — a sidebar for mero-sign, the launcher for the games — so the
  // shared popup is neither used nor expected there.
  const usesPopup = !desktopOnly && !entry.ownConnect;
  return `/**
 * Landing page contract for ${meta.name} — all three pages of it.
 *
 * GENERATED by \`pnpm landing:generate\`. Do not edit — \`pnpm landing:check\`
 * fails CI on drift. The assertions live in scripts/landing/generate.mjs.
 */
import { test, expect } from '@playwright/test';

const DOC_SECTIONS = ${JSON.stringify(docIds)};

test.describe('${meta.name} landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('hero names the app and its tagline', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: "${meta.name}" })).toBeVisible();
    await expect(page.locator('.cal-lp-lede')).toBeVisible();
  });

  test('shows the availability badge', async ({ page }) => {
    // Scoped to the badge row on purpose: the same words legitimately appear
    // again in the trust strip, and an unscoped getByText is a strict-mode
    // violation the moment an app says both.
    await expect(
      page.locator('.cal-lp-badge').filter({ hasText: "${badge}" }),
    ).toHaveCount(1);
  });

  test('the overview is the pitch, not the manual', async ({ page }) => {
    // Deliberately asserted without scrolling. A reveal that gates on an
    // IntersectionObserver renders these blank in a headless capture, which is
    // the bug this fleet hit twice.
    await expect(page.locator('#features')).toBeVisible();
    await expect(page.locator('.cal-lp-feature')).toHaveCount(${entry.features.length});
    // The explainer, the four steps and the FAQ moved to /docs. Finding them
    // here again would mean the split silently un-split.
    await expect(page.locator('#about')).toHaveCount(0);
    await expect(page.locator('#faq')).toHaveCount(0);
  });

  test('defaults to light, even when the OS asks for dark', async ({ page }) => {
    // The page is deliberately NOT prefers-color-scheme aware: a landing page
    // is the first thing a stranger sees, and the same page in a screenshot, a
    // review and a share card. Dark is reachable only by clicking the toggle.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    const root = page.locator('.cal-lp-root');
    await expect(root).toHaveAttribute('data-cal-lp-theme', 'light');
    // The attribute states the intent; this is what actually got painted. A
    // stray prefers-color-scheme rule anywhere in landing.css would pass the
    // line above and fail this one.
    await expect(root).toHaveCSS('background-color', 'rgb(252, 252, 252)');

    // ⚠️ And again on a REPEAT visit, which is a different code path and the
    // one that was actually broken. mero-calendar, mero-meet, mero-sheets and
    // mero-issue-tracker each seed their own ThemeProvider from
    // prefers-color-scheme and then WRITE that to localStorage in a mount
    // effect — so a one-shot check sees light (the effect has not run yet)
    // while every visit after it is dark.
    await page.reload();
    await expect(root).toHaveAttribute('data-cal-lp-theme', 'light');
    await expect(root).toHaveCSS('background-color', 'rgb(252, 252, 252)');
  });

  test('the theme toggle lives in the footer and flips both ways', async ({ page }) => {
    const toggle = page.getByTestId('theme-toggle');
    // In the footer, not the header. The header's job is to say what this is
    // and offer the way in; a colour preference is small print.
    await expect(page.locator('.cal-lp-footer').getByTestId('theme-toggle')).toHaveCount(1);
    await expect(page.locator('.cal-lp-header').getByTestId('theme-toggle')).toHaveCount(0);

    const root = page.locator('.cal-lp-root');
    await toggle.click();
    await expect(root).toHaveAttribute('data-cal-lp-theme', 'dark');
    await toggle.click();
    await expect(root).toHaveAttribute('data-cal-lp-theme', 'light');
  });

  // ── The three pages ─────────────────────────────────────────────────────
  test('the nav moves between the three pages, and the URL follows', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/\\/docs$/);
    await expect(page.locator('.cal-lp-root')).toHaveAttribute('data-cal-lp-view', 'docs');

    await page.getByRole('navigation').getByRole('link', { name: 'Preview' }).click();
    await expect(page).toHaveURL(/\\/preview$/);
    await expect(page.locator('.cal-lp-root')).toHaveAttribute('data-cal-lp-view', 'preview');

    // Real history, not just state: the back button has to work or these are
    // tabs wearing a URL.
    await page.goBack();
    await expect(page).toHaveURL(/\\/docs$/);
    await expect(page.locator('.cal-lp-root')).toHaveAttribute('data-cal-lp-view', 'docs');
  });

  test('/docs opens cold, as a shared link would', async ({ page }) => {
    // ⚠️ A COLD load, not a click. Clicking is client-side routing and proves
    // nothing about whether the app routes the path — an app whose catch-all
    // swallows /docs passes the nav test above and fails this one, which is
    // exactly what a shared link would hit.
    await page.goto('/docs');
    await expect(page.locator('.cal-lp-root')).toHaveAttribute('data-cal-lp-view', 'docs');
    await expect(page.getByRole('heading', { level: 2, name: 'What this is' })).toBeVisible();
    for (const id of DOC_SECTIONS) {
      await expect(page.locator(\`#\${id}\`)).toBeVisible();
    }
    await expect(page.locator('#how')).toBeVisible();
    await expect(page.locator('#faq')).toBeVisible();
    await expect(page.locator('.cal-lp-step')).toHaveCount(${4 + entry.docs.reduce((n, d) => n + (d.steps?.length ?? 0), 0)});
  });

  test('the docs page has a table of contents that points at real sections', async ({ page }) => {
    await page.goto('/docs');
    const links = page.locator('.cal-lp-toclink');
    await expect(links).toHaveCount(${docIds.length + 3});
    // Every entry must resolve to an element that exists — a TOC pointing at a
    // renamed section is worse than no TOC.
    const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    for (const href of hrefs) {
      await expect(page.locator(href)).toHaveCount(1);
    }
  });

  test('a FAQ answer opens', async ({ page }) => {
    await page.goto('/docs');
    const first = page.locator('.cal-lp-faqq').first();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.cal-lp-faqa').first()).toBeVisible();
  });

  test('/preview opens cold and captions every beat', async ({ page }) => {
    await page.goto('/preview');
    await expect(page.locator('.cal-lp-root')).toHaveAttribute('data-cal-lp-view', 'preview');
    await expect(page.locator('.cal-lp-stage--big')).toBeVisible();
    await expect(page.locator('.cal-lp-a').first()).toBeAttached();
    await expect(page.locator('.cal-lp-beat')).toHaveCount(${entry.previewSteps.length});
  });

${hadLoginPage ? `
  // ── No more /login ──────────────────────────────────────────────────────
  test('the login page is gone, and its path lands on the front door', async ({ page }) => {
    // This app had a /login route whose whole content was a button the visitor
    // had already pressed to get there. The path stays as a redirect so a
    // bookmark is not a blank route.
    await page.goto('/login');
    await expect(page).toHaveURL(/\\/$/);
    await expect(page.locator('.cal-lp-root')).toHaveAttribute('data-cal-lp-view', 'overview');
  });
` : ''}
${desktopOnly ? `
  test('a desktop-only app does not offer a node it cannot reach', async ({ page }) => {
    // Wait for the page to actually exist first — \`toHaveCount(0)\` passes
    // instantly against a blank document, which would make this vacuous.
    await expect(page.getByRole('heading', { level: 1, name: "${meta.name}" })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: /^Connect to node$/ })).toHaveCount(0);
  });
` : `
  test('connecting does not navigate to another page', async ({ page }) => {
    const cta = page.locator('button').filter({ hasText: /^Connect to node$/ }).first();
    await expect(cta).toBeVisible();
    // ⚠️ Compared against the URL we are ACTUALLY on, not against the root.
    // mero-stream and mero-meet redirect / to a picker route and render the
    // landing from a guard, so they sit at /streams or /rooms while showing
    // this page — and an assertion hard-coded to the root fails there for a
    // button that behaved perfectly.
    const before = page.url();
    await cta.click();
    // The whole point of the change: what used to be a route is now something
    // that happens over the page you were already reading. True whether that
    // is the shared popup, mero-sign's sidebar, or a game's launcher.
    await expect(page).toHaveURL(before);
  });
${usesPopup ? `
  test('and the landing page stays put underneath it', async ({ page }) => {
    await page.locator('button').filter({ hasText: /^Connect to node\$/ }).first().click();
    await expect(page.locator('.cal-lp-root')).toHaveAttribute('data-cal-lp-view', 'overview');
  });
` : ''}
`}
  test('offers the desktop download', async ({ page }) => {
    await expect(
      page.locator('a[href="https://calimero.network/download"]').first(),
    ).toBeVisible();
  });

  // ── Mobile ──────────────────────────────────────────────────────────────
  // 320px is the narrowest phone still in use and 390 is the common one. Both,
  // because the header and the hero art break at different widths. Every view,
  // because they are three different layouts.
  for (const width of [390, 320]) {
    for (const path of ['/', '/docs', '/preview']) {
      test(\`\${path} does not scroll sideways on a \${width}px phone\`, async ({ page }) => {
        await page.setViewportSize({ width, height: 780 });
        await page.goto(path);
        await expect(page.locator('.cal-lp-root')).toBeVisible();
        // Measured on the landing root as well as the document.
        //
        // ⚠️ The document alone is VACUOUS for the two canvas games: their
        // mount.tsx renders this page into a fixed, inset-0, overflow-y-auto
        // host, so nothing it contains can ever move
        // documentElement.scrollWidth and the assertion passes without looking.
        const overflow = await page.evaluate(() => {
          const root = document.querySelector('.cal-lp-root');
          const doc = document.documentElement;
          return Math.max(
            doc.scrollWidth - doc.clientWidth,
            root ? root.scrollWidth - root.clientWidth : 0,
            root?.parentElement
              ? root.parentElement.scrollWidth - root.parentElement.clientWidth
              : 0,
          );
        });
        expect(overflow).toBeLessThanOrEqual(1);
      });
    }
  }

  test('the brand never wraps under its own icon on a phone', async ({ page }) => {
    // \`Mero Issue Tracker\` used to wrap under the mark and double the sticky
    // header's height. The header itself is taller on a phone now — the nav
    // wraps onto its own row rather than disappearing, because it is the only
    // way to reach two of the three pages — so this measures the brand, which
    // is the thing that actually broke.
    await page.setViewportSize({ width: 360, height: 780 });
    const brand = page.locator('.cal-lp-brand');
    await expect(brand).toBeVisible();
    const box = await brand.boundingBox();
    expect(box?.height ?? 0).toBeLessThanOrEqual(34);
  });

  test('the nav survives a phone, rather than being hidden', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Docs' })).toBeVisible();
  });

  test('the hero art is drawn to fit its frame on a phone', async ({ page }) => {
    // The animations position their parts in literal pixels against a 495px
    // stage, so an unscaled box writes its rows over each other inside a 328px
    // phone frame. useStageScale() is what stops that, and it is invisible in
    // a screenshot review until you measure it.
    await page.setViewportSize({ width: 360, height: 780 });
    const body = page.locator('.cal-lp-stagebody');
    await expect(body).toBeVisible();
    const art = page.locator('.cal-lp-a').first();
    await expect(art).toBeAttached();
    const [bodyBox, artBox] = await Promise.all([body.boundingBox(), art.boundingBox()]);
    // Rendered width, after the scale — within a pixel of the frame it sits in.
    expect(Math.abs((artBox?.width ?? 0) - (bodyBox?.width ?? 0))).toBeLessThanOrEqual(1.5);
  });
});
`;
}

function renderConfig(app, entry, meta) {
  // Presentation-only override. The registry metadata stays exactly as
  // published — this changes the heading on the web page and nothing else.
  meta = { ...meta, name: entry.displayName ?? meta.name };
  const icons = iconImports(entry);
  const lines = [];

  lines.push('/**');
  lines.push(` * Landing content for ${meta.name}.`);
  lines.push(' *');
  lines.push(' * GENERATED by `pnpm landing:generate` from scripts/landing/apps.config.mjs');
  lines.push(' * plus this app\'s [package.metadata.calimero] table. Do not edit by hand —');
  lines.push(' * `pnpm landing:check` fails CI on drift. Change the copy in apps.config.mjs.');
  lines.push(' *');
  lines.push(' * `name`, `packageId` and `tagline` come from the Cargo metadata the registry');
  lines.push(' * publishes from, so this page and the registry listing cannot diverge.');
  lines.push(' */');
  lines.push(`import { ${icons.join(', ')} } from '@calimero-network/mero-icons';`);
  lines.push('');
  // An app's animation is hand-owned: the ONE piece that should differ per app,
  // and the one this generator must never overwrite. Wired in only if present.
  const hasAnimation = existsSync(
    join(ROOT, 'apps', app, 'app', 'src', 'pages', 'landing', 'animation.tsx'),
  );
  if (hasAnimation) lines.push("import Animation from './animation';");
  const wantsPopup = wantsLoginPopup(app, entry);
  if (wantsPopup) lines.push("import LoginPopup from './loginPopup';");
  lines.push("import type { LandingConfig } from './landingTypes';");
  lines.push('');
  lines.push('export const CONFIG: LandingConfig = {');
  lines.push(`  name: ${q(meta.name)},`);
  lines.push(`  packageId: ${q(meta.packageId)},`);
  lines.push(`  tagline: ${q(meta.tagline)},`);
  lines.push(`  dir: ${q(app)},`);
  lines.push(`  markSrc: ${q(entry.markSrc ?? '/favicon.svg')},`);
  lines.push(`  iconSrc: '/icon-512.png',`);
  lines.push(`  availability: ${q(entry.availability)},`);
  if (entry.themeStorageKey) lines.push(`  themeStorageKey: ${q(entry.themeStorageKey)},`);
  if (entry.experimental) lines.push('  experimental: true,');
  if (entry.playableOffline) lines.push('  playableOffline: true,');
  lines.push(`  trust: [${entry.trust.map(q).join(', ')}],`);
  lines.push('  explainer: [');
  for (const p of entry.explainer) lines.push(`    ${q(p)},`);
  lines.push('  ],');
  lines.push('  features: [');
  for (const f of entry.features) {
    lines.push('    {');
    lines.push(`      icon: ${f.icon},`);
    lines.push(`      title: ${q(f.title)},`);
    lines.push(`      body: ${q(f.body)},`);
    lines.push('    },');
  }
  lines.push('  ],');
  if (entry.faq?.length) {
    lines.push('  faq: [');
    for (const f of entry.faq) {
      lines.push('    {');
      lines.push(`      q: ${q(f.q)},`);
      lines.push(`      a: ${q(f.a)},`);
      lines.push('    },');
    }
    lines.push('  ],');
  }
  if (hasAnimation) lines.push('  animation: Animation,');

  lines.push('  docs: [');
  for (const d of entry.docs) {
    lines.push('    {');
    lines.push(`      id: ${q(d.id)},`);
    lines.push(`      heading: ${q(d.heading)},`);
    if (d.paragraphs?.length) {
      lines.push('      paragraphs: [');
      for (const x of d.paragraphs) lines.push(`        ${q(x)},`);
      lines.push('      ],');
    }
    if (d.concepts?.length) {
      lines.push('      concepts: [');
      for (const c of d.concepts) lines.push(`        { term: ${q(c.term)}, def: ${q(c.def)} },`);
      lines.push('      ],');
    }
    if (d.steps?.length) {
      lines.push('      steps: [');
      for (const st of d.steps) lines.push(`        { title: ${q(st.title)}, body: ${q(st.body)} },`);
      lines.push('      ],');
    }
    if (d.bullets?.length) {
      lines.push('      bullets: [');
      for (const x of d.bullets) lines.push(`        ${q(x)},`);
      lines.push('      ],');
    }
    lines.push('    },');
  }
  lines.push('  ],');

  lines.push('  previewSteps: [');
  for (const st of entry.previewSteps) {
    lines.push(`    { title: ${q(st.title)}, body: ${q(st.body)} },`);
  }
  lines.push('  ],');

  if (wantsPopup) lines.push('  loginPopup: LoginPopup,');
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

const templateFiles = Object.fromEntries(
  VERBATIM.map((f) => [f, readFileSync(join(TEMPLATE, f), 'utf8')]),
);

let wrote = 0;
const drift = [];

for (const [app, entry] of Object.entries(APPS)) {
  const outDir = join(ROOT, 'apps', app, 'app', 'src', 'pages', 'landing');
  const meta = readCalimeroMeta(app);
  const files = { ...templateFiles, 'landing.config.ts': renderConfig(app, entry, meta) };
  if (wantsLoginPopup(app, entry)) {
    files[NEEDS_MERO_REACT] = readFileSync(join(TEMPLATE, NEEDS_MERO_REACT), 'utf8');
  } else {
    // Pruned, not merely skipped. This generator only ever wrote files, so an
    // app that STOPS wanting one kept a stale copy that nothing imported and
    // `landing:check` never looked at — dead code that reads as live.
    const stale = join(outDir, NEEDS_MERO_REACT);
    if (existsSync(stale)) {
      if (CHECK) drift.push(`  apps/${app}/app/… ${NEEDS_MERO_REACT}  (should not exist)`);
      else { unlinkSync(stale); wrote += 1; }
    }
  }

  // ALWAYS `marketing-landing.spec.ts`, never `landing.spec.ts`. Half the fleet
  // already owned a hand-written `e2e/landing.spec.ts` — covering route guards
  // and redirects, which this page's spec says nothing about — and generating
  // over that name silently deleted them.
  const SPEC_NAME = 'marketing-landing.spec.ts';
  const specDest = join(ROOT, 'apps', app, 'app', entry.e2eDir, SPEC_NAME);
  const targets = Object.entries(files).map(([n, c]) => [join(outDir, n), c, n]);
  targets.push([specDest, renderSpec(app, entry, meta), `${entry.e2eDir}/${SPEC_NAME}`]);

  for (const [dest, content, name] of targets) {
    const current = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
    if (current === content) continue;
    if (CHECK) {
      drift.push(`  apps/${app}/app/… ${name}` + (current === null ? '  (missing)' : ''));
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    wrote += 1;
  }
}

if (CHECK) {
  if (drift.length) {
    console.error('landing: generated files are out of date or missing:\n' + drift.join('\n'));
    console.error('\nRun `pnpm landing:generate` and commit the result.');
    process.exit(1);
  }
  console.log(`landing: all ${Object.keys(APPS).length} apps match the template.`);
} else {
  console.log(
    wrote === 0
      ? `landing: already up to date (${Object.keys(APPS).length} apps).`
      : `landing: wrote ${wrote} file(s) across ${Object.keys(APPS).length} apps.`,
  );
}
