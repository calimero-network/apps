import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { encodeInvite } from "../lib/inviteCodec";
import InvitationPrompt from "./InvitationPrompt";

// The prompt's one decision worth pinning: whether an invitation is acked. Acked
// on a join (or an already-held one) and on a failure no retry can fix; kept on
// one that could pass, so the next load tries again. The link is opened for real
// through mero-react's capture, so "acked" is the store letting it go.

const h = vi.hoisted(() => ({
  admin: {} as Record<string, (...a: unknown[]) => Promise<unknown>>,
}));

vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The prompt redeems through the SESSION-AWARE admin (`useMero().admin`),
  // never the raw client's. The raw one is absent here on purpose: reaching
  // for `mero.admin` would throw, which is the right outcome for a regression.
  useMero: () => ({ admin: h.admin, mero: {} }),
}));

const { peekInvitation, resetInvitationCaptureForTests } =
  await import("@calimero-apps/cloud");

const TOKEN = encodeInvite({
  invitation: {
    invitation: { groupId: "ns1" },
    inviter_signature: "sig",
  } as never,
  groupAlias: "Team",
});

beforeEach(() => {
  resetInvitationCaptureForTests();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
// Explicit: this project does not enable vitest globals, so RTL's auto-cleanup
// never registers and every render would stack in one document.
afterEach(cleanup);

const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

/** Whether the invitation is still held for another attempt. */
const held = () => peekInvitation() !== null;

/** Open the link as the links page would, and (by default) press Join. */
async function setup(
  admin: {
    joinNamespace: () => Promise<unknown>;
    listNamespaces?: () => Promise<unknown>;
  },
  { click = true }: { click?: boolean } = {},
) {
  h.admin = {
    listNamespaces: () => Promise.resolve([]),
    ...admin,
  };
  resetInvitationCaptureForTests();
  window.history.replaceState(null, "", `/?invitation=${TOKEN}`);
  render(
    <MemoryRouter initialEntries={["/"]}>
      <InvitationPrompt />
      <Routes>
        <Route path="/" element={null} />
        <Route path="/streams/:id" element={<div data-testid="in-stream" />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("dialog", { name: "Join “Team”?" });
  if (click) fireEvent.click(screen.getByTestId("invite-accept"));
}

const stage = () =>
  screen.getByTestId("invite-prompt").getAttribute("data-stage");

describe("InvitationPrompt", () => {
  it("asks before joining, naming what the invitation is for", async () => {
    const joinNamespace = vi.fn(() => Promise.resolve());
    await setup({ joinNamespace }, { click: false });
    expect(stage()).toBe("awaiting-confirmation");
    expect(screen.getByTestId("invite-prompt").textContent).toContain(
      "Joining gives you access to the stream and every room in it.",
    );
    expect(screen.getByTestId("invite-decline")).not.toBeNull();
    expect(joinNamespace).not.toHaveBeenCalled();
    expect(held()).toBe(true);
  });

  it("acks on Not now, so the prompt does not come back", async () => {
    const joinNamespace = vi.fn(() => Promise.resolve());
    await setup({ joinNamespace }, { click: false });
    fireEvent.click(screen.getByTestId("invite-decline"));
    expect(screen.queryByTestId("invite-prompt")).toBeNull();
    expect(held()).toBe(false);
    expect(joinNamespace).not.toHaveBeenCalled();
  });

  it("acks, enters the stream and waits for its data on a join", async () => {
    await setup({ joinNamespace: () => Promise.resolve() });
    await screen.findByTestId("in-stream");
    await waitFor(() => expect(stage()).toBe("syncing"));
    expect(held()).toBe(false);
  });

  it("acks and enters the stream when the join failed but the node lists it", async () => {
    await setup({
      joinNamespace: () => Promise.reject(new Error("The request was aborted")),
      listNamespaces: () => Promise.resolve([{ namespaceId: "ns1" }]),
    });
    await screen.findByTestId("in-stream");
    expect(held()).toBe(false);
  });

  it("acks a refused invitation and says why, with no retry", async () => {
    await setup({
      joinNamespace: () => Promise.reject(httpError(409, "member was removed")),
    });
    expect((await screen.findByTestId("invite-error")).textContent).toBe(
      "You can't join this stream with this invitation. Ask an admin to invite you again.",
    );
    expect(held()).toBe(false);
    expect(screen.queryByTestId("invite-retry")).toBeNull();
  });

  it("keeps the invitation when no one is online to let you in", async () => {
    const joinNamespace = vi.fn((): Promise<unknown> =>
      Promise.reject(httpError(503, "no peer available")),
    );
    await setup({ joinNamespace });
    expect((await screen.findByTestId("invite-error")).textContent).toMatch(
      /No one in this stream is online/,
    );
    expect(held()).toBe(true);

    // And the retry really is one: it joins (without asking again), then acks.
    joinNamespace.mockImplementation(() => Promise.resolve());
    fireEvent.click(screen.getByTestId("invite-retry"));
    await screen.findByTestId("in-stream");
    expect(held()).toBe(false);
    expect(joinNamespace).toHaveBeenCalledTimes(2);
  });
});
