import { Page, test } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildAuthHash, extractInvitation } from './isolation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(__dirname, '..', '.playwright-data', 'pw-state.json');

// App-agnostic post-auth route — read from studio.config.json so this
// infra file is identical across the foundation and every generated app
// (no per-app patching). Foundation chat → "/chat".
function appRoute(): string {
  try {
    const cfgPath = path.resolve(__dirname, '..', '..', 'studio.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    return cfg?.metadata?.route || '/';
  } catch {
    return '/';
  }
}

// Wire name of the app's primary service (matches PRIMARY_SERVICE in the app);
// needed to mint a context via the admin-api the way useWorkspace.bootstrap does.
function primaryServiceName(): string {
  const cfgPath = path.resolve(__dirname, '..', '..', 'studio.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  const name = cfg?.services?.[0]?.name;
  if (!name) throw new Error('studio.config.json has no services[0].name');
  return name;
}

interface NodeState {
  name: string;
  adminUrl: string;
  appId: string;
  accessToken: string;
  refreshToken: string;
}

interface SetupState {
  pids: number[];
  nodes: NodeState[];
}

function loadState(): SetupState {
  if (!existsSync(STATE_FILE)) {
    throw new Error('No setup state found. Did global-setup run?');
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

/** Get node state by index (0 = node 1, 1 = node 2). */
export function getNode(index: number): NodeState {
  const state = loadState();
  if (index >= state.nodes.length) {
    throw new Error(`Node ${index} not found. Only ${state.nodes.length} nodes available.`);
  }
  return state.nodes[index];
}

// ── Per-spec workspace isolation ───────────────────────────────────────
//
// The app is single-context: without isolation every test/retry/spec-file
// shares ONE persistent board (the app binds namespaces[0] + its first
// context), so state bleeds across tests and the run is pinned to workers:1.
//
// With isolation ON (default; PW_ISOLATION=0 to opt out) each spec FILE gets
// its own namespace + context, provisioned straight through the node admin-api
// (mirrors useWorkspace.bootstrap) and injected into the auth hash so the app
// binds to it (parseAuthCallback reads context_id/context_identity; useWorkspace
// prefers the callback context over discovery). Peers on other nodes are joined
// into the SAME context via the admin-api and get the same context_id with their
// own owned identity, so an isolated board is deterministic across nodes,
// which is what makes workers > 1 safe.

interface Injection { contextId: string; contextIdentity: string; }
interface IsoWorkspace {
  nsId: string;
  contextId: string;
  /** nodeIndex → that node's injection (identity differs per node). */
  joined: Map<number, Promise<Injection>>;
}

const ISOLATION = process.env.PW_ISOLATION !== '0';
// Memoized per spec file (keyed with the worker slot; each worker is its own
// process so the map is already per-worker, the key just separates files a
// worker runs in sequence). A fresh workspace per file, reused across a file's
// tests + retries.
const WORKSPACES = new Map<string, Promise<IsoWorkspace>>();

function specKey(): string {
  try {
    const info = test.info();
    return `${info.parallelIndex}:${info.file}`;
  } catch {
    return 'default';
  }
}

async function adminApi(
  node: NodeState,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<any> {
  const res = await fetch(`${node.adminUrl}${apiPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${node.accessToken}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`admin-api ${method} ${apiPath} → ${res.status}: ${text.slice(0, 300)}`);
  }
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return json?.data ?? json;
}

// Provision the base workspace (namespace + context) on node 0.
async function provisionBase(): Promise<IsoWorkspace> {
  const node0 = getNode(0);
  const ns = await adminApi(node0, 'POST', '/admin-api/namespaces', {
    applicationId: node0.appId,
    upgradePolicy: 'Automatic',
  });
  await adminApi(
    node0,
    'PUT',
    `/admin-api/groups/${ns.namespaceId}/settings/default-capabilities`,
    { defaultCapabilities: 3 }, // CAN_CREATE_CONTEXT | CAN_INVITE_MEMBERS
  );
  const ctx = await adminApi(node0, 'POST', '/admin-api/contexts', {
    applicationId: node0.appId,
    groupId: ns.namespaceId,
    serviceName: primaryServiceName(),
    initializationParams: [],
  });
  const ws: IsoWorkspace = {
    nsId: ns.namespaceId,
    contextId: ctx.contextId,
    joined: new Map(),
  };
  ws.joined.set(0, Promise.resolve({ contextId: ctx.contextId, contextIdentity: ctx.memberPublicKey }));
  return ws;
}

// Join a non-0 node into the workspace and return its injection. The context id
// is global, so the joiner lands on the SAME context with its own identity.
async function joinNodeIntoWorkspace(ws: IsoWorkspace, nodeIndex: number): Promise<Injection> {
  const node0 = getNode(0);
  const node = getNode(nodeIndex);
  const inv = await adminApi(node0, 'POST', `/admin-api/namespaces/${ws.nsId}/invite`, {
    recursive: true,
  });
  const invitation = extractInvitation(inv);
  const joinRes = await adminApi(node, 'POST', `/admin-api/namespaces/${ws.nsId}/join`, {
    invitation,
  });
  // Wait until the joined context + owned identity are live on this node, so
  // the injected identity is usable the moment the page boots. A silent
  // timeout here would inject an identity that isn't actually live yet,
  // turning into a bare "element not found" downstream instead of a clear
  // cause — so an exhausted poll must throw, not fall through.
  let identityLive = false;
  for (let i = 0; i < 30; i++) {
    const owned = await adminApi(node, 'GET', `/admin-api/contexts/${ws.contextId}/identities-owned`)
      .catch(() => null);
    if (owned?.identities?.length > 0) { identityLive = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!identityLive) {
    throw new Error(`identity for context ${ws.contextId} never became owned on node ${nodeIndex} after 15s`);
  }
  return { contextId: ws.contextId, contextIdentity: joinRes.memberIdentity };
}

// Resolve (provisioning/joining as needed) the injection for a node in this
// spec file's isolated workspace. Memoized per spec file and per node.
async function isolatedInjection(nodeIndex: number): Promise<Injection> {
  const key = specKey();
  let wsP = WORKSPACES.get(key);
  if (!wsP) {
    wsP = provisionBase();
    WORKSPACES.set(key, wsP);
  }
  const ws = await wsP;
  let injP = ws.joined.get(nodeIndex);
  if (!injP) {
    injP = joinNodeIntoWorkspace(ws, nodeIndex);
    ws.joined.set(nodeIndex, injP);
  }
  return injP;
}

// Persistent per-page tally of data-plane + console errors the browser
// otherwise swallows. Two layers matter and neither surfaces as a Playwright
// error on its own:
//   - admin-api (management: `POST /admin-api/namespaces` → 403) — a
//     node-permission / token-scope mismatch, NOT an app-code bug.
//   - /jsonrpc (app method calls via mero-js `rpc.execute`) — a mutation or
//     view that fails server-side (HTTP >= 400, or a JSON-RPC error body on a
//     2xx). The app just renders nothing, so downstream the test sees a bare
//     "element not found" with no hint the backend method actually failed.
//   - console.error — runtime errors logged by the app.
// We record these for the whole test and (a) emit greppable `[admin-api-error]`
// / `[rpc-error]` markers into the captured output and (b) fold them into the
// workspace/invite helper failure messages, so the verify classifier can route
// each cause correctly (admin-api → infrastructural, rpc → backend) instead of
// flailing the verifier-writer on correct test code.
interface PageErrors {
  adminApi: string[];
  rpc: string[];
  console: string[];
}
const PAGE_ERRORS = new WeakMap<Page, PageErrors>();
const CONSOLE_ERROR_CAP = 10;

async function recordResponse(r: any, rec: PageErrors) {
  try {
    const url = r.url();
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const status = r.status();
    // admin-api marker — wire string kept EXACTLY (worker lift + classifier
    // tests depend on it).
    if (status >= 400 && /\/admin-api\//.test(url)) {
      const line = `${status} ${r.request().method()} ${path}`;
      rec.adminApi.push(line);
      console.error(`[admin-api-error] ${line}`);
      return;
    }
    if (!/\/jsonrpc/.test(url)) return;
    // jsonrpc transport error.
    if (status >= 400) {
      const line = `HTTP ${status} ${r.request().method()} ${path}`;
      rec.rpc.push(line);
      console.error(`[rpc-error] ${line}`);
      return;
    }
    // jsonrpc 2xx carrying a JSON-RPC-level error. mero-js posts
    // `{ method:'execute', params:{ method:'<appMethod>', ... } }` and the node
    // replies `{ result }` on success or `{ error }` (some builds nest it under
    // `result.error`). Read defensively — the body may be unavailable.
    let body: any;
    try { body = await r.json(); } catch { return; }
    const rpcErr = body?.error ?? body?.result?.error;
    if (!rpcErr) return;
    let method = '';
    try {
      const parsed = JSON.parse(r.request().postData() || '');
      method = parsed?.params?.method || parsed?.method || '';
    } catch { /* method unknown */ }
    const emsg = String(rpcErr?.message ?? rpcErr?.data ?? rpcErr).slice(0, 200);
    const line = `${method || 'rpc'} ${emsg}`.trim();
    rec.rpc.push(line);
    console.error(`[rpc-error] ${line}`);
  } catch { /* response discarded */ }
}

/** Start recording admin-api / jsonrpc / console errors on a page. Idempotent. */
export function logAdminApiErrors(page: Page) {
  if (PAGE_ERRORS.has(page)) return;
  const rec: PageErrors = { adminApi: [], rpc: [], console: [] };
  PAGE_ERRORS.set(page, rec);
  page.on('response', (r) => { void recordResponse(r, rec); });
  page.on('console', (m) => {
    try {
      if (m.type() !== 'error') return;
      rec.console.push(String(m.text()).slice(0, 200));
      if (rec.console.length > CONSOLE_ERROR_CAP) rec.console.shift();
    } catch { /* discard */ }
  });
}

/** One-line suffix of recorded errors for a failure message, or '' if none. */
function recordedErrorsTail(page: Page): string {
  const rec = PAGE_ERRORS.get(page);
  if (!rec) return '';
  const parts: string[] = [];
  if (rec.adminApi.length) parts.push(`[admin-api-error] ${rec.adminApi.slice(-3).join('; ')}`);
  if (rec.rpc.length) parts.push(`[rpc-error] ${rec.rpc.slice(-3).join('; ')}`);
  if (rec.console.length) parts.push(`[console-error] ${rec.console.slice(-3).join('; ')}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Collision-safe display name for an entity a test creates. The board persists
 * across ALL tests and retries in a run (single shared context), so every
 * entity a spec creates MUST be named with uniqueName and asserted against that
 * exact string (or a resolved data-testid) — never a bare hardcoded label, or a
 * strict-mode locator resolves to the duplicates earlier tests/retries left.
 */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface NewIssueFields {
  title: string;
  summary?: string;
  impact?: string;
  repro?: string;
  resolutionCriteria?: string;
  priority?: string;
  labels?: string;
}

/**
 * Open the New-issue modal, fill the title plus the four required sections
 * (summary/impact/repro/resolution criteria - all four are mandatory to
 * submit), and create it. Unspecified sections get a unique placeholder so
 * callers that don't care about their content don't have to fill them.
 */
export async function createIssue(page: Page, fields: NewIssueFields): Promise<void> {
  await page.getByTestId('open-new-issue-btn').click();
  await page.getByTestId('field-title').fill(fields.title);
  await page.getByTestId('field-description').fill(fields.summary ?? uniqueName('summary'));
  await page.getByTestId('field-impact').fill(fields.impact ?? uniqueName('impact'));
  await page.getByTestId('field-repro').fill(fields.repro ?? uniqueName('repro'));
  await page.getByTestId('field-resolution_criteria').fill(fields.resolutionCriteria ?? uniqueName('resolution'));
  if (fields.priority) await page.getByTestId('field-priority').selectOption(fields.priority);
  if (fields.labels) await page.getByTestId('field-labels').fill(fields.labels);
  await page.getByTestId('action-create_issue').click();
}

/**
 * Navigate to the app with auth tokens in the URL hash for a specific node.
 * MeroProvider's parseAuthCallback picks these up automatically.
 *
 * On timeout, the error carries the browser's console errors and every
 * failed/4xx-5xx network call made during the handshake — the redirect is
 * gated on the app validating the session against the node, so a bare
 * waitForURL timeout says nothing about WHY (CORS, 401/403, unreachable).
 */
export async function loginViaHash(page: Page, nodeIndex = 0, opts: { inject?: boolean } = {}) {
  logAdminApiErrors(page);
  const node = getNode(nodeIndex);
  // `inject: false` skips the SSO context injection so the app lands on the
  // explicit onboarding (empty state) instead of a pre-provisioned repo.
  const inject = opts.inject !== false;
  const injection = ISOLATION && inject ? await isolatedInjection(nodeIndex) : null;
  const hash = buildAuthHash(
    {
      accessToken: node.accessToken,
      refreshToken: node.refreshToken,
      nodeUrl: node.adminUrl,
      appId: node.appId,
    },
    injection,
  );

  const diag: string[] = [];
  const onConsole = (m: any) => {
    if (m.type() === 'error') diag.push(`console.error: ${String(m.text()).slice(0, 300)}`);
  };
  const onRequestFailed = (r: any) =>
    diag.push(`request failed: ${r.method()} ${r.url()} — ${r.failure()?.errorText || 'unknown'}`);
  const onResponse = (r: any) => {
    if (r.status() >= 400) diag.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
  };
  page.on('console', onConsole);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  try {
    await page.goto(`/#${hash}`);
    await page.waitForURL(`**${appRoute()}`, { timeout: 30_000 });
  } catch (e) {
    const tail = diag.slice(-12).join('\n  ');
    throw new Error(
      `login handshake never reached ${appRoute()} (node ${node.adminUrl}).\n` +
      `  ${tail || 'no console/network errors captured during the wait'}\n` +
      `${(e as Error).message}`,
    );
  } finally {
    page.off('console', onConsole);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
  }
}

// ── Shared workspace / invite-join flow ────────────────────────────────
//
// Every generated app inherits the foundation's create-or-join workspace
// model (AppPage) + the Invite/Join modals. The multi-node collaboration
// story tests all need the SAME two moves: bootstrap a workspace on one node,
// then invite→join a second node. The LLM used to hand-roll this per spec
// file and got it subtly wrong every time — guessed button labels that don't
// exist, no ready-signal, no already-joined handling — which was the dominant
// source of verify flakiness (the "Join with invitation" 15s timeouts).
//
// These helpers encode the flow ONCE against stable data-testids the
// foundation ships (create-workspace-btn / open-invite-btn / open-join-btn /
// generate-invite-btn / invite-code-output / join-code-input /
// join-submit-btn / workspace-ready), with an accessible-name fallback so
// they still work on apps built before the testids existed. Story tests
// should import these instead of re-deriving the flow:
//
//   import { loginViaHash, createWorkspace, inviteAndJoin } from './helpers';

const READY = '[data-testid="workspace-ready"], [data-testid="open-invite-btn"]';

/**
 * The Members view opens a one-shot "set your alias" modal the first time an
 * identity with no alias lands on it. Its overlay covers the page, so any
 * click on the Members view (e.g. Invite) must wait it out and dismiss it.
 * A no-op when the modal never appears (the identity already has an alias).
 */
async function dismissAliasNudge(page: Page) {
  const input = page.getByTestId('alias-input');
  // waitFor actually blocks for the modal to render (isVisible is an immediate
  // check that would race the on-mount nudge and miss it, leaving its overlay
  // to intercept the next click).
  try {
    await input.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    return; // no nudge (the identity already has a name)
  }
  await page.keyboard.press('Escape');
  await input.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}

/** testid-or-text union locator (first match; tolerant of legacy apps). */
function ctl(page: Page, testid: string, text: string) {
  return page.locator(`[data-testid="${testid}"], button:has-text("${text}")`).first();
}

/**
 * Wait until the app has a live workspace (the item view is mounted). Keys on
 * the `workspace-ready` marker, falling back to the bar's Invite button which
 * only renders once a workspace exists.
 */
export async function waitForWorkspaceReady(page: Page, timeout = 45_000) {
  try {
    await page.locator(READY).first().waitFor({ state: 'visible', timeout });
  } catch (e) {
    // createWorkspace → POST /admin-api/namespaces failing (node/token scope)
    // is the classic cause of "workspace never appears" — name it on line 1.
    throw new Error(`workspace never became ready.${recordedErrorsTail(page)}\n${(e as Error).message}`);
  }
}

/**
 * The blocking alias gate opens on entering a namespace where the current
 * member has no display name. Its overlay covers the workspace, so tests that
 * only want the board must skip past it. A no-op when the gate never appears.
 */
export async function skipAliasGate(page: Page, timeout = 15_000) {
  const gate = page.getByTestId('alias-gate');
  // The gate is gated on the namespace member list loading (a couple of async
  // admin calls after workspace-ready), so it can appear a beat late. Use
  // waitFor (which actually blocks) rather than isVisible (an immediate check
  // that would race the load and miss a gate about to appear).
  try {
    await gate.waitFor({ state: 'visible', timeout });
  } catch {
    return; // gate never appeared (the member already has a name)
  }
  await page.getByTestId('alias-gate-skip').click();
  await gate.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}

/**
 * Drive the explicit onboarding from the namespace empty state: create a
 * namespace, skip the alias gate, and add a repo (so the board becomes ready).
 * Used by createWorkspace as the non-isolated fallback and available to specs.
 */
export async function driveOnboarding(page: Page) {
  await ctl(page, 'ns-create-btn', 'Create workspace').click();
  await page.getByTestId('ns-create-name').fill(uniqueName('workspace'));
  await page.getByTestId('ns-create-submit').click();
  await skipAliasGate(page);
  await page.getByTestId('repo-add-btn').click();
  await page.getByTestId('repo-add-name').fill(uniqueName('repo'));
  await page.getByTestId('repo-add-url').fill(`https://github.com/acme/${Date.now().toString(36)}`);
  await page.getByTestId('repo-add-submit').click();
}

/**
 * Ensure `page` is inside a ready workspace (a repo is selected). Isolated runs
 * land there directly via the injected SSO context; a non-isolated fresh session
 * drives the onboarding. Then skips the alias gate so the board is interactive.
 * Idempotent. Caller must have logged the page in first (loginViaHash).
 */
export async function createWorkspace(page: Page) {
  const ready = page.locator(READY).first();
  const emptyState = page.getByTestId('ns-empty-state');
  await Promise.race([
    ready.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
    emptyState.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
  ]);
  if (await emptyState.isVisible().catch(() => false)) {
    await driveOnboarding(page);
  }
  await waitForWorkspaceReady(page);
  await skipAliasGate(page);
}

/**
 * Full invite→join across two authenticated pages: bootstrap the inviter's
 * workspace, mint an invite code, and join it from `joinerPage`. Returns the
 * invite code. Deterministic (polls for the generated code + the joiner's
 * ready signal) and tolerant of a joiner that already converged onto the
 * namespace (mDNS auto-discovery) — in that case the join is a no-op.
 */
export async function inviteAndJoin(inviterPage: Page, joinerPage: Page): Promise<string> {
  await createWorkspace(inviterPage);

  // open-invite-btn now lives on the Members view, not the shell - route there first.
  await inviterPage.getByTestId('nav-members').click();
  // First visit to Members auto-opens the "set your alias" nudge, whose
  // full-screen overlay covers the Invite button; dismiss it before clicking.
  await dismissAliasNudge(inviterPage);

  // Inviter: open Invite, generate, read the code out of the readonly field.
  await ctl(inviterPage, 'open-invite-btn', 'Invite').click();
  await ctl(inviterPage, 'generate-invite-btn', 'Generate invite').click();
  const codeField = inviterPage
    .locator('[data-testid="invite-code-output"], textarea[readonly]')
    .first();
  await codeField.waitFor({ state: 'visible', timeout: 30_000 });
  // Poll until the async invitation call has populated the field.
  let code = '';
  try {
    await inviterPage.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel) as HTMLTextAreaElement | null;
        return !!el && el.value.trim().length > 0;
      },
      '[data-testid="invite-code-output"], textarea[readonly]',
      { timeout: 30_000 },
    );
  } catch (e) {
    // The invite call hits admin-api; a 403 there leaves the box empty.
    throw new Error(`invite code never populated.${recordedErrorsTail(inviterPage)}\n${(e as Error).message}`);
  }
  code = (await codeField.inputValue()).trim();
  if (!code) throw new Error(`invite code never populated.${recordedErrorsTail(inviterPage)}`);
  // Close the invite modal (Escape) so it doesn't overlay the joiner flow.
  await inviterPage.keyboard.press('Escape').catch(() => {});
  // Restore the inviter to the issues list: this helper detoured through the
  // Members view to reach the Invite button, but callers expect to be back on
  // the board (where issue cards live) once the invite is sent.
  await inviterPage.getByRole('link', { name: /All Issues/ }).click().catch(() => {});

  // Joiner: if it already auto-discovered the namespace (isolated runs inject
  // the shared context), just clear its alias gate and surface the code.
  if (await joinerPage.locator(READY).first().isVisible().catch(() => false)) {
    await skipAliasGate(joinerPage);
    return code;
  }
  await ctl(joinerPage, 'open-join-btn', 'Join').click();
  const input = joinerPage
    .locator('[data-testid="join-code-input"], #join-code, textarea')
    .first();
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await input.fill(code);
  await ctl(joinerPage, 'join-submit-btn', 'Join workspace').click();
  await waitForWorkspaceReady(joinerPage);
  await skipAliasGate(joinerPage);
  return code;
}

/** Clear all mero auth state. */
export async function clearAuth(page: Page) {
  try {
    const url = page.url();
    if (url === 'about:blank' || !url.startsWith('http')) return;
    await page.evaluate(() => {
      [
        // mero-js v2 stores the token as a single JSON blob under `mero-tokens`
        // — clearing it is what actually logs the test session out. The `mero:*`
        // keys hold node_url / application_id / context (still used).
        'mero-tokens',
        'mero:access_token', 'mero:refresh_token', 'mero:expires_at',
        'mero:node_url', 'mero:application_id', 'mero:context_id',
        'mero:context_identity',
        'pending-invitation',
        'issue-tracker:activeNs',
        'issue-tracker:activeNs:v2',
      ].forEach((k) => localStorage.removeItem(k));
      // Per-namespace repo selection + alias-gate markers.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('issue-tracker:activeRepo:') || k.startsWith('issue-tracker:alias-set:'))) {
          localStorage.removeItem(k);
        }
      }
    });
  } catch { /* page may be closed */ }
}
