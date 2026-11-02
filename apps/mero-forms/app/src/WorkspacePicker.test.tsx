import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const client = {
  me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", name: "Acme", role: "owner" }] })),
  listApps: vi.fn(async () => [
    { appId: "app-1", name: "Marketing", owner: "o", org: "org-1", bundle: "b", package: null, version: null },
  ]),
  createOrg: vi.fn(async () => "org-2"),
  createApp: vi.fn(async () => "app-2"),
  call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
  view: vi.fn(),
};
const signedIn = { client, source: "bundle-hash", after: () => {} };
vi.mock("./sessionContext", () => ({ useSignedIn: () => signedIn }));

const { WorkspacePicker } = await import("./WorkspacePicker");

afterEach(cleanup);

describe("the workspace picker", () => {
  it("lists this app's instances (by the dev bundle) and opens one with its org", async () => {
    const onOpen = vi.fn();
    render(<WorkspacePicker onOpen={onOpen} />);
    fireEvent.click(await screen.findByText("Marketing"));
    expect(onOpen).toHaveBeenCalledWith({ appId: "app-1", org: "org-1" });
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
  });

  it("starts a workspace in a new organization, names it, and opens it", async () => {
    const onOpen = vi.fn();
    render(<WorkspacePicker onOpen={onOpen} />);
    await screen.findByText("Marketing");
    fireEvent.change(screen.getByLabelText("new workspace name"), { target: { value: "Sales" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a new workspace" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ appId: "app-2", org: "org-2" }));
    expect(client.createApp).toHaveBeenCalledWith("Sales", "bundle-hash", { org: "org-2" });
    expect(client.call).toHaveBeenCalledWith("app-2", "setWorkspaceName", { name: "Sales" });
  });
});
