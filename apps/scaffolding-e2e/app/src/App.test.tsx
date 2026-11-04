import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AppInfo, CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import { resolveTarget, type KeyValueStorage } from "@calimero-apps/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { selectionKey } from "./instances";
import type { SessionDeps } from "./session";

afterEach(cleanup);

class Memory implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

const SESSION: CalimeroSession = { accountId: "acct-alice", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };

function fakeClient(apps: AppInfo[] = []) {
  let session: CalimeroSession | undefined;
  return {
    nodeUrl: "http://127.0.0.1:2501",
    get session() {
      return session;
    },
    useSession: vi.fn((s: CalimeroSession) => {
      session = s;
    }),
    signIn: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signUp: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signOut: vi.fn(async () => {
      session = undefined;
    }),
    listApps: vi.fn(async () => apps),
    createOrg: vi.fn(async () => "org-1"),
    createApp: vi.fn(async (name: string) => {
      apps.push({ appId: "app-new", name, owner: "acct-alice", org: "org-1", bundle: "bundle-hash", package: null, version: null });
      return "app-new";
    }),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: method === "len" ? "3" : {} })),
    invite: vi.fn(async () => "tok-123"),
    redeemInvite: vi.fn(async () => ({})),
  };
}

function deps(client: ReturnType<typeof fakeClient>, env: SessionDeps["env"] = DEV_ENV): SessionDeps {
  return {
    env,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

describe("App", () => {
  it("shows the listing on a production copy no cluster serves", async () => {
    render(<App deps={deps(fakeClient(), { DEV: false })} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open Scaffolding E2E" });
    // The node-served copy: mdma's `app_host.app_url("com.calimero.scaffolding-e2e")`.
    expect(open.getAttribute("href")).toBe("https://qckbkkvlixbqw4j52gqoy42wmdnlfesmicyhb5kxacymtsj5geaq.apps.calimero.network/");
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/v2",
    );
    expect(screen.queryByText(/VITE_CALIMERO_CLUSTER/)).toBeNull();
  });

  it("signs up with a passkey and creates a shared instance from the dev bundle", async () => {
    const client = fakeClient();
    const storage = new Memory();
    storage.setItem("calimero-active-tab", "kv");
    render(<App deps={deps(client)} storage={storage} />);

    fireEvent.click(await screen.findByText("Create a passkey"));
    await screen.findByText("Pick an app instance");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");

    fireEvent.change(screen.getByLabelText("instance name"), { target: { value: "bench" } });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(client.createApp).toHaveBeenCalledWith("bench", "bundle-hash", { org: "org-1" }));
    await screen.findByRole("heading", { name: "KV Operations" });
    expect(storage.getItem(selectionKey(resolveTarget(DEV_ENV), "acct-alice"))).toContain("app-new");
  });

  it("calls the opened instance with the ABI's names and kinds", async () => {
    const client = fakeClient([
      { appId: "app-1", name: "bench", owner: "acct-alice", org: null, bundle: "bundle-hash", package: null, version: null },
    ]);
    const storage = new Memory();
    storage.setItem("calimero-active-tab", "kv");
    render(<App deps={deps(client)} storage={storage} />);

    fireEvent.click(await screen.findByText("Continue with passkey"));
    fireEvent.click(await screen.findByText("Open"));
    await screen.findByRole("heading", { name: "KV Operations" });

    fireEvent.change(screen.getAllByPlaceholderText("key")[0] as HTMLElement, { target: { value: "k" } });
    fireEvent.change(screen.getAllByPlaceholderText("value")[0] as HTMLElement, { target: { value: "v" } });
    fireEvent.click(screen.getAllByText("Execute")[0] as HTMLElement);
    await waitFor(() => expect(client.call).toHaveBeenCalledWith("app-1", "set", { key: "k", value: "v" }));
    // The live entries panel polls the `entries` view.
    await waitFor(() => expect(client.view).toHaveBeenCalledWith("app-1", "entries", {}));
  });
});
