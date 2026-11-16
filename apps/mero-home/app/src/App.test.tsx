import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { CalimeroError } from "@calimero-network/mero-js";
import { createInviteStore } from "@calimero-apps/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

afterEach(cleanup);

const accept = vi.hoisted(() => ({ props: null as null | Record<string, (...a: never[]) => void> & Record<string, unknown> }));

vi.mock("./session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session")>()),
  useSession: () => ({
    session: { status: "signed-in", client: {}, accountId: "acct-me", target: { kind: "local", nodes: [] } },
    store: null,
    signOut: vi.fn(),
  }),
}));
vi.mock("./Home", () => ({ Home: (p: { initialOrg: string | null }) => createElement("p", { "data-testid": "home" }, p.initialOrg ?? "none") }));
vi.mock("@calimero-network/mero-react", () => ({
  AcceptInviteDialog: (p: never) => {
    accept.props = p;
    return null;
  },
}));

function open(pending: { token: string; org?: string }) {
  const store = createInviteStore("mero-home", { storage: undefined });
  store.put(pending as never);
  render(<App deps={{ passkey: () => ({}) } as never} storage={undefined} invites={store} initialOrg={null} />);
  return store;
}

describe("accepting an invitation", () => {
  it("opens the dialog with the link's org, and keeps the token for a lapsed session", () => {
    const store = open({ token: "tok", org: "acme" });
    expect(accept.props).toMatchObject({ open: true, token: "tok", org: "acme", labels: { noun: "organization" } });
    accept.props!.onError!(new CalimeroError(401, "UNAUTHORIZED", "session expired") as never);
    expect(store.token()).toBe("tok");
  });

  it("drops a spent token when the node says the invite is done", () => {
    const store = open({ token: "tok", org: "acme" });
    act(() => accept.props!.onError!(new CalimeroError(400, "REJECTED", "this invite has expired") as never));
    expect(store.token()).toBeNull();
    // The dialog stays up to say so until the person continues.
    expect(accept.props).toMatchObject({ open: true, token: "tok" });
  });

  it("joining (or continuing as a member) drops the invite and lands in the org", () => {
    const store = open({ token: "tok", org: "acme" });
    expect(screen.queryByTestId("home")).toBeNull();
    act(() => accept.props!.onJoined!({ org: "acme" } as never));
    expect(store.token()).toBeNull();
    expect(screen.getByTestId("home").textContent).toBe("acme");
  });

  it("Not now drops the invite and shows Home", () => {
    const store = open({ token: "tok" });
    act(() => accept.props!.onClose!());
    expect(store.token()).toBeNull();
    expect(screen.getByTestId("home").textContent).toBe("none");
  });
});
