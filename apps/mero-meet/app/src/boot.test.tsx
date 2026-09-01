/**
 * End-to-end boot test for the reported bug: "even on Tauri it's telling me to
 * get the desktop app, but it WAS opened from the desktop".
 *
 * These mount the real MeroProvider + App against a simulated tauri-app window —
 * the Tauri v2 globals the desktop shell actually injects, the SSO hash
 * calimero-shell actually builds, and a stubbed node — so the assertions cover
 * the real boot path (SSO parse → token adoption → auth probe → screen choice)
 * rather than a hand-rolled approximation of it.
 *
 * @vitest-environment-options { "url": "https://apps.calimero.network/?_cb=1" }
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// A reload is one of the retry paths and jsdom will not let location.reload be
// replaced, so the seam in lib/boot is mocked instead. resolveBootScreen — the
// thing under test — is kept real.
const reloadApp = vi.fn();
vi.mock("./lib/boot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/boot")>()),
  reloadApp,
}));

const NODE = "http://localhost:2528";
const LANDING_COPY = "Desktop app required";
const LANDING_CTA = "Get Calimero Desktop";

/** A decodable JWT — mero-react reads `iat`/`exp` to decide token staleness. */
function jwt({ iat, exp }: { iat: number; exp: number }): string {
  const seg = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${seg({ alg: "HS256", typ: "JWT" })}.${seg({ iat, exp })}.sig`;
}

const FRESH = jwt({ iat: 1_700_000_000, exp: 4_000_000_000 });

/**
 * The SSO hash tauri-app hands an app window — see `build_app_url` in
 * calimero-shell's main.rs and `openAppFrontend` in the host's appUtils.ts.
 * `refresh_token` is the desktop's broker sentinel, not a real token.
 */
function desktopHash(accessToken = FRESH): string {
  const p = new URLSearchParams();
  p.set("node_url", NODE);
  p.set("access_token", accessToken);
  p.set("refresh_token", "calimero-desktop-brokered-refresh-token");
  p.set("expires_at", String(Date.now() + 3_600_000));
  p.set("app-id", "AppId111111111111111111111111111111111111111");
  return `#${p.toString()}`;
}

/**
 * The Tauri v2 globals tauri-app's calimero-shell injects into a remote
 * (https-hosted) app page: `isTauri` + `__TAURI_INTERNALS__`, and NO
 * `window.__TAURI__` because every app window sets `withGlobalTauri: false`.
 */
function installDesktopGlobals(): void {
  const w = window as unknown as Record<string, unknown>;
  w.isTauri = true;
  w.__TAURI_INTERNALS__ = { invoke: async () => null, metadata: {} };
}

function removeDesktopGlobals(): void {
  const w = window as unknown as Record<string, unknown>;
  delete w.isTauri;
  delete w.__TAURI_INTERNALS__;
  delete w.__TAURI__;
  delete w.__TAURI_INVOKE__;
  delete w.__TAURI_IPC__;
}

interface NodeStub {
  /** Status for `HEAD /auth/validate` — 200 means the token is accepted. */
  validate: number;
  /** Status for `GET /auth/health` — 0 to simulate an unreachable node. */
  health: number;
}

function stubNode({ validate, health }: NodeStub) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/health")) {
      if (health === 0) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ data: {} }), { status: health });
    }
    if (url.includes("/auth/validate")) return new Response(null, { status: validate });
    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

/** Mount the app exactly the way main.tsx does. */
async function boot(): Promise<HTMLDivElement> {
  const { MeroProvider, AppMode } = await import("@calimero-network/mero-react");
  const { BrowserRouter } = await import("react-router-dom");
  const { captureSessionFromHash } = await import("./lib/session");
  const App = (await import("./App")).default;

  captureSessionFromHash();
  const hashNodeUrl = new URLSearchParams(window.location.hash.slice(1)).get("node_url");

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MeroProvider
        mode={AppMode.MultiContext}
        packageName="com.calimero.meromeet"
        registryUrl="https://apps.calimero.network"
        allowedNodeUrls={hashNodeUrl ? [hashNodeUrl] : undefined}
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MeroProvider>,
    );
  });
  // Let MeroProvider's async init (SSO adoption + auth probe) and the sign-in
  // screen's node probe settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return host;
}

