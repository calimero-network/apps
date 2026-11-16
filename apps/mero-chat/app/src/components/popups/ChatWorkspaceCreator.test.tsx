import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as null | { status: "signed-in"; client: object; target: object; accountId: string },
  finishWorkspace: vi.fn(),
  addToast: vi.fn(),
  creator: vi.fn(),
  pending: false,
}));

vi.mock("../../api/calimero", () => ({
  APP_PACKAGE: "com.calimero.chat",
  chatSource: () => ({ package: "com.calimero.chat" }),
  passkey: () => ({}),
  useCalimero: () => ({ session: h.session }),
}));
vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    // finishWorkspace is stubbed: the class only has to exist.
  },
}));
vi.mock("../../contexts/ToastContext", () => ({ useToast: () => ({ addToast: h.addToast }) }));
vi.mock("../../utils/finishWorkspace", () => ({ finishWorkspace: h.finishWorkspace }));
vi.mock("@calimero-apps/passkey", () => ({
  reviewRelease: (source: { package: string; version?: string }) => (source.version ? source : null),
  useResolvedSource: (_c: unknown, _a: unknown, base: unknown) => ({ source: base, pending: h.pending }),
}));
vi.mock("@calimero-apps/names", () => ({ lastUsedName: () => "Ada L" }));
vi.mock("@calimero-network/mero-react", () => ({
  CreateWorkspaceDialog: (p: {
    open: boolean;
    release: unknown;
    defaultSelfName: string;
    labels: { nameLabel: string };
    onCreated: (c: { orgId: string; name: string; selfName: string }) => Promise<void>;
  }) => {
    h.creator(p);
    return p.open ? (
      <button onClick={() => void p.onCreated({ orgId: "org-9", name: "Acme", selfName: "Ada" })}>{p.labels.nameLabel}</button>
    ) : null;
  },
}));

import ChatWorkspaceCreator from "./ChatWorkspaceCreator";
import { closeCreateWorkspace, openCreateWorkspace } from "../../utils/createWorkspaceStore";

beforeEach(() => {
  vi.clearAllMocks();
  closeCreateWorkspace();
  h.pending = false;
  h.session = { status: "signed-in", client: {}, target: { kind: "local", nodes: [] }, accountId: "acct" };
});

describe("ChatWorkspaceCreator", () => {
  it("renders nothing while signed out", () => {
    h.session = null;
    render(<ChatWorkspaceCreator />);
    expect(h.creator).not.toHaveBeenCalled();
  });

  it("opens with Chat's wording when asked to", () => {
    render(<ChatWorkspaceCreator />);
    expect(screen.queryByText("Server name")).toBeNull();
    act(() => openCreateWorkspace());
    expect(screen.getByText("Server name")).toBeTruthy();
  });

  it("finishes the workspace under its name and yours, and closes", async () => {
    render(<ChatWorkspaceCreator />);
    act(() => openCreateWorkspace());
    screen.getByText("Server name").click();
    await waitFor(() => expect(h.finishWorkspace).toHaveBeenCalledWith(expect.anything(), "org-9", "Acme", "Ada", h.addToast));
    expect(screen.queryByText("Server name")).toBeNull();
  });

  it("hands the dialog the last used name, and a release or its absence", () => {
    render(<ChatWorkspaceCreator />);
    expect(h.creator.mock.calls[0]![0]).toMatchObject({ defaultSelfName: "Ada L", release: { package: "com.calimero.chat" } });
    h.pending = true;
    render(<ChatWorkspaceCreator />);
    expect(h.creator.mock.calls.at(-1)![0]).toMatchObject({ release: null });
  });
});
