// This app's wiring into mero-react's invitation dialog: the link it shares
// parses, the dialog asks before joining, and accepting joins the namespace and
// then the context the link names, which becomes the active one. The dialog
// holds "Syncing…" until that context's state has answered a read.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const joinNamespace = vi.fn();
const listNamespaces = vi.fn();
const joinContextById = vi.fn();
const getContextIdentities = vi.fn();
const setContextId = vi.fn();
const setContextIdentity = vi.fn();
const rpcRaw = vi.fn();

vi.mock("../api/adminApi", () => ({
  joinNamespace: (...a: unknown[]) => joinNamespace(...a),
  listNamespaces: (...a: unknown[]) => listNamespaces(...a),
  joinContextById: (...a: unknown[]) => joinContextById(...a),
  getContextIdentities: (...a: unknown[]) => getContextIdentities(...a),
}));
vi.mock("../api/rpc", () => ({
  rpcRaw: (...a: unknown[]) => rpcRaw(...a),
}));
vi.mock("../lib/mero", () => ({
  setContextId: (...a: unknown[]) => setContextId(...a),
  setContextIdentity: (...a: unknown[]) => setContextIdentity(...a),
}));

const { peekInvitation, primeInvitationCapture, resetInvitationCaptureForTests } =
  await import("@calimero-apps/cloud");
const { APP_SLUG, inviteLink } = await import("../lib/invite");
const { InvitationPrompt } = await import("./InvitationPrompt");

const NS = "ab".repeat(32);
const CTX = "cd".repeat(32);
const INVITATION = {
  invitation: { group_id: [1, 2] },
  inviterSignature: "sig",
};

function open(link: string): void {
  window.history.replaceState(null, "", `/${new URL(link).search}`);
  primeInvitationCapture("scaffolding-e2e-test", { slug: APP_SLUG });
}

describe("InvitationPrompt", () => {
  beforeEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
    sessionStorage.clear();
    for (const m of [
      joinNamespace,
      listNamespaces,
      joinContextById,
      getContextIdentities,
      setContextId,
      setContextIdentity,
      rpcRaw,
    ]) {
      m.mockReset();
    }
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
  });

  it("asks before joining, and joins nothing until accepted", async () => {
    open(
      inviteLink({ namespaceId: NS, invitation: INVITATION, contextId: CTX }),
    );
    render(<InvitationPrompt onContextJoined={vi.fn()} />);
    expect(
      await screen.findByRole("dialog", { name: "Join this namespace?" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invite-accept")).toBeInTheDocument();
    expect(screen.getByTestId("invite-decline")).toBeInTheDocument();
    expect(joinNamespace).not.toHaveBeenCalled();
    expect(joinContextById).not.toHaveBeenCalled();
    // The link is cleaned out of the address bar once captured.
    expect(window.location.search).toBe("");
  });

  it("on accept joins the namespace, then the context, makes it active, and waits for its state", async () => {
    joinNamespace.mockResolvedValue(undefined);
    // Not readable at first: the context's state has not reached this node.
    rpcRaw
      .mockResolvedValueOnce({ error: { code: -1, message: "uninitialized" } })
      .mockResolvedValue({ result: { output: 0 } });
    listNamespaces.mockResolvedValue([{ namespaceId: NS }]);
    joinContextById.mockResolvedValue(undefined);
    getContextIdentities.mockResolvedValue(["ef".repeat(32)]);
    const onContextJoined = vi.fn();
    open(
      inviteLink({ namespaceId: NS, invitation: INVITATION, contextId: CTX }),
    );
    render(<InvitationPrompt onContextJoined={onContextJoined} />);

    fireEvent.click(await screen.findByTestId("invite-accept"));

    await waitFor(() => expect(onContextJoined).toHaveBeenCalledWith(CTX));
    expect(joinNamespace).toHaveBeenCalledWith(NS, INVITATION);
    expect(joinContextById).toHaveBeenCalledWith(CTX);
    expect(setContextId).toHaveBeenCalledWith(CTX);
    expect(setContextIdentity).toHaveBeenCalledWith("ef".repeat(32));
    expect(peekInvitation()).toBeNull();
    expect(screen.getByTestId("invite-prompt")).toHaveAttribute(
      "data-stage",
      "syncing",
    );

    // Once a read of the context answers, empty or not, the join is done.
    await waitFor(
      () =>
        expect(screen.getByTestId("invite-prompt")).toHaveAttribute(
          "data-stage",
          "ready",
        ),
      { timeout: 4_000 },
    );
    expect(rpcRaw).toHaveBeenCalledWith("len", {}, CTX);
  });

  it("keeps the invitation when the context cannot be joined, and retries it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      joinNamespace.mockResolvedValue(undefined);
      listNamespaces.mockResolvedValue([{ namespaceId: NS }]);
      joinContextById.mockRejectedValue(new Error("not a member yet"));
      rpcRaw.mockResolvedValue({ result: { output: 0 } });
      getContextIdentities.mockResolvedValue(["ef".repeat(32)]);
      const onContextJoined = vi.fn();
      open(
        inviteLink({ namespaceId: NS, invitation: INVITATION, contextId: CTX }),
      );
      render(<InvitationPrompt onContextJoined={onContextJoined} />);

      fireEvent.click(await screen.findByTestId("invite-accept"));
      await vi.advanceTimersByTimeAsync(100_000);

      expect(await screen.findByTestId("invite-error")).toHaveTextContent(
        /Joined the namespace, but not context .*not a member yet/,
      );
      expect(peekInvitation()).not.toBeNull();
      expect(onContextJoined).not.toHaveBeenCalled();

      joinContextById.mockResolvedValue(undefined);
      fireEvent.click(screen.getByTestId("invite-retry"));
      await waitFor(() => expect(onContextJoined).toHaveBeenCalledWith(CTX));
      expect(peekInvitation()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a desktop deep link for this app, and drops one for another app", async () => {
    const handlers = new Set<(payload: unknown) => void>();
    const w = window as unknown as Record<string, unknown>;
    w["__calimero_platform__"] = {
      version: 1,
      capabilities: ["deepLink"],
      invoke: async () => null,
      on(event: string, handler: (payload: unknown) => void) {
        if (event === "deep-link") handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
    try {
      primeInvitationCapture("scaffolding-e2e-test", { slug: APP_SLUG });
      render(<InvitationPrompt onContextJoined={vi.fn()} />);
      const query = new URL(
        inviteLink({ namespaceId: NS, invitation: INVITATION, contextId: CTX }),
      ).search;
      const fire = (slug: string) => {
        for (const h of handlers) h({ raw: `calimero://${slug}/join${query}` });
      };

      fire("com.calimero.not-this-app");
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByTestId("invite-accept")).toBeNull();

      fire(APP_SLUG);
      expect(await screen.findByTestId("invite-accept")).toBeInTheDocument();
      expect(joinNamespace).not.toHaveBeenCalled();
    } finally {
      delete w["__calimero_platform__"];
    }
  });
});
