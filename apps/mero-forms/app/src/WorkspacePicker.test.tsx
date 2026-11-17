import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withRoutes } from "@calimero-apps/connect/testing";

const MARKETING = { appId: "app-1", name: "Marketing", owner: "o", org: "org-1", bundle: "b", package: null, version: null };
const ME = { orgs: [{ orgId: "org-1", name: "Acme", role: "owner" }] };
const client = withRoutes({
  session: { accountId: "acct-me" },
  me: vi.fn(async (): Promise<Record<string, unknown>> => ME),
  getOrg: vi.fn(async (_org: string): Promise<Record<string, unknown>> => ({ members: { "acct-me": "owner" } })),
  listApps: vi.fn(async (_f?: { bundle?: string }): Promise<Array<Record<string, unknown>>> => [MARKETING]),
  createOrg: vi.fn(async () => "org-2"),
  createApp: vi.fn(async () => "app-2"),
  call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
  view: vi.fn(),
});
const signedIn = { client, accountId: "acct-me", source: "bundle-hash", passkey: () => ({}), after: () => {} };
vi.mock("./sessionContext", () => ({ useSignedIn: () => signedIn }));

// The shared dialog is mero-react's to test: here only what the app hands it and does after.
vi.mock("@calimero-network/mero-react", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<object>()),
    CreateWorkspaceDialog: (p: {
      open: boolean;
      defaultSelfName?: string;
      release: unknown;
      labels?: { title?: string };
      onCreated: (w: { orgId: string; name: string; selfName: string }) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "create-dialog" },
            createElement("h2", { "data-testid": "create-title" }, p.labels?.title),
            createElement("p", { "data-testid": "create-self" }, p.defaultSelfName),
            createElement("pre", { "data-testid": "create-release" }, JSON.stringify(p.release)),
            createElement(
              "button",
              { "data-testid": "create-done", onClick: () => p.onCreated({ orgId: "org-new", name: "Sales", selfName: "Alice" }) },
              "done",
            ),
          )
        : null,
  };
});

const { WorkspacePicker } = await import("./WorkspacePicker");

afterEach(() => {
  cleanup();
  client.me.mockImplementation(async () => ME);
  client.listApps.mockImplementation(async () => [MARKETING]);
  client.getOrg.mockImplementation(async () => ({ members: { "acct-me": "owner" } }));
  client.createApp.mockClear();
  client.createOrg.mockClear();
});

describe("the workspace picker", () => {
  it("lists this app's instances (by the dev bundle) and opens one with its org", async () => {
    const onOpen = vi.fn();
    render(<WorkspacePicker onOpen={onOpen} />);
    fireEvent.click(await screen.findByText("Marketing"));
    expect(onOpen).toHaveBeenCalledWith({ appId: "app-1", org: "org-1" });
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
  });

  it("starts a workspace in a new organization through the shared dialog, names it, and opens it", async () => {
    const onOpen = vi.fn();
    render(<WorkspacePicker onOpen={onOpen} />);
    await screen.findByText("Marketing");
    expect(screen.queryByLabelText("new workspace name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start a new workspace" }));
    expect((await screen.findByTestId("create-title")).textContent).toBe("New workspace");
    expect(JSON.parse(screen.getByTestId("create-release").textContent ?? "null")).toEqual({ package: "com.calimero.mero-forms" });
    fireEvent.click(screen.getByTestId("create-done"));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ appId: "app-2", org: "org-new" }));
    expect(client.createApp).toHaveBeenCalledWith("Sales", "bundle-hash", { org: "org-new" });
    expect(client.call).toHaveBeenCalledWith("app-2", "setWorkspaceName", { name: "Sales" });
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it("starts a workspace in an org the account is in without the dialog", async () => {
    const onOpen = vi.fn();
    render(<WorkspacePicker onOpen={onOpen} />);
    await screen.findByText("Marketing");
    fireEvent.change(await screen.findByLabelText("organization"), { target: { value: "org-1" } });
    fireEvent.change(screen.getByLabelText("new workspace name"), { target: { value: "Sales" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a new workspace" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ appId: "app-2", org: "org-1" }));
    expect(screen.queryByTestId("create-dialog")).toBeNull();
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it("offers only the organizations this account may add a workspace in (B8)", async () => {
    client.me.mockResolvedValue({
      orgs: [
        { orgId: "org-1", name: "Acme", role: "owner" },
        { orgId: "org-3", name: "Partner", role: "member" },
      ],
    });
    client.listApps.mockImplementation(async () => [MARKETING, { ...MARKETING, appId: "app-3", name: "Partners", org: "org-3" }]);
    // In Partner, a plain member with the node's default capabilities: no CREATE_APP.
    client.getOrg.mockImplementation(async (org: string) =>
      org === "org-3" ? { members: { "acct-me": "member" } } : { members: { "acct-me": "owner" } },
    );
    render(<WorkspacePicker onOpen={vi.fn()} />);
    expect((await screen.findByTestId("workspace-ask-owner")).textContent).toMatch(/Only an owner or admin/);
    const options = [...(screen.getByLabelText("organization") as HTMLSelectElement).options].map((o) => o.text);
    expect(options).toEqual(["In a new organization", "In Acme"]);
  });

  // The account of the bug: in `overworld`, which holds only a Mero Blocks world.
  it("does not offer an org made for another app in the start form; connects it on request", async () => {
    const blocks = { appId: "w1", name: "overworld", owner: "o", org: "ow", bundle: "blocks", package: "com.calimero.mero-blocks", version: null };
    client.me.mockImplementation(async () => ({ orgs: [{ orgId: "ow", name: "overworld", role: "owner" }] }));
    client.listApps.mockImplementation(async (f?: { bundle?: string }) => (f?.bundle ? [] : [blocks]));
    const onOpen = vi.fn();
    render(<WorkspacePicker onOpen={onOpen} />);
    await screen.findByText(/No workspaces yet/);
    await waitFor(() => expect(client.listApps).toHaveBeenCalled());
    expect(screen.queryByLabelText("organization")).toBeNull();
    fireEvent.click(screen.getByTestId("connect-existing-org"));
    const choice = await screen.findByTestId("connect-org-ow");
    expect(choice.textContent).toContain("Hyperfeed Blocks: overworld");
    fireEvent.click(choice);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ appId: "app-2", org: "ow" }));
    expect(client.createApp).toHaveBeenCalledWith("overworld", "bundle-hash", { org: "ow" });
    expect(client.createOrg).not.toHaveBeenCalled();
  });
});
