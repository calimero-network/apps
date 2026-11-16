import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  returnFromConsent: vi.fn(),
  consentIntent: vi.fn(() => ({ kind: "leaveOrg", org: "org-1" })),
  addToast: vi.fn(),
  invalidate: vi.fn(),
  clearWorkspaceSelection: vi.fn(),
  clearNamespaceReady: vi.fn(),
  current: "org-1",
}));

vi.mock("../../api/consent", () => ({ returnFromConsent: h.returnFromConsent, consentIntent: h.consentIntent }));
vi.mock("../../api/platform", () => ({ invalidate: h.invalidate }));
vi.mock("../../constants/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../constants/config")>()),
  getGroupId: () => h.current,
  clearWorkspaceSelection: h.clearWorkspaceSelection,
}));
vi.mock("../../utils/session", () => ({ clearNamespaceReady: h.clearNamespaceReady }));
// A hash, so jsdom follows the move to the picker.
vi.mock("../../utils/servedByNode", () => ({ nodeBasename: () => "#/" }));
vi.mock("../../contexts/ToastContext", () => ({ useToast: () => ({ addToast: h.addToast }) }));

import ConsentReturn from "./ConsentReturn";

function back() {
  window.history.replaceState(null, "", "/?request_id=r1&result=approved");
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.consentIntent.mockReturnValue({ kind: "leaveOrg", org: "org-1" });
  h.current = "org-1";
  window.history.replaceState(null, "", "/");
});

const approved = (kind: string, outcome?: Record<string, string>) => ({
  requestId: "r1",
  kind,
  status: "approved",
  decidedAt: 1,
  outcome,
});

describe("ConsentReturn", () => {
  it("does nothing on a load the consent page did not send back", () => {
    render(<ConsentReturn enabled />);
    expect(h.returnFromConsent).not.toHaveBeenCalled();
  });

  it("leaves a return it kept no intent for to the create-workspace dialog", () => {
    back();
    h.consentIntent.mockReturnValue(null as never);
    render(<ConsentReturn enabled />);
    expect(h.returnFromConsent).not.toHaveBeenCalled();
  });

  it("says a decline changed nothing, and a return that is not this tab's request too", async () => {
    back();
    h.returnFromConsent.mockResolvedValue({
      intent: { kind: "createInvite", org: "org-1" },
      result: { requestId: "r1", kind: "createInvite", status: "declined", decidedAt: 1 },
    });
    const { unmount } = render(<ConsentReturn enabled />);
    await waitFor(() => expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Not approved" })));
    unmount();

    back();
    h.returnFromConsent.mockRejectedValue(Object.assign(new Error("mismatch"), { code: "CONSENT_REQUEST_MISMATCH" }));
    render(<ConsentReturn enabled />);
    await waitFor(() =>
      expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Nothing was changed" })),
    );
  });

  it("says an organization admin was made, with that workspace read again", async () => {
    back();
    h.returnFromConsent.mockResolvedValue({
      intent: { kind: "setMemberRole", org: "org-1", account: "acct-bob", role: "admin" },
      result: approved("setMemberRole"),
    });
    render(<ConsentReturn enabled />);
    await waitFor(() =>
      expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Organization admin" })),
    );
    expect(h.invalidate).toHaveBeenCalledWith("org-1");
  });

  it("says someone was removed from the workspace", async () => {
    back();
    h.returnFromConsent.mockResolvedValue({
      intent: { kind: "removeMember", org: "org-1", account: "acct-bob" },
      result: approved("removeMember"),
    });
    render(<ConsentReturn enabled />);
    await waitFor(() => expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Member removed" })));
    expect(h.invalidate).toHaveBeenCalledWith("org-1");
    expect(h.clearWorkspaceSelection).not.toHaveBeenCalled();
  });

  it("takes the new name from the node's result", async () => {
    back();
    h.returnFromConsent.mockResolvedValue({
      intent: { kind: "renameOrg", org: "org-1", name: "Acme" },
      result: approved("renameOrg", { orgId: "org-1", name: "Acme Inc" }),
    });
    render(<ConsentReturn enabled />);
    await waitFor(() =>
      expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Workspace renamed" })),
    );
    expect(JSON.stringify(localStorage)).toContain("Acme Inc");
  });

  it.each([
    ["leaveOrg", "Left workspace"],
    ["deleteOrg", "Workspace deleted"],
  ])("%s: closes the workspace this tab was in, back to the picker", async (kind, title) => {
    back();
    h.returnFromConsent.mockResolvedValue({ intent: { kind, org: "org-1" }, result: approved(kind) });
    render(<ConsentReturn enabled />);
    await waitFor(() => expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({ title })));
    expect(h.clearWorkspaceSelection).toHaveBeenCalled();
    expect(h.clearNamespaceReady).toHaveBeenCalled();
    expect(window.location.hash).toBe("#/login");
  });

  it("leaving another workspace than this tab's keeps this one", async () => {
    back();
    h.current = "org-2";
    h.returnFromConsent.mockResolvedValue({ intent: { kind: "leaveOrg", org: "org-1" }, result: approved("leaveOrg") });
    render(<ConsentReturn enabled />);
    await waitFor(() => expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Left workspace" })));
    expect(h.clearWorkspaceSelection).not.toHaveBeenCalled();
  });
});
