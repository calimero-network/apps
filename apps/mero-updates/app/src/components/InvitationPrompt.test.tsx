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
// one that could pass, so the next load tries again. The link is opened through
// mero-react's real capture, and acking is read back from it.

const h = vi.hoisted(() => ({
  admin: {} as Record<string, (...a: unknown[]) => Promise<unknown>>,
}));

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ admin: h.admin }),
}));

const { peekInvitation, resetInvitationCaptureForTests } =
  await import("@calimero-network/mero-react");

beforeEach(() => {
  resetInvitationCaptureForTests();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

/** Whether the invitation is still held for another attempt. */
const held = () => peekInvitation() !== null;

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
  const token = encodeInvite({
    invitation: {
      invitation: { groupId: "ns1" },
      inviter_signature: "sig",
    } as never,
    groupAlias: "Team",
  });
  window.history.replaceState(null, "", `/?invitation=${token}`);
  render(
    <MemoryRouter initialEntries={["/"]}>
      <InvitationPrompt />
      <Routes>
        <Route path="/" element={null} />
        <Route
          path="/companies/:id"
          element={<div data-testid="in-company" />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId("invite-accept");
  if (click) fireEvent.click(screen.getByTestId("invite-accept"));
}

describe("InvitationPrompt", () => {
  it("asks before joining, naming what the invitation is for", async () => {
    const joinNamespace = vi.fn(() => Promise.resolve());
    await setup({ joinNamespace }, { click: false });
    expect(
      screen.getByRole("dialog", { name: "Join “Team”?" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invite-decline")).toBeInTheDocument();
    expect(joinNamespace).not.toHaveBeenCalled();
    expect(held()).toBe(true);
  });

  it("acks, enters the company and waits for its data", async () => {
    await setup({ joinNamespace: () => Promise.resolve() });
    await screen.findByTestId("in-company");
    await waitFor(() =>
      expect(screen.getByTestId("invite-prompt")).toHaveAttribute(
        "data-stage",
        "syncing",
      ),
    );
    expect(held()).toBe(false);
  });

  it("acks and enters the company when the join failed but the node lists it", async () => {
    await setup({
      joinNamespace: () => Promise.reject(new Error("The request was aborted")),
      listNamespaces: () => Promise.resolve([{ namespaceId: "ns1" }]),
    });
    await screen.findByTestId("in-company");
    expect(held()).toBe(false);
  });

  it("acks a refused invitation and says why, with no retry", async () => {
    await setup({
      joinNamespace: () => Promise.reject(httpError(409, "member was removed")),
    });
    expect(await screen.findByTestId("invite-error")).toHaveTextContent(
      "You can't join this company with this invitation. Ask an admin to invite you again.",
    );
    expect(held()).toBe(false);
    expect(screen.queryByTestId("invite-retry")).toBeNull();
  });

  it("keeps the invitation when no one is online to let you in, and retries", async () => {
    const joinNamespace = vi.fn((): Promise<unknown> =>
      Promise.reject(httpError(503, "no peer available")),
    );
    await setup({ joinNamespace });
    expect(await screen.findByTestId("invite-error")).toHaveTextContent(
      /No one in this company is online/,
    );
    expect(held()).toBe(true);

    // "Try again" joins without asking a second time, then acks.
    joinNamespace.mockImplementation(() => Promise.resolve());
    fireEvent.click(screen.getByTestId("invite-retry"));
    await screen.findByTestId("in-company");
    expect(held()).toBe(false);
    expect(joinNamespace).toHaveBeenCalledTimes(2);
  });
});
