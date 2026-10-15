// This app's wiring into @calimero-apps/invite: the link it shares parses, the
// prompt asks before joining, and accepting joins the namespace and then the
// context the link names, which becomes the active one.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const joinNamespace = vi.fn();
const listNamespaces = vi.fn();
const joinContextById = vi.fn();
const getContextIdentities = vi.fn();
const setContextId = vi.fn();
const setContextIdentity = vi.fn();

vi.mock("../api/adminApi", () => ({
  joinNamespace: (...a: unknown[]) => joinNamespace(...a),
  listNamespaces: (...a: unknown[]) => listNamespaces(...a),
  joinContextById: (...a: unknown[]) => joinContextById(...a),
  getContextIdentities: (...a: unknown[]) => getContextIdentities(...a),
}));
vi.mock("../lib/mero", () => ({
  setContextId: (...a: unknown[]) => setContextId(...a),
  setContextIdentity: (...a: unknown[]) => setContextIdentity(...a),
}));

const { primeInvitationCapture, resetInvitationCaptureForTests } = await import(
  "@calimero-apps/invite"
);
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
    for (const m of [
      joinNamespace,
      listNamespaces,
      joinContextById,
      getContextIdentities,
      setContextId,
      setContextIdentity,
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
    expect(await screen.findByTestId("invite-accept")).toBeInTheDocument();
    expect(screen.getByTestId("invite-decline")).toBeInTheDocument();
    expect(joinNamespace).not.toHaveBeenCalled();
    expect(joinContextById).not.toHaveBeenCalled();
    // The link is cleaned out of the address bar once captured.
    expect(window.location.search).toBe("");
  });

  it("on accept joins the namespace, then the context, and makes it active", async () => {
    joinNamespace.mockResolvedValue(undefined);
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
    expect(screen.getByTestId("invite-context")).toHaveAttribute(
      "data-stage",
      "joined",
    );
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
