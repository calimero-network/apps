/**
 * The shared invite store on the real session hook and screens, with a mocked
 * CalimeroClient: a sign-up refused for its invite (B2), the joined org at
 * sign-up and from a redemption (B3, B4), the whole pending invite at a
 * sign-up's join (B10), and the invite dropped on sign-out or another
 * account (B7).
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CalimeroError,
  LoginRequired,
  QuotaExceeded,
  SignUpRefused,
  UnavailableError,
  type CalimeroClient,
  type PasskeyProvider,
  type SignUpPolicy,
} from "@calimero-network/mero-js";
import {
  SIGN_UP_INVITE_ONLY,
  SPENT_INVITE_COPY,
  createInviteStore,
  type InviteStore,
  type KeyValueStorage,
} from "@calimero-apps/connect";

import { JoinInvitation, SignInPanel } from "./Onboarding";
import {
  usePasskeySession,
  usePendingInvite,
  type InviteRefused,
  type JoinedAtSignUp,
  type PasskeySessionOptions,
  type SessionDeps,
} from "./session";
import { withRoutes } from "@calimero-apps/connect/testing";

const LISTING = { name: "Test App", description: "A test.", package: "com.example.test", dir: "test", dev: true };
// The cluster's name and the four-character tag its passkeys' names carry (GET /sign-up).
const CLUSTER = { cluster: "eu-shared-1", passkeyTag: "k7q2" };
const OPEN: SignUpPolicy = { policy: "open", orgInvites: true, signUpInvites: true, inviteRequired: false, ...CLUSTER };
const INVITE: SignUpPolicy = { policy: "invite", orgInvites: true, signUpInvites: true, inviteRequired: true, ...CLUSTER };
const LINK = "https://a.example/?invite=tok-1&org=org-1&team=team-1&to=%2Fdeals%2F7";

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** A client whose sign-up goes as mero-js's does: `begin` (may refuse), `create`, `finish` (may refuse), approve. */
function fakeClient(
  { refuseAt, refusal, policy = OPEN }: { refuseAt?: "begin" | "finish"; refusal?: Error; policy?: SignUpPolicy } = {},
) {
  const client = {
    session: null as null | { accountId: string },
    signIn: vi.fn(async (_p: PasskeyProvider) => {
      client.session = { accountId: "acct-in" };
      return client.session;
    }),
    signUp: vi.fn(async (passkey: PasskeyProvider, _name: string, opts?: { invite?: string }) => {
      const refuse = refusal ?? new SignUpRefused("sign-up refused: the invite has expired");
      if (opts?.invite && refuseAt === "begin") throw refuse;
      await passkey.create({});
      if (opts?.invite && refuseAt === "finish") throw refuse;
      await passkey.get(new Uint8Array(), "rp");
      client.session = { accountId: "acct-new" };
      return client.session;
    }),
    signOut: vi.fn(async () => {
      client.session = null;
    }),
    signUpPolicy: vi.fn(async () => policy),
    me: vi.fn(async () => ({ orgs: [{ orgId: "org-1" }] })),
    redeemInvite: vi.fn(async () => ({ org: "org-1" })),
    useSession: vi.fn(),
  };
  return withRoutes(client);
}

function deps(client: ReturnType<typeof fakeClient>, storage = memoryStorage()): SessionDeps {
  return {
    env: { DEV: true },
    makeClient: async () => client as unknown as CalimeroClient,
    passkey: () => ({ create: vi.fn(async () => ({}) as never), get: vi.fn(async () => ({}) as never) }),
    storage,
  };
}

function storeWithLink(): InviteStore {
  const store = createInviteStore("test-app", { storage: memoryStorage() });
  store.capture({ href: LINK }, { history: null });
  return store;
}

function Screen({ d, options }: { d: SessionDeps; options: PasskeySessionOptions }) {
  const api = usePasskeySession("test-app", d, options);
  if (api.session.status === "signed-in") return <p data-testid="status">signed-in {api.session.accountId}</p>;
  return <SignInPanel api={api} appName="Test App" joining="the team" listing={LISTING} />;
}

afterEach(cleanup);

