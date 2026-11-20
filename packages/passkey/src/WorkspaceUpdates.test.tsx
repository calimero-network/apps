import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalimeroError, type CalimeroClient } from "@calimero-network/mero-js";
import type { KeyValueStorage } from "@calimero-apps/connect";

import { bindShieldSession } from "./nodeShieldStore";
import { UPGRADE_PENDING_KEY } from "./upgrade";
import { WorkspaceUpdates } from "./WorkspaceUpdates";

const PKG = "com.calimero.mero-crm";
const HREF = "https://app.example.net/1.0.0/settings?x=1#top";

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const answer = (over: Record<string, unknown> = {}) => ({
  app: "app-1",
  running: { package: PKG, version: "1.0.0" },
  available: { package: PKG, version: "1.2.0", source: "release" },
  mayApprove: true,
  approvers: "owner-and-admins",
  ...over,
});

let unbind: Array<() => void> = [];
function connect(read: () => Promise<unknown>, pageCreate = vi.fn(async () => ({ requestId: "req-1", url: "https://node.example.net/consent/req-1" }))) {
  const json = vi.fn(read);
  const client = { nodeUrl: "https://node.example.net", transport: { json }, consent: { pageCreate } } as unknown as CalimeroClient;
  unbind.push(bindShieldSession({ client, cluster: "test" }));
  return { json, pageCreate };
}

function show() {
  const navigate = vi.fn();
  const storage = memoryStorage();
  render(<WorkspaceUpdates appId="app-1" subject="the pipeline Sales" href={HREF} upgrade={{ navigate, storage }} />);
  return { navigate, storage };
}

afterEach(() => {
  cleanup();
  unbind.forEach((u) => u());
  unbind = [];
});

describe("WorkspaceUpdates", () => {
  it("shows the running and the available release, and sends an approver to the node's consent page", async () => {
    const { pageCreate } = connect(async () => answer());
    const { navigate, storage } = show();
    expect(screen.getByRole("heading", { name: "Updates" })).toBeTruthy();
    expect(screen.getByText(/for the pipeline Sales/)).toBeTruthy();
    expect((await screen.findByTestId("updates-running")).textContent).toBe(`${PKG} v1.0.0`);
    expect(screen.getByTestId("updates-available").textContent).toContain(`${PKG} v1.2.0`);
    expect(screen.queryByTestId("updates-readonly")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Review and update" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://node.example.net/consent/req-1"));
    expect(pageCreate).toHaveBeenCalledWith({
      body: { kind: "upgrade", subject: { app: "app-1", toVersion: "1.2.0" }, returnTo: "https://app.example.net/1.0.0/settings?x=1" },
    });
    // What the in-app prompt reads on the way back.
    expect(JSON.parse(storage.map.get(UPGRADE_PENDING_KEY)!)).toMatchObject({ requestId: "req-1", app: "app-1", version: "1.2.0", from: "1.0.0" });
  });

  it("shows a member who may not approve the same facts read-only, with who approves", async () => {
    connect(async () => answer({ mayApprove: false }));
    show();
    expect((await screen.findByTestId("updates-readonly")).textContent).toBe(
      "Only an owner or admin of the workspace's organization can approve this update. Ask one of them to update it.",
    );
    expect(screen.getByTestId("updates-available").textContent).toContain("v1.2.0");
    expect(screen.queryByRole("button", { name: "Review and update" })).toBeNull();
  });

  it("says a deployment's offer is the deployment's", async () => {
    connect(async () => answer({ available: { package: PKG, version: "2.0.0", source: "deployment" } }));
    show();
    expect((await screen.findByTestId("updates-available")).textContent).toContain("Offered by the deployment this workspace was created from.");
  });

  it("says when it is up to date, and offers nothing to approve", async () => {
    connect(async () => answer({ available: null }));
    show();
    expect((await screen.findByTestId("updates-available")).textContent).toBe("None: this is the newest release it can move to.");
    expect(screen.queryByRole("button", { name: "Review and update" })).toBeNull();
    expect(screen.queryByTestId("updates-readonly")).toBeNull();
  });

  it("says the node's refusal in plain words and stays on the page", async () => {
    const pageCreate = vi.fn(async () => {
      throw new CalimeroError(403, "FORBIDDEN", "only an owner or admin of the organization approves its apps' upgrades");
    });
    connect(async () => answer(), pageCreate);
    const { navigate, storage } = show();
    fireEvent.click(await screen.findByRole("button", { name: "Review and update" }));
    expect((await screen.findByTestId("updates-error")).textContent).toContain("Only an owner or admin");
    expect(navigate).not.toHaveBeenCalled();
    expect(storage.map.has(UPGRADE_PENDING_KEY)).toBe(false);
    expect((screen.getByRole("button", { name: "Review and update" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains a deployment's refusal of another version", async () => {
    connect(async () => answer(), vi.fn(async () => {
      throw new CalimeroError(409, "OUTSIDE_DEPLOYMENT", "outside the deployment");
    }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Review and update" }));
    expect((await screen.findByTestId("updates-error")).textContent).toContain("moves only to the release the deployment offers");
  });

  it("offers Try again when the read fails, and reads again", async () => {
    let fail = true;
    const { json } = connect(async () => {
      if (fail) throw new CalimeroError(503, "UNAVAILABLE", "busy");
      return answer({ available: null });
    });
    show();
    expect(await screen.findByText("Whether an update is available could not be read.")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("updates-available")).toBeTruthy();
    expect(json).toHaveBeenCalledTimes(2);
  });

  it("says so when no node is connected", () => {
    render(<WorkspaceUpdates appId="app-1" />);
    expect(screen.getByText("Not connected to a node.")).toBeTruthy();
  });
});