beforeEach(() => {
  vi.resetModules();
  reloadApp.mockClear();
  localStorage.clear();
  removeDesktopGlobals();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  window.location.hash = "";
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

describe("boot inside the Calimero desktop app", () => {
  it("detects the desktop shell from the globals it actually injects", async () => {
    installDesktopGlobals();
    const { APP_ENABLED, IS_TAURI } = await import("./lib/tauri");
    expect(IS_TAURI).toBe(true);
    expect(APP_ENABLED).toBe(true);
  });

  it("goes straight into the app when the node accepts the SSO token", async () => {
    installDesktopGlobals();
    window.location.hash = desktopHash();
    stubNode({ validate: 200, health: 200 });

    const el = await boot();
    expect(el.textContent).not.toContain(LANDING_COPY);
    expect(el.textContent).not.toContain(LANDING_CTA);
    // The rooms picker is the signed-in entry point when no room was deep-linked.
    expect(el.textContent).toContain("Pick a room");
  });

  it("REGRESSION: a rejected token must not render the web landing page", async () => {
    // The bug. `HEAD /auth/validate` failing (expired token, node reset, node
    // still starting) left isAuthenticated false, and the auth guard answered
    // that with "Desktop app required — Get Calimero Desktop": advice to install
    // the app this window was opened from, with nothing to click.
    installDesktopGlobals();
    window.location.hash = desktopHash();
    stubNode({ validate: 401, health: 200 });

    const el = await boot();
    expect(el.textContent).not.toContain(LANDING_COPY);
    expect(el.textContent).not.toContain(LANDING_CTA);
    // ...and it offers a way forward instead.
    expect(el.textContent).toContain("Sign in");
    expect(el.textContent).toContain("Try again");
    expect(el.textContent).toContain(NODE);
  });

  it("waits for a node that has not finished starting, then reloads once it answers", async () => {
    installDesktopGlobals();
    window.location.hash = desktopHash();
    stubNode({ validate: 401, health: 0 }); // node unreachable

    const el = await boot();
    expect(el.textContent).toContain("Waiting for your Calimero node");
    expect(el.textContent).not.toContain(LANDING_COPY);
    // Nothing to reload for yet — the node is still down.
    expect(reloadApp).not.toHaveBeenCalled();

    // The node finishes starting; the next poll sees it and re-runs the boot so
    // the stored tokens get validated against a live node.
    stubNode({ validate: 200, health: 200 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2200));
    });
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });

  it("does NOT auto-reload when the node was reachable all along", async () => {
    // Guards a reload loop: `reloaded` is per-mount, so it cannot break a cycle
    // that goes through a page load. Only a down → up transition may reload.
    installDesktopGlobals();
    window.location.hash = desktopHash();
    stubNode({ validate: 401, health: 200 });

    const el = await boot();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2200));
    });
    expect(reloadApp).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Sign in to continue");
  });

  it("still detects a legacy Tauri v1 shell", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INVOKE__ = async () => null;
    window.location.hash = desktopHash();
    stubNode({ validate: 200, health: 200 });

    const el = await boot();
    expect(el.textContent).not.toContain(LANDING_COPY);
    expect(el.textContent).toContain("Pick a room");
  });
});

describe("boot on the plain web", () => {
  it("shows the landing page — no desktop globals, no SSO hash", async () => {
    stubNode({ validate: 200, health: 200 });
    const { APP_ENABLED } = await import("./lib/tauri");
    expect(APP_ENABLED).toBe(false);

    const el = await boot();
    expect(el.textContent).toContain(LANDING_COPY);
    expect(el.textContent).toContain(LANDING_CTA);
  });

  it("shows the landing page even when a page-set isTauri lies about the shell", async () => {
    // `window.isTauri` only counts when it is literally `true`.
    (window as unknown as Record<string, unknown>).isTauri = "yes";
    stubNode({ validate: 200, health: 200 });

    const el = await boot();
    expect(el.textContent).toContain(LANDING_COPY);
  });
});