describe("a sign-up refused because of its invite (B2)", () => {
  it("drops the token, says why, and creates the account without it on the next click", async () => {
    const client = fakeClient({ refuseAt: "begin" });
    const invites = storeWithLink();
    const refused = vi.fn<(r: InviteRefused) => void>();
    render(<Screen d={deps(client)} options={{ invites, onJoinedAtSignUp: () => {}, onInviteRefused: refused }} />);

    fireEvent.click(await screen.findByTestId("signup-passkey"));
    const error = await screen.findByTestId("signin-error");
    expect(error.textContent).toMatch(/expired.*ask whoever sent it for a new one/);
    expect(error.textContent).toMatch(/create your account without it/i);
    // Refused at `begin`, before the browser made a passkey: none is left behind.
    expect(error.textContent).not.toMatch(/passkey your browser made/i);
    expect(invites.pending()).toBeNull();
    expect(refused).toHaveBeenCalledWith({ reason: "expired-invite", token: "tok-1", passkeyMade: false });
    // Not "You're invited" any more: the invite is gone.
    expect(screen.queryByText("You're invited")).toBeNull();

    const without = screen.getByTestId("signup-without-invite");
    expect(without.textContent).toBe("Create your account without the invite");
    fireEvent.click(without);
    await screen.findByTestId("status");
    expect(client.signUp).toHaveBeenCalledTimes(2);
    expect(client.signUp.mock.calls[1]).toEqual([expect.anything(), ""]);
  });

  it("never sends a refused token again, even when the app keeps handing it over", async () => {
    const client = fakeClient({ refuseAt: "begin", refusal: new SignUpRefused("sign-up refused: this invite was used up, revoked or never existed") });
    const d = deps(client);
    const { result } = renderHook(() =>
      usePasskeySession("test-app", d, { invite: () => "tok-dead", onJoinedAtSignUp: () => {} }),
    );
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    await act(() => result.current.signUp());
    expect(result.current.inviteRefused).toEqual({ reason: "unknown-invite", token: "tok-dead", passkeyMade: false });
    expect(result.current.hasInvite).toBe(false);
    await act(() => result.current.signUp());
    expect(client.signUp.mock.calls.map((c) => (c[2] as { invite?: string } | undefined)?.invite)).toEqual([
      "tok-dead",
      undefined,
    ]);
    expect(result.current.session.status).toBe("signed-in");
  });

  it("says so when the refusal came after the browser made the passkey", async () => {
    const client = fakeClient({ refuseAt: "finish" });
    const invites = storeWithLink();
    render(<Screen d={deps(client)} options={{ invites, onJoinedAtSignUp: () => {} }} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    const error = await screen.findByTestId("signin-error");
    expect(error.textContent).toMatch(/passkey your browser made.*no account/i);
  });

  it("on an invite-only cluster offers no account without it, and says why", async () => {
    const client = fakeClient({ refuseAt: "begin", policy: INVITE });
    const invites = storeWithLink();
    render(<Screen d={deps(client)} options={{ invites, onJoinedAtSignUp: () => {} }} />);
    await waitFor(() => expect(client.signUpPolicy).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    const error = await screen.findByTestId("signin-error");
    expect(error.textContent).not.toMatch(/without it/i);
    expect(screen.queryByTestId("signup-without-invite")).toBeNull();
    expect(screen.getByTestId("signup-unavailable").textContent).toBe(SIGN_UP_INVITE_ONLY);
  });

  it.each([
    ["the cluster unavailable", new UnavailableError("UNAVAILABLE", "no leader")],
    ["a rate limit", new QuotaExceeded("slow down")],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("keeps the token on %s", async (_, refusal) => {
    const client = fakeClient({ refuseAt: "begin", refusal });
    const invites = storeWithLink();
    const d = deps(client);
    const { result } = renderHook(() => usePasskeySession("test-app", d, { invites, onJoinedAtSignUp: () => {} }));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    await act(() => result.current.signUp());
    expect(result.current.inviteRefused ?? null).toBeNull();
    expect(invites.token()).toBe("tok-1");
    expect(result.current.hasInvite).toBe(true);
  });
});

describe("joining at sign-up hands the app the whole pending invite (B10)", () => {
  it("passes what the link pointed at, then drops the token", async () => {
    const client = fakeClient();
    const invites = storeWithLink();
    const onJoined = vi.fn<(j: JoinedAtSignUp, p: unknown) => void>();
    render(<Screen d={deps(client)} options={{ invites, onJoinedAtSignUp: onJoined }} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await screen.findByTestId("status");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" });
    expect(onJoined).toHaveBeenCalledWith(
      { invite: "tok-1", org: "org-1" },
      { token: "tok-1", org: "org-1", team: "team-1", doc: null, route: "/deals/7", extra: {} },
    );
    expect(invites.pending()).toBeNull();
  });
});

describe("the pending invite and who is signed in (B7)", () => {
  it("is bound to the cluster the session connects to", async () => {
    const storage = memoryStorage();
    const invites = createInviteStore("test-app", { storage });
    invites.capture({ href: LINK }, { history: null });
    const d = deps(fakeClient());
    const { result } = renderHook(() => usePasskeySession("test-app", d, { invites }));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    expect(storage.getItem("calimero-invite:test-app")).toBeNull();
    expect(invites.token()).toBe("tok-1");
  });

  it("is dropped when the person signs out", async () => {
    const invites = storeWithLink();
    const d = deps(fakeClient());
    const { result } = renderHook(() => usePasskeySession("test-app", d, { invites }));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    await act(() => result.current.signIn());
    expect(invites.token()).toBe("tok-1");
    await act(() => result.current.signOut());
    expect(invites.token()).toBeNull();
    expect(result.current.hasInvite).toBe(false);
  });

  it("is dropped when another account than the one it was held for signs in", async () => {
    const invites = storeWithLink();
    invites.signedIn("acct-someone-else");
    const d = deps(fakeClient());
    const { result } = renderHook(() => usePasskeySession("test-app", d, { invites }));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    await act(() => result.current.signIn());
    await waitFor(() => expect(invites.token()).toBeNull());
  });

  it("usePendingInvite follows the store", async () => {
    const invites = storeWithLink();
    const { result } = renderHook(() => usePendingInvite(invites));
    expect(result.current?.route).toBe("/deals/7");
    act(() => invites.drop());
    expect(result.current).toBeNull();
  });
});

describe("JoinInvitation says which org (B3) and keeps a live token (B6)", () => {
  function props(client: ReturnType<typeof fakeClient>, over: Record<string, unknown> = {}) {
    return {
      client: client as unknown as CalimeroClient,
      token: "tok-1",
      org: null as string | null,
      appName: "Test App",
      joining: "the team",
      drop: vi.fn(),
      after: () => {},
      onJoined: vi.fn(),
      onClose: vi.fn(),
      ...over,
    };
  }

  it("onJoined names the org the redemption joined", async () => {
    const client = fakeClient();
    client.redeemInvite.mockResolvedValueOnce({ org: "org-redeemed" });
    const p = props(client);
    render(<JoinInvitation {...p} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(p.onJoined).toHaveBeenCalledWith({ org: "org-redeemed" }));
    expect(p.drop).toHaveBeenCalled();
  });

  it("onJoined falls back to the org the link named", async () => {
    const client = fakeClient();
    client.redeemInvite.mockResolvedValueOnce({} as never);
    client.me.mockResolvedValueOnce({ orgs: [] });
    const p = props(client, { org: "org-link" });
    render(<JoinInvitation {...p} />);
    const join = await screen.findByTestId("invitation-join");
    await waitFor(() => expect((join as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(join);
    await waitFor(() => expect(p.onJoined).toHaveBeenCalledWith({ org: "org-link" }));
  });

  it("an account already in the org is told so, and Continue names that org", async () => {
    const client = fakeClient();
    const p = props(client, { org: "org-1" });
    render(<JoinInvitation {...p} />);
    fireEvent.click(await screen.findByTestId("invitation-continue"));
    expect(p.onClose).toHaveBeenCalledWith({ member: "org-1" });
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it("Not now names no org", async () => {
    const p = props(fakeClient());
    render(<JoinInvitation {...p} />);
    fireEvent.click(await screen.findByTestId("invitation-dismiss"));
    expect(p.onClose).toHaveBeenCalledWith({ member: null });
  });

  it("by default drops only an invite the node says is done", async () => {
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new QuotaExceeded("slow down"));
    client.redeemInvite.mockRejectedValueOnce(new LoginRequired("session expired"));
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(400, "REJECTED", "this invite has expired"));
    const p = props(client);
    render(<JoinInvitation {...p} />);

    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toMatch(/wait a moment.*invite is kept/i);
    fireEvent.click(screen.getByTestId("invitation-join"));
    await waitFor(() => expect(screen.getByTestId("invitation-error").textContent).toMatch(/sign in again/i));
    expect(p.drop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-outcome")).textContent).toContain(SPENT_INVITE_COPY);
    expect(p.drop).toHaveBeenCalledTimes(1);
  });
});
