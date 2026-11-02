import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AppInfo, CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import { resolveTarget, type KeyValueStorage } from "@calimero-apps/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioPage } from "./StudioPage";
import { useScene } from "./scene";
import { selectionKey } from "./scenes";
import { APP, useSession, type SessionDeps } from "./session";

// The modeller itself is three.js and WebGL; these tests are about getting to it.
vi.mock("./studio/Studio", () => ({
  Studio: ({ contextId }: { contextId: string }) => {
    const scene = useScene();
    return (
      <p>
        studio {contextId} in {scene.org ?? "no org"} as {scene.accountId}
      </p>
    );
  },
}));

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

const ME = "acct-alice";
const SESSION: CalimeroSession = { accountId: ME, sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };

function scene(appId: string, name: string, org: string | null = "org-1"): AppInfo {
  return { appId, name, owner: ME, org, bundle: "bundle-hash", package: null, version: null };
}

function fakeClient(apps: AppInfo[] = []) {
  let session: CalimeroSession | undefined;
  return {
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
    createOrg: vi.fn(async () => "org-new"),
    createApp: vi.fn(async (name: string) => {
      apps.push(scene("app-new", name, "org-new"));
      return "app-new";
    }),
    invite: vi.fn(async () => "tok-123"),
    redeemInvite: vi.fn(async () => ({})),
  };
}

function deps(client: ReturnType<typeof fakeClient>, storage: KeyValueStorage): SessionDeps {
  return {
    env: DEV_ENV,
    storage,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

function Harness({ deps, storage }: { deps: SessionDeps; storage: KeyValueStorage }) {
  const api = useSession(deps);
  return <StudioPage api={api} deps={deps} storage={storage} />;
}

function renderPage(client: ReturnType<typeof fakeClient>, storage = new Memory()) {
  const d = deps(client, storage);
  render(
    <MemoryRouter initialEntries={["/studio"]}>
      <Harness deps={d} storage={storage} />
    </MemoryRouter>,
  );
  return storage;
}

describe("the studio's front door", () => {
  it("signs in with a passkey, lists the scenes, and opens one", async () => {
    const client = fakeClient([scene("app-2", "Robot"), scene("app-1", "Castle")]);
    const storage = renderPage(client);

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with a passkey" }));
    expect(await screen.findByText("Castle")).toBeTruthy();
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
    // Sorted by name, and the studio they belong to listed once.
    const titles = screen.getAllByTestId("scene-item").map((b) => b.textContent);
    expect(titles[0]).toContain("Castle");
    expect(screen.getAllByText("org-1")).toHaveLength(1);

    fireEvent.click(screen.getByText("Robot"));
    expect(await screen.findByText(`studio app-2 in org-1 as ${ME}`)).toBeTruthy();
    // Remembered for this account on this target.
    const key = selectionKey(resolveTarget(DEV_ENV), ME);
    expect(JSON.parse(storage.getItem(key)!)).toEqual({ appId: "app-2", name: "Robot", org: "org-1" });
  });

  it("makes a new scene in a studio of its own", async () => {
    const client = fakeClient();
    renderPage(client);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with a passkey" }));
    expect(await screen.findByText(/No scenes yet/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Scene name"), { target: { value: "Spaceship" } });
    fireEvent.click(screen.getByTestId("new-scene"));
    expect(await screen.findByText(`studio app-new in org-new as ${ME}`)).toBeTruthy();
    expect(client.createOrg).toHaveBeenCalledWith("Spaceship");
    expect(client.createApp).toHaveBeenCalledWith("Spaceship", "bundle-hash", { org: "org-new" });
  });

  it("adds a scene to a studio it is already in", async () => {
    const client = fakeClient([scene("app-1", "Castle")]);
    renderPage(client);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with a passkey" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add scene" }));
    await waitFor(() => expect(client.createApp).toHaveBeenCalledWith("Untitled scene", "bundle-hash", { org: "org-1" }));
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it("redeems an invitation opened before signing in", async () => {
    const client = fakeClient();
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, "tok-9");
    renderPage(client, storage);
    expect(await screen.findByText("You're invited")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));
    expect(await screen.findByText(/Invitation accepted/)).toBeTruthy();
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
    expect(storage.getItem(`${APP}:pending-invite`)).toBeNull();
  });

  it("creates an account with a name", async () => {
    const client = fakeClient();
    renderPage(client);
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "Alice"));
  });
});
