import { test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import type { Element } from "../../src/types";

/**
 * Boots the canvas against a fully mocked node, so a spec can seed exact element
 * geometry and read back what the renderer painted.
 *
 * Also records every contract call, which is how a spec proves something was
 * *persisted to WASM* rather than only drawn locally — the distinction that made
 * the layer-order bug invisible for so long.
 */

export const TEST_IDENTITY = "test-identity";

/** The contract's `MAX_BATCH`: the most elements one batch call accepts. */
export const MAX_BATCH = 200;

/** `update_element`'s argument names → the element fields they set. */
const PATCH_FIELDS: Record<string, string> = {
  x: "x", y: "y", width: "width", height: "height", rotation: "rotation",
  fill: "fill", stroke: "stroke", stroke_width: "strokeWidth",
  opacity: "opacity", corner_radius: "cornerRadius",
};

function patchElement(e: Element, a: Record<string, unknown>): Element {
  const patch: Record<string, unknown> = {};
  for (const [wire, key] of Object.entries(PATCH_FIELDS)) {
    if (a[wire] !== null && a[wire] !== undefined) patch[key] = a[wire];
  }
  return { ...e, ...patch } as Element;
}
export const TEST_MEMBER = { id: TEST_IDENTITY, username: "Tester", avatar: null, joinedAt: 1000 };

export interface RpcCall {
  method: string;
  args: Record<string, unknown>;
}

export interface Board {
  /** Every contract call, in order. */
  calls: RpcCall[];
  calledWith(method: string): RpcCall[];
  /**
   * Every per-element write of a single-element method, whichever way it went
   * out: the method's own calls, plus each element of its batch twin
   * (`add_element` ← `add_elements`, `delete_element` ← `delete_elements`,
   * `update_element` ← `update_elements`, `update_element_label` ←
   * `update_element_labels`), each shaped like a call to the single method. A
   * spec about WHAT was written reads this; one about HOW (one batch vs N
   * calls) reads `calledWith`.
   */
  writes(method: string): RpcCall[];
  /** Replaces what `get_elements` will return on the next fetch. */
  setElements(next: Element[]): void;
  /** The node's element state right now, including every edit the page made. */
  elementsNow(): Element[];
  /** Bodies of every blob upload, in order — what a flatten writes out. */
  blobUploads: string[];
}

export interface BoardOptions {
  elements?: Element[];
  comments?: unknown[];
  /** `isAdmin` in CanvasPage is `role === "admin"` — not "owner". */
  role?: "admin" | "editor" | "viewer";
  /**
   * Install a Tauri bridge stub, so the same spec runs as the desktop app.
   * Defaults to the Playwright project name, so every spec covers both.
   */
  tauri?: boolean;
  /**
   * Answer the blob endpoints: uploads return a blob id, fetches return a real
   * 8x8 PNG so image elements decode. Anything that flattens a group needs this,
   * or the upload leaves the mock and hits the network.
   *
   * ⚠️ The default bitmap is 8x8 and **fully transparent** — it decodes, which is
   * all most specs need, but it paints nothing. A spec that asserts on where an
   * image landed must pass `opaqueBlob` or it is reading the board behind the
   * image and passing for the wrong reason.
   */
  serveBlob?: boolean;
  /**
   * Serve an opaque red 8x8 bitmap instead of the transparent default, so a spec
   * can assert an image's paint order in pixels. Off by default: the stroke specs
   * (task-06) measure border pixels against a bitmap that contributes none.
   */
  opaqueBlob?: boolean;
  /**
   * Make chosen contract methods fail, to simulate a board whose context runs an
   * older bundle: `{ set_layer_index: "Method not found" }`.
   */
  failMethods?: Record<string, string>;
  /** Everyone on the board. Defaults to just `TEST_MEMBER`. */
  members?: { id: string; username: string; avatar: string | null; joinedAt: number }[];
  /** Other members' cursors, in screen pixels. Read on every poll, so `updatedAt` can stay fresh. */
  cursors?: () => { identity: string; x: number; y: number; updatedAt: number }[];
}

export async function openBoard(page: Page, opts: BoardOptions = {}): Promise<Board> {
  const state = {
    elements: opts.elements ?? [],
    comments: opts.comments ?? [],
    role: opts.role ?? "admin",
  };
  const calls: RpcCall[] = [];
  const blobUploads: string[] = [];

  await page.addInitScript(() => {
    // JWT payload: {"sub":"test-identity"}
    localStorage.setItem(
      "mero-tokens",
      JSON.stringify({
        access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LWlkZW50aXR5In0.sig",
        refresh_token: "fake-refresh",
        expires_at: Date.now() + 3600000,
      }),
    );
    localStorage.setItem("mero:node_url", "http://localhost:2430");
    localStorage.setItem("mero:application_id", "app-1");
  });

  const asTauri = opts.tauri ?? test.info().project.name === "tauri";
  if (asTauri) await installTauriStub(page);

  // Mirrors the routing the existing specs use — the shapes matter: a catch-all
  // over /admin-api/** swallows identities-owned with the wrong body and the
  // canvas then never mounts.
  await page.route("**/auth/validate", (r: Route) => r.fulfill({ status: 200 }));
  await page.route("**/admin-api/contexts", (r: Route) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { contexts: [] } }),
    }),
  );
  await page.route("**/admin-api/contexts/**/identities-owned", (r: Route) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [TEST_IDENTITY] }),
    }),
  );
  if (opts.serveBlob) {
    // 8x8 PNGs. The transparent one is the default and was previously commented
    // as "red" — it is not, and that mislabelling is what makes a naive pixel
    // assertion about an image pass for the wrong reason.
    const TRANSPARENT_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z4AAT" +
      "AxDkjEqBwCbtgH9AoTPogAAAABJRU5ErkJggg==";
    const RED_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR42mP4" +
      "z8DwHx9mGBkKAMLXf4HVAzL9AAAAAElFTkSuQmCC";
    const PNG = opts.opaqueBlob ? RED_PNG : TRANSPARENT_PNG;
    await page.route("**/admin-api/blobs**", async (route: Route) => {
      if (route.request().method() === "PUT") {
        blobUploads.push(route.request().postData() ?? "");
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { blob_id: `blob-${blobUploads.length}`, size: 1 } }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(PNG, "base64"),
      });
    });
  }

  // SSE would retry forever against a node that is not there.
  await page.route("**/events**", (r: Route) => r.abort());
  await page.route("**/sse**", (r: Route) => r.abort());

  await page.route("**/jsonrpc", (route: Route) => {
    const body = route.request().postDataJSON() as {
      id?: number;
      params?: { method?: string; argsJson?: Record<string, unknown> };
    };
    const method = body?.params?.method ?? "";
    calls.push({ method, args: body?.params?.argsJson ?? {} });

    const refuse = (message: string) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: body?.id ?? 1,
          error: { code: -32601, message, data: message },
        }),
      });
    const failure = opts.failMethods?.[method];
    if (failure) return refuse(failure);

    let value: unknown;
    switch (method) {
      case "get_elements": value = state.elements; break;
      // What the app re-reads when an ElementAdded / ElementUpdated event arrives.
      case "get_element": {
        const id = (body?.params?.argsJson as { id?: string })?.id;
        value = state.elements.find((e) => e.id === id) ?? null;
        break;
      }
      case "get_comments": value = state.comments; break;
      case "get_members": value = opts.members ?? [TEST_MEMBER]; break;
      case "get_cursors": value = opts.cursors?.() ?? []; break;
      case "get_board":
        value = { name: "Test board", description: "", elementCount: state.elements.length, memberCount: 1 };
        break;
      case "my_role": value = state.role; break;
      case "can_edit": value = state.role !== "viewer"; break;
      case "list_roles": value = [{ member: TEST_IDENTITY, role: state.role }]; break;
      // Mutations are applied, not just acknowledged: a spec that re-reads the
      // board after an import must see what it wrote, the way the contract does.
      case "add_element": {
        const el = (body?.params?.argsJson as { element?: Element })?.element;
        if (el) state.elements = [...state.elements.filter((e) => e.id !== el.id), el];
        value = el?.id ?? "ok";
        break;
      }
      case "delete_element": {
        const id = (body?.params?.argsJson as { id?: string })?.id;
        state.elements = state.elements.filter((e) => e.id !== id);
        value = null;
        break;
      }
      case "update_element": {
        const a = body?.params?.argsJson as Record<string, unknown>;
        state.elements = state.elements.map((e) => (e.id === a.id ? patchElement(e, a) : e));
        value = null;
        break;
      }
      // The batch methods, applied as the contract applies them — including
      // refusing a batch over its cap, so a client that stops chunking fails here.
      case "add_elements": {
        const els = (body?.params?.argsJson as { elements?: Element[] })?.elements ?? [];
        if (els.length > MAX_BATCH) return refuse(`a batch holds at most ${MAX_BATCH} elements, got ${els.length}`);
        const ids = new Set(els.map((e) => e.id));
        state.elements = [...state.elements.filter((e) => !ids.has(e.id)), ...els];
        value = els.map((e) => e.id);
        break;
      }
      case "update_elements": {
        const patches = (body?.params?.argsJson as { patches?: Record<string, unknown>[] })?.patches ?? [];
        if (patches.length > MAX_BATCH) return refuse(`a batch holds at most ${MAX_BATCH} elements, got ${patches.length}`);
        const byId = new Map(patches.map((p) => [p.id as string, p] as const));
        state.elements = state.elements.map((e) => (byId.has(e.id) ? patchElement(e, byId.get(e.id)!) : e));
        value = null;
        break;
      }
      case "update_element_labels": {
        const labels = (body?.params?.argsJson as { labels?: { id: string; label: string | null }[] })?.labels ?? [];
        if (labels.length > MAX_BATCH) return refuse(`a batch holds at most ${MAX_BATCH} elements, got ${labels.length}`);
        const byId = new Map(labels.map((l) => [l.id, l.label] as const));
        state.elements = state.elements.map((e) => (byId.has(e.id) ? { ...e, label: byId.get(e.id) ?? null } : e));
        value = null;
        break;
      }
      case "delete_elements": {
        const ids = (body?.params?.argsJson as { ids?: string[] })?.ids ?? [];
        if (ids.length > MAX_BATCH) return refuse(`a batch holds at most ${MAX_BATCH} elements, got ${ids.length}`);
        const gone = new Set(ids);
        state.elements = state.elements.filter((e) => !gone.has(e.id));
        value = null;
        break;
      }
      case "get_elements_by_ids": {
        const ids = (body?.params?.argsJson as { ids?: string[] })?.ids ?? [];
        value = ids.map((id) => state.elements.find((e) => e.id === id)).filter(Boolean);
        break;
      }
      case "update_text_style": {
        const a = body?.params?.argsJson as Record<string, unknown>;
        state.elements = state.elements.map((e) => {
          if (e.id !== a.id) return e;
          const data = { ...e.data };
          if (a.content != null) data.content = a.content as string;
          if (a.font_size != null) data.fontSize = a.font_size as number;
          if (a.font_family != null) data.fontFamily = a.font_family as string;
          if (a.bold != null) data.bold = a.bold as boolean;
          if (a.italic != null) data.italic = a.italic as boolean;
          if (a.text_align != null) data.text_align = a.text_align as "left" | "center" | "right";
          if (a.vertical_align != null) data.vertical_align = a.vertical_align as "top" | "middle" | "bottom";
          return { ...e, data } as Element;
        });
        value = null;
        break;
      }
      case "set_layer_index": {
        // Mirrors the contract: move to the index, then renumber densely.
        const a = body?.params?.argsJson as { id?: string; index?: number };
        const sorted = [...state.elements].sort((x, y) => x.layerIndex - y.layerIndex);
        const from = sorted.findIndex((e) => e.id === a.id);
        if (from >= 0) {
          const to = Math.min(Math.max(a.index ?? 0, 0), sorted.length - 1);
          const [moved] = sorted.splice(from, 1);
          sorted.splice(to, 0, moved);
          const layers = new Map(sorted.map((e, i) => [e.id, i]));
          state.elements = state.elements.map((e) => ({ ...e, layerIndex: layers.get(e.id) ?? e.layerIndex }));
        }
        value = null;
        break;
      }
      case "update_element_label": {
        const a = body?.params?.argsJson as { id?: string; label?: string | null };
        state.elements = state.elements.map((e) => (e.id === a.id ? { ...e, label: a.label ?? null } : e));
        value = null;
        break;
      }
      case "send_to_back": {
        // Mirrors the contract: everything else moves up one.
        const a = body?.params?.argsJson as { id?: string };
        state.elements = state.elements.map((e) => ({ ...e, layerIndex: e.id === a.id ? 0 : e.layerIndex + 1 }));
        value = null;
        break;
      }
      case "clear_elements": state.elements = []; value = null; break;
      case "clear_comments": state.comments = []; value = null; break;
      case "add_comment": {
        const c = body?.params?.argsJson as Record<string, unknown>;
        state.comments = [...state.comments, { ...c, replies: [] }];
        value = null;
        break;
      }
      default: value = null;
    }
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(value)));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? 1, result: { output: bytes, logs: [] } }),
    });
  });

  await page.goto("/teams/team-1/projects/ctx-1");
  await page.waitForSelector('[data-testid="fabric-canvas"]');
  // Fabric renders images and text asynchronously; give the first paint a beat.
  await page.waitForTimeout(900);

  return {
    calls,
    calledWith: (m: string) => calls.filter((c) => c.method === m),
    writes: (m: string) => calls.flatMap((c): RpcCall[] => {
      if (c.method === m) return [c];
      const a = c.args;
      if (m === "add_element" && c.method === "add_elements") {
        return ((a.elements as Element[]) ?? []).map((element) => ({ method: m, args: { element } }));
      }
      if (m === "delete_element" && c.method === "delete_elements") {
        return ((a.ids as string[]) ?? []).map((id) => ({ method: m, args: { id } }));
      }
      if (m === "update_element" && c.method === "update_elements") {
        return ((a.patches as Record<string, unknown>[]) ?? []).map((p) => ({
          method: m, args: { ...p, updated_at: a.updated_at },
        }));
      }
      if (m === "update_element_label" && c.method === "update_element_labels") {
        return ((a.labels as Record<string, unknown>[]) ?? []).map((l) => ({
          method: m, args: { ...l, updated_at: a.updated_at },
        }));
      }
      return [];
    }),
    setElements: (next: Element[]) => {
      state.elements = next;
    },
    elementsNow: () => state.elements,
    blobUploads,
  };
}

/**
 * A recording Tauri bridge. Stubs `__TAURI_INTERNALS__` — the live bridge. Stubbing
 * the dead `__TAURI__` object instead makes every invoke reject, which reads like a
 * broken feature rather than a broken test.
 */
export async function installTauriStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: { cmd: string; args: unknown }[] = [];
    (window as unknown as Record<string, unknown>).__TAURI_CALLS__ = calls;
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: unknown) => {
        calls.push({ cmd, args });
        // Enough for the paths under test; extend per feature.
        if (cmd.startsWith("plugin:dialog|save")) return Promise.resolve("/tmp/out.png");
        return Promise.resolve(null);
      },
      transformCallback: (cb: unknown) => cb,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    };
  });
}

export async function tauriCalls(page: Page): Promise<{ cmd: string; args: unknown }[]> {
  return page.evaluate(
    () => (window as unknown as { __TAURI_CALLS__?: { cmd: string; args: unknown }[] }).__TAURI_CALLS__ ?? [],
  );
}

/** True when the app took its Tauri branch (main.tsx keys off __TAURI_INTERNALS__). */
export async function isTauriBuild(page: Page): Promise<boolean> {
  return page.evaluate(() => "__TAURI_INTERNALS__" in window);
}
