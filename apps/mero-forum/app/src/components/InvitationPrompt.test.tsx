import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CapturedInvitation } from "@calimero-apps/invite";
import { encodeInvite } from "../lib/inviteCodec";
import InvitationPrompt from "./InvitationPrompt";

// The prompt's one decision worth pinning: whether an invitation is acked. Acked
// on a join (or an already-held one) and on a failure no retry can fix; kept on
// one that could pass, so the next load tries again.

const h = vi.hoisted(() => ({
  listener: null as null | ((c: CapturedInvitation) => void),
  admin: {} as Record<string, (...a: unknown[]) => Promise<unknown>>,
}));

vi.mock("@calimero-apps/invite", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calimero-apps/invite")>()),
  onInvitation: (listener: (c: CapturedInvitation) => void) => {
    h.listener = listener;
    return () => {};
  },
}));

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ mero: { admin: h.admin } }),
}));

afterEach(cleanup);

const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

function setup(admin: {
  joinNamespace: () => Promise<unknown>;
  listNamespaces?: () => Promise<unknown>;
}) {
  h.admin = {
    listNamespaces: () => Promise.resolve([]),
    ...admin,
  };
  render(
    <MemoryRouter initialEntries={["/"]}>
      <InvitationPrompt />
      <Routes>
        <Route path="/" element={null} />
        <Route path="/spaces/:id" element={<div data-testid="in-space" />} />
      </Routes>
    </MemoryRouter>,
  );
  const resolve = vi.fn();
  const token = encodeInvite({
    invitation: {
      invitation: { groupId: "ns1" },
      inviter_signature: "sig",
    } as never,
    groupAlias: "Team",
  });
  act(() => h.listener?.({ token, resolve, autoJoin: false }));
  fireEvent.click(screen.getByTestId("invite-accept"));
  return resolve;
}

describe("InvitationPrompt", () => {
  it("acks and enters the space on a join", async () => {
    const resolve = setup({ joinNamespace: () => Promise.resolve() });
    await screen.findByTestId("in-space");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("acks and enters the space when the join failed but the node lists it", async () => {
    const resolve = setup({
      joinNamespace: () => Promise.reject(new Error("The request was aborted")),
      listNamespaces: () => Promise.resolve([{ namespaceId: "ns1" }]),
    });
    await screen.findByTestId("in-space");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("acks a refused invitation and says why", async () => {
    const resolve = setup({
      joinNamespace: () => Promise.reject(httpError(409, "member was removed")),
    });
    await screen.findByText(
      "You can't join this space with this invitation. Ask an admin to invite you again.",
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("invite-prompt")).toBeNull();
  });

  it("keeps the invitation when no one is online to let you in", async () => {
    const resolve = setup({
      joinNamespace: () => Promise.reject(httpError(503, "no peer available")),
    });
    await screen.findByText(/No one in this space is online/);
    await waitFor(() =>
      expect(screen.getByTestId("invite-accept")).not.toBeDisabled(),
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByTestId("invite-prompt")).toBeInTheDocument();
  });
});
