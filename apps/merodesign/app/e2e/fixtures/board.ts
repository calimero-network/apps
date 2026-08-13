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
export const TEST_MEMBER = { id: TEST_IDENTITY, username: "Tester", avatar: null, joinedAt: 1000 };

export interface RpcCall {
  method: string;
  args: Record<string, unknown>;
}

export interface Board {
  /** Every contract call, in order. */
  calls: RpcCall[];
  calledWith(method: string): RpcCall[];
  /** Replaces what `get_elements` will return on the next fetch. */
  setElements(next: Element[]): void;
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
   */
  serveBlob?: boolean;
  /**
   * Make chosen contract methods fail, to simulate a board whose context runs an
   * older bundle: `{ set_layer_index: "Method not found" }`.
   */
  failMethods?: Record<string, string>;
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
    // An 8x8 red PNG, enough for FabricImage to decode.
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z4AAT" +
      "AxDkjEqBwCbtgH9AoTPogAAAABJRU5ErkJggg==";
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

    const failure = opts.failMethods?.[method];
    if (failure) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: body?.id ?? 1,
          error: { code: -32601, message: failure, data: failure },
        }),
      });
    }

    let value: unknown;
    switch (method) {
      case "get_elements": value = state.elements; break;
      case "get_comments": value = state.comments; break;
      case "get_members": value = [TEST_MEMBER]; break;
      case "get_cursors": value = []; break;
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
        state.elements = state.elements.map((e) => {
          if (e.id !== a.id) return e;
          const patch: Record<string, unknown> = {};
          const map: Record<string, string> = {
            x: "x", y: "y", width: "width", height: "height", rotation: "rotation",
            fill: "fill", stroke: "stroke", stroke_width: "strokeWidth",
            opacity: "opacity", corner_radius: "cornerRadius",
          };
          for (const [wire, key] of Object.entries(map)) {
            if (a[wire] !== null && a[wire] !== undefined) patch[key] = a[wire];
          }
          return { ...e, ...patch } as Element;
        });
        value = null;
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
    setElements: (next: Element[]) => {
      state.elements = next;
    },
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
