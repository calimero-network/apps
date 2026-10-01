import { describe, it, expect, beforeEach } from "vitest";
import { applyDevOverlay } from "./devOverlay";

const KEY = "calimero_group_aliases";

class MemStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.get(k) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

function makeOkFetch(body: unknown): typeof fetch {
  return ((async () => ({
    ok: true,
    json: async () => body,
  })) as unknown) as typeof fetch;
}

function makeFailFetch(status = 404): typeof fetch {
  return ((async () => ({ ok: false, status, json: async () => ({}) })) as unknown) as typeof fetch;
}

describe("applyDevOverlay", () => {
  let local: MemStorage;
  let session: MemStorage;

  beforeEach(() => {
    local = new MemStorage();
    session = new MemStorage();
  });

  it("seeds the alias when the overlay is present and storage is empty", async () => {
    const fetchFn = makeOkFetch({
      namespace_id: "ns-abc",
      namespace_alias: "Dev Workspace",
    });

    const written = await applyDevOverlay(fetchFn, local, session);

    expect(written).toBe(true);
    expect(JSON.parse(local.getItem(KEY)!)).toEqual({ "ns-abc": "Dev Workspace" });
    // Mirror to sessionStorage so per-tab reads also work.
    expect(JSON.parse(session.getItem(KEY)!)).toEqual({ "ns-abc": "Dev Workspace" });
  });

  it("merges into existing aliases without clobbering other namespaces", async () => {
    local.setItem(KEY, JSON.stringify({ "ns-other": "Other" }));

    const fetchFn = makeOkFetch({
      namespace_id: "ns-abc",
      namespace_alias: "Dev Workspace",
    });

    await applyDevOverlay(fetchFn, local, session);

    const map = JSON.parse(local.getItem(KEY)!);
    expect(map).toEqual({ "ns-other": "Other", "ns-abc": "Dev Workspace" });
  });

  it("is a no-op when the existing alias already matches", async () => {
    local.setItem(KEY, JSON.stringify({ "ns-abc": "Dev Workspace" }));

    const fetchFn = makeOkFetch({
      namespace_id: "ns-abc",
      namespace_alias: "Dev Workspace",
    });

    const written = await applyDevOverlay(fetchFn, local, session);

    expect(written).toBe(false);
  });

  it("returns false silently when /dev-overlay.json is 404 (production case)", async () => {
    const written = await applyDevOverlay(makeFailFetch(404), local, session);
    expect(written).toBe(false);
    expect(local.getItem(KEY)).toBeNull();
  });

  it("returns false when fetch throws (offline / dev server down)", async () => {
    const fetchFn = (async () => { throw new Error("nope"); }) as unknown as typeof fetch;
    const written = await applyDevOverlay(fetchFn, local, session);
    expect(written).toBe(false);
  });

  it("returns false when overlay JSON is missing required fields", async () => {
    const fetchFn = makeOkFetch({ namespace_id: "ns-abc" /* no alias */ });
    const written = await applyDevOverlay(fetchFn, local, session);
    expect(written).toBe(false);
    expect(local.getItem(KEY)).toBeNull();
  });

  it("survives malformed pre-existing storage (resets the map)", async () => {
    local.setItem(KEY, "not-json{{");

    const fetchFn = makeOkFetch({
      namespace_id: "ns-abc",
      namespace_alias: "Dev Workspace",
    });

    const written = await applyDevOverlay(fetchFn, local, session);

    expect(written).toBe(true);
    expect(JSON.parse(local.getItem(KEY)!)).toEqual({ "ns-abc": "Dev Workspace" });
  });

  it("handles overlay JSON parsing errors gracefully", async () => {
    const fetchFn = ((async () => ({
      ok: true,
      json: async () => { throw new Error("invalid json"); },
    })) as unknown) as typeof fetch;

    const written = await applyDevOverlay(fetchFn, local, session);
    expect(written).toBe(false);
  });
});
