/**
 * Creating the workspace the extension named, in its window. On Calimero
 * Cloud the node approves a new organization on its own page: in a pop-up the
 * page may open only from a click, else by leaving and coming back.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Created = { orgId: string; name: string; selfName: string };
const flow = {
  ready: true,
  phase: "idle" as "idle" | "approving" | "redirect" | "creating",
  code: null as string | null,
  error: null as string | null,
  create: vi.fn(),
  cancel: vi.fn(),
  proceed: vi.fn(),
  reopen: vi.fn(),
  clearError: vi.fn(),
};
let onCreated: ((c: Created) => void) | null = null;
let onResumed: ((c: Created) => void) | null = null;

vi.mock("@calimero-network/mero-react", () => ({
  MeroProvider: ({ children }: { children: React.ReactNode }) => children,
  useCreateWorkspace: (o: { onCreated: (c: Created) => void }) => {
    onCreated = o.onCreated;
    return flow;
  },
  useCreateWorkspaceResume: (o: { onCreated: (c: Created) => void }) => {
    onResumed = o.onCreated;
    return { message: null };
  },
}));
const createWorkspaceInNewOrg = vi.fn(async () => ({ appId: "a1", org: "o1" }));
vi.mock("./lib/orgs", () => ({ createWorkspaceInNewOrg: (...a: unknown[]) => createWorkspaceInNewOrg(...(a as [])) }));
vi.mock("@calimero-apps/names", () => ({ lastUsedName: () => "", setOrgName: vi.fn(async () => undefined) }));
vi.mock("./sessionContext", () => ({
  useSignedIn: () => ({ client: { session: {} }, source: {}, accountId: "acc", passkey: () => ({}), after: () => undefined }),
}));

import { CreateNamedWorkspace } from "./CreateNamedWorkspace";

function setup() {
  const onDone = vi.fn();
  const view = render(<CreateNamedWorkspace request={{ name: "blue", self: "Eve" }} onDone={onDone} />);
  return { onDone, rerender: () => view.rerender(<CreateNamedWorkspace request={{ name: "blue", self: "Eve" }} onDone={onDone} />) };
}

beforeEach(() => {
  Object.assign(flow, { ready: true, phase: "idle", code: null, error: null });
  for (const f of [flow.create, flow.cancel, flow.proceed, flow.reopen, flow.clearError, createWorkspaceInNewOrg]) f.mockClear();
});
afterEach(cleanup);

describe("creating the extension's workspace in its window", () => {
  it("starts only on a click, so the browser lets the node's approval window open", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Create “blue”" })).toBeTruthy();
    expect(flow.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("extension-create-start"));
    expect(flow.create).toHaveBeenCalledWith("blue", "Eve");
  });

  it("while the node's window is open: the code to check, open it again, or cancel", () => {
    const { rerender } = setup();
    fireEvent.click(screen.getByTestId("extension-create-start"));
    Object.assign(flow, { phase: "approving", code: "K7-42" });
    rerender();
    expect(screen.getByTestId("consent-code").textContent).toBe("K7-42");
    fireEvent.click(screen.getByRole("button", { name: "Open the window again" }));
    expect(flow.reopen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(flow.cancel).toHaveBeenCalled();
  });

  it("where no window can open: the code, and Continue goes to the node's page", () => {
    const { rerender } = setup();
    fireEvent.click(screen.getByTestId("extension-create-start"));
    Object.assign(flow, { phase: "redirect", code: "K7-42" });
    rerender();
    fireEvent.click(screen.getByRole("button", { name: "Continue to your node" }));
    expect(flow.proceed).toHaveBeenCalled();
  });

  it("approved: adds Sylence to the new organization and closes the window", async () => {
    const { onDone } = setup();
    fireEvent.click(screen.getByTestId("extension-create-start"));
    act(() => onCreated!({ orgId: "o1", name: "blue", selfName: "Eve" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(createWorkspaceInNewOrg).toHaveBeenCalledTimes(1);
    expect(createWorkspaceInNewOrg.mock.calls[0]).toEqual(expect.arrayContaining(["blue", "o1"]));
  });

  it("back from the node's page: finishes what was approved there, once", async () => {
    const { onDone } = setup();
    act(() => {
      onResumed!({ orgId: "o2", name: "blue", selfName: "Eve" });
      onResumed!({ orgId: "o2", name: "blue", selfName: "Eve" });
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(createWorkspaceInNewOrg).toHaveBeenCalledTimes(1);
  });
});
