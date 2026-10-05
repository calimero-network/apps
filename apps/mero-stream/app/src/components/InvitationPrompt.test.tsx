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
  // The prompt redeems through the SESSION-AWARE admin (`useMero().admin`),
  // never the raw client's. The raw one is absent here on purpose: reaching
  // for `mero.admin` would throw, which is the right outcome for a regression.
  useMero: () => ({ admin: h.admin, mero: {} }),
}));

// Explicit: this project does not enable vitest globals, so RTL's auto-cleanup
// never registers and every render would stack in one document.
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
        <Route path="/streams/:id" element={<div data-testid="in-stream" />} />
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
  it("acks and enters the stream on a join", async () => {
    const resolve = setup({ joinNamespace: () => Promise.resolve() });
    await screen.findByTestId("in-stream");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("acks and enters the stream when the join failed but the node lists it", async () => {
    const resolve = setup({
      joinNamespace: () => Promise.reject(new Error("The request was aborted")),
      listNamespaces: () => Promise.resolve([{ namespaceId: "ns1" }]),
    });
    await screen.findByTestId("in-stream");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("acks a refused invitation and says why", async () => {
    const resolve = setup({
      joinNamespace: () => Promise.reject(httpError(409, "member was removed")),
    });
    await screen.findByText(
      "You can't join this stream with this invitation. Ask an admin to invite you again.",
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("invite-prompt")).toBeNull();
  });

  it("keeps the invitation when no one is online to let you in", async () => {
    const resolve = setup({
      joinNamespace: () => Promise.reject(httpError(503, "no peer available")),
    });
    await screen.findByText(/No one in this stream is online/);
    await waitFor(() =>
      expect(
        (screen.getByTestId("invite-accept") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.queryByTestId("invite-prompt")).not.toBeNull();
  });
});
