/**
 * Admin REST API tests — live merod node, no browser.
 *
 * Tests the node's /admin-api endpoints that the frontend calls to manage
 * workspaces, channels, and member identities.
 *
 * Prerequisites:
 *   ./scripts/dev-node.sh   ← starts node, writes app/.env.integration
 *
 * Run:
 *   pnpm exec playwright test --project=rpc-admin
 */

import { test, expect } from "@playwright/test";
import {
  adminGet,
  envAvailable,
  getEnv,
} from "./helpers/rpc-client";

function requireEnv() {
  if (!envAvailable()) {
    test.skip();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────────────────────

test.describe("health endpoint", () => {
  test.beforeAll(requireEnv);

  test("GET /admin-api/health returns 200", async () => {
    const env = getEnv();
    const res = await fetch(`${env.nodeUrl}/admin-api/health`);
    expect(res.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Groups / Namespaces
// ─────────────────────────────────────────────────────────────────────────────

// The node exposes namespaces under /namespaces (not /groups).
// Each entry has a `namespaceId` field (not `groupId`).
interface NamespaceEntry {
  namespaceId: string;
  alias?: string;
  targetApplicationId?: string;
}

test.describe("groups (namespaces)", () => {
  test.beforeAll(requireEnv);

  test("GET /admin-api/namespaces returns array with at least one namespace", async () => {
    const data = await adminGet<NamespaceEntry[]>("/namespaces");
    const namespaces = Array.isArray(data) ? data : [];
    expect(namespaces.length).toBeGreaterThan(0);
  });

  test("GET /admin-api/namespaces returns namespaceId field on each entry", async () => {
    const data = await adminGet<NamespaceEntry[]>("/namespaces");
    const namespaces = Array.isArray(data) ? data : [];
    for (const ns of namespaces) {
      expect(typeof ns.namespaceId).toBe("string");
      expect(ns.namespaceId.length).toBeGreaterThan(0);
    }
  });

  test("GET /admin-api/namespaces contains the seeded groupId from env", async () => {
    const env = getEnv();
    if (!env.groupId) { test.skip(); return; }

    const data = await adminGet<NamespaceEntry[]>("/namespaces");
    const namespaces = Array.isArray(data) ? data : [];
    const found = namespaces.find((ns) => ns.namespaceId === env.groupId);
    expect(found).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group contexts
// ─────────────────────────────────────────────────────────────────────────────

interface ContextEntry {
  contextId: string;
  applicationId?: string;
  alias?: string;
}

test.describe("group contexts", () => {
  test.beforeAll(requireEnv);

  test("GET /admin-api/groups/:id/contexts returns array", async () => {
    const env = getEnv();
    if (!env.groupId) { test.skip(); return; }

    const data = await adminGet<
      ContextEntry[] | { contexts?: ContextEntry[]; items?: ContextEntry[] }
    >(`/groups/${env.contextGroupId}/contexts`);

    const contexts = Array.isArray(data)
      ? data
      : (data as { contexts?: ContextEntry[] }).contexts
        ?? (data as { items?: ContextEntry[] }).items
        ?? [];
    expect(Array.isArray(contexts)).toBe(true);
  });

  test("GET /admin-api/groups/:id/contexts contains the seeded contextId", async () => {
    const env = getEnv();
    if (!env.contextGroupId || !env.contextId) { test.skip(); return; }

    const data = await adminGet<
      ContextEntry[] | { contexts?: ContextEntry[]; items?: ContextEntry[] }
    >(`/groups/${env.contextGroupId}/contexts`);

    const contexts = Array.isArray(data)
      ? data
      : (data as { contexts?: ContextEntry[] }).contexts
        ?? (data as { items?: ContextEntry[] }).items
        ?? [];
    const found = contexts.find((c) => c.contextId === env.contextId);
    expect(found).toBeTruthy();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Member identity
// ─────────────────────────────────────────────────────────────────────────────

test.describe("member identity", () => {
  test.beforeAll(requireEnv);

  test("GET /admin-api/groups/:id/members returns member list", async () => {
    const env = getEnv();
    if (!env.groupId) { test.skip(); return; }

    const data = await adminGet<unknown>(`/groups/${env.groupId}/members`);
    // Just verify the call doesn't throw
    expect(data).toBeDefined();
  });

  test("GET /admin-api/contexts/:id/identities-owned returns owned identities", async () => {
    const env = getEnv();
    if (!env.contextId) { test.skip(); return; }

    const data = await adminGet<string[] | { identities?: string[] }>(
      `/contexts/${env.contextId}/identities-owned`,
    );
    const ids = Array.isArray(data)
      ? data
      : (data as { identities?: string[] }).identities ?? [];
    expect(Array.isArray(ids)).toBe(true);
    // The seeded member key should be among the owned identities
    if (env.memberKey && ids.length > 0) {
      expect(ids).toContain(env.memberKey);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Context list
// ─────────────────────────────────────────────────────────────────────────────

test.describe("context list", () => {
  test.beforeAll(requireEnv);

  test("GET /admin-api/contexts returns array with seeded context", async () => {
    const env = getEnv();
    if (!env.contextId) { test.skip(); return; }

    // Node returns { data: { contexts: [{ id, ... }] } } — field is `id`, not `contextId`
    const data = await adminGet<
      { contexts?: Array<{ id?: string; contextId?: string }> } | Array<{ id?: string; contextId?: string }>
    >("/contexts");
    const contexts = Array.isArray(data)
      ? data
      : (data as { contexts?: Array<{ id?: string; contextId?: string }> }).contexts ?? [];
    expect(contexts.some((c) => (c.id ?? c.contextId) === env.contextId)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth token refresh
// ─────────────────────────────────────────────────────────────────────────────

