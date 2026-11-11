/**
 * Every state a visitor reaches the sign-in in, on the real session hook and
 * a mocked CalimeroClient: an invite and no account here, an invite and an
 * account, no invite, the two-prompt sign-up, and the failures in between.
 */
import { SIGN_UP_NOT_FINISHED } from "./signUpFlow";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PasskeyUnknownHere,
  SignUpRefused,
  UnavailableError,
  type CalimeroClient,
  type PasskeyProvider,
  type SignUpPolicy,
} from "@calimero-network/mero-js";
import { SIGN_UP_INVITE_ONLY, resolveTarget, type KeyValueStorage } from "@calimero-apps/connect";

import { InvitationSignIn, JoinInvitation, SignInPanel } from "./Onboarding";
import { SIGN_UP_READY, SIGN_UP_TWO_PROMPTS, noAccountCopy } from "./PasskeySignIn";
import {
  accountHintKey,
  usePasskeySession,
  type JoinedAtSignUp,
  type SessionDeps,
} from "./session";
import { withRoutes } from "@calimero-apps/connect/testing";

const LISTING = { name: "Test App", description: "A test.", package: "com.example.test", dir: "test", dev: true };
const DEV_ENV = { DEV: true };

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage {
  const m = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function named(name: string, message = name): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

// The cluster's name and the four-character tag its passkeys' names carry (GET /sign-up).
const CLUSTER = { cluster: "eu-shared-1", passkeyTag: "k7q2" };
const OPEN: SignUpPolicy = { policy: "open", orgInvites: true, signUpInvites: true, inviteRequired: false, ...CLUSTER };
const INVITE: SignUpPolicy = { policy: "invite", orgInvites: true, signUpInvites: true, inviteRequired: true, ...CLUSTER };

/**
 * A client whose sign-up drives the passkey it is given the way mero-js
 * does: `create`, then (core's 412) `get` to approve the new account.
 */
function fakeClient(over: Partial<Record<string, unknown>> = {}, policy: SignUpPolicy = OPEN) {
  const client = {
    session: null as null | { accountId: string },
    signIn: vi.fn(async (_passkey: PasskeyProvider) => {
      client.session = { accountId: "acct-in" };
      return client.session;
    }),
    signUp: vi.fn(async (passkey: PasskeyProvider, _name: string, _opts?: { invite?: string }) => {
      await passkey.create({});
      await passkey.get(new Uint8Array(), "rp");
      client.session = { accountId: "acct-new" };
      return client.session;
    }),
    signOut: vi.fn(async () => {
      client.session = null;
    }),
    signUpPolicy: vi.fn(async () => policy),
    me: vi.fn(async () => ({ accountId: "acct-new", orgs: [{ orgId: "org-joined" }] })),
    redeemInvite: vi.fn(async () => ({ org: "org-joined" })),
    useSession: vi.fn(),
    ...over,
  };
  return withRoutes(client);
}

function passkey(): PasskeyProvider & { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } {
  return {
    create: vi.fn(async () => ({}) as never),
    get: vi.fn(async () => ({}) as never),
  };
}

function deps(client: ReturnType<typeof fakeClient>, storage = memoryStorage(), pk = passkey()): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: async () => client as unknown as CalimeroClient,
    passkey: () => pk,
    storage,
  };
}

function Screen({
  d,
  invite,
  onJoined,
}: {
  d: SessionDeps;
  invite?: string | null;
  onJoined?: (j: JoinedAtSignUp) => void;
}) {
  const api = usePasskeySession("test-app", d, {
    ...(invite !== undefined ? { invite: () => invite } : {}),
    ...(onJoined ? { onJoinedAtSignUp: onJoined } : {}),
  });
  if (api.session.status === "signed-in") return <p data-testid="status">signed-in {api.session.accountId}</p>;
  return <SignInPanel api={api} appName="Test App" joining="the team" listing={LISTING} />;
}

/** Clicks "Approve with your new passkey", once the sign-up has fallen back to it. */
async function approve() {
  const button = await screen.findByTestId("signup-approve");
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(button.textContent).toBe("Approve with your new passkey");
  fireEvent.click(button);
}

afterEach(cleanup);

describe("an invite link, no account here", () => {
  it("offers creating the account and joining as the only primary action, and says what it joins", async () => {
    const client = fakeClient();
    render(<Screen d={deps(client)} invite="tok-1" onJoined={() => {}} />);

    const create = await screen.findByTestId("signup-passkey");
    expect(create.textContent).toBe("Create your account and join the team");
    expect(create.className).toContain("cp-passkey__primary");
    expect(document.querySelectorAll(".cp-passkey__primary")).toHaveLength(1);
    expect(screen.getByTestId("signin-passkey").className).toContain("cp-passkey__link");
    expect(screen.getByText("You're invited")).toBeTruthy();
    expect(screen.getByTestId("signin-desc").textContent).toContain("You've been invited to join the team in Test App.");
    expect(screen.getByText(SIGN_UP_TWO_PROMPTS)).toBeTruthy();
  });

  it("one click signs up with the invite, no sign-in tried first, and the app hears the join", async () => {
    const client = fakeClient();
    const onJoined = vi.fn();
    render(<Screen d={deps(client)} invite="tok-1" onJoined={onJoined} />);

    fireEvent.click(await screen.findByTestId("signup-passkey"));
    expect(await screen.findByTestId("status")).toBeTruthy();
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" });
    // No invite store: the pending invite is the app's to read (`null`).
    expect(onJoined).toHaveBeenCalledWith({ invite: "tok-1", org: "org-joined" }, null);
  });

  it("on an invite-only cluster the invite goes with the sign-up even without a join handler", async () => {
    const client = fakeClient({}, INVITE);
    render(<Screen d={deps(client)} invite="tok-1" />);
    await waitFor(() => expect(client.signUpPolicy).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await screen.findByTestId("status");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" });
  });

  it("an expired invite is said plainly, with what to do", async () => {
    const client = fakeClient({
      signUp: vi.fn(async () => Promise.reject(new SignUpRefused("sign-up refused: the invite has expired"))),
    });
    render(<Screen d={deps(client)} invite="tok-old" onJoined={() => {}} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    expect((await screen.findByTestId("signin-error")).textContent).toMatch(/expired.*ask whoever sent it for a new one/);
  });
});

describe("an invite link, an account here", () => {
  function knownStorage() {
    return memoryStorage({ [accountHintKey(resolveTarget(DEV_ENV))]: "1" });
  }

  it("joins with the passkey first, account creation second", async () => {
    const client = fakeClient();
    render(<Screen d={deps(client, knownStorage())} invite="tok-1" onJoined={() => {}} />);
    const join = await screen.findByTestId("signin-passkey");
    expect(join.textContent).toBe("Join the team with your passkey");
    expect(join.className).toContain("cp-passkey__primary");
    fireEvent.click(join);
    await screen.findByTestId("status");
    expect(client.signIn).toHaveBeenCalledTimes(1);
    expect(client.signUp).not.toHaveBeenCalled();
  });

  it("switches in place to create-account, invite kept, when the cluster does not know the passkey", async () => {
    const client = fakeClient({ signIn: vi.fn(async () => Promise.reject(new PasskeyUnknownHere("unknown passkey"))) });
    render(<Screen d={deps(client, knownStorage())} invite="tok-1" onJoined={() => {}} />);
    fireEvent.click(await screen.findByTestId("signin-passkey"));

    expect((await screen.findByTestId("signin-switched")).textContent).toBe(noAccountCopy("the team", true));
    expect(screen.queryByTestId("signin-error")).toBeNull();
    const create = screen.getByTestId("signup-passkey");
    expect(create.className).toContain("cp-passkey__primary");
    fireEvent.click(create);
    await screen.findByTestId("status");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" });
  });

  it("switches too when the prompt closed with no passkey chosen (NotAllowedError)", async () => {
    const client = fakeClient({ signIn: vi.fn(async () => Promise.reject(named("NotAllowedError"))) });
    render(<Screen d={deps(client, knownStorage())} invite="tok-1" onJoined={() => {}} />);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    expect((await screen.findByTestId("signin-switched")).textContent).toBe(noAccountCopy("the team", false));
    expect(screen.getByTestId("signup-passkey").textContent).toBe("Create your account and join the team");
  });

  it("remembers an account after a sign-up, so the next invite starts with joining", async () => {
    const storage = memoryStorage();
    const client = fakeClient();
    render(<Screen d={deps(client, storage)} invite="tok-1" onJoined={() => {}} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await screen.findByTestId("status");
    expect(storage.getItem(accountHintKey(resolveTarget(DEV_ENV)))).toBe("1");
  });
});

describe("no invite", () => {
  it("signs in first, offers creating an account second", async () => {
    const client = fakeClient();
    render(<Screen d={deps(client)} />);
    const signIn = await screen.findByTestId("signin-passkey");
    expect(signIn.textContent).toBe("Sign in with passkey");
    expect(signIn.className).toContain("cp-passkey__primary");
    expect(screen.getByText("New here?")).toBeTruthy();
    expect(screen.getByTestId("signup-passkey").textContent).toBe("Create an account");
    expect(screen.getByText("Sign in or create an account")).toBeTruthy();
  });

  it("says plainly that sign-up needs an invite on an invite-only cluster", async () => {
    const client = fakeClient({}, INVITE);
    render(<Screen d={deps(client)} invite={null} />);
    await waitFor(() => expect((screen.getByTestId("signup-passkey") as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByTestId("signup-unavailable").textContent).toBe(SIGN_UP_INVITE_ONLY);
  });

  it("an unreachable cluster says so and what to do", async () => {
    const client = fakeClient({ signIn: vi.fn(async () => Promise.reject(new UnavailableError("UNAVAILABLE", "down"))) });
    render(<Screen d={deps(client)} />);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    expect((await screen.findByTestId("signin-error")).textContent).toMatch(/unavailable; try again shortly/);
  });

  it("a cancelled sign-in prompt is quiet", async () => {
    const client = fakeClient({ signIn: vi.fn(async () => Promise.reject(named("NotAllowedError"))) });
    render(<Screen d={deps(client)} />);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    await waitFor(() => expect((screen.getByTestId("signin-passkey") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("signin-error")).toBeNull();
  });
});

describe("the two-prompt sign-up", () => {
  it("asks the second prompt right after the first, with no click", async () => {
    const client = fakeClient();
    const pk = passkey();
    render(<Screen d={deps(client, memoryStorage(), pk)} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await screen.findByTestId("status");
    expect(pk.create).toHaveBeenCalledTimes(1);
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("signup-approve")).toBeNull();
  });

  it("a second prompt refused at once (Safari's gesture rule) waits for Approve, which then signs up", async () => {
    const client = fakeClient();
    const pk = passkey();
    pk.get.mockRejectedValueOnce(named("NotAllowedError"));
    render(<Screen d={deps(client, memoryStorage(), pk)} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));

    await approve();
    expect(screen.queryByTestId("signin-error")).toBeNull();
    await screen.findByTestId("status");
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it("a second prompt the person saw and closed waits at Approve with the error, then Approve signs up", async () => {
    const client = fakeClient();
    const pk = passkey();
    pk.get.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
      throw named("NotAllowedError");
    });
    render(<Screen d={deps(client, memoryStorage(), pk)} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    expect((await screen.findByTestId("signin-error", {}, { timeout: 3000 })).textContent).toBe(SIGN_UP_NOT_FINISHED);
    await approve();
    await screen.findByTestId("status");
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it("shows Approve's copy while it waits", async () => {
    const client = fakeClient();
    const pk = passkey();
    pk.get.mockRejectedValueOnce(named("ConfirmPromptBlocked"));
    render(<Screen d={deps(client, memoryStorage(), pk)} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    expect(await screen.findByText(SIGN_UP_READY)).toBeTruthy();
    // Nothing starts the second prompt again by itself.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("status")).toBeNull();
  });

  it("a refused approval is shown, not swallowed, and Approve stays for another try", async () => {
    const client = fakeClient();
    const pk = passkey();
    // Refused at once right away, then twice after the click (the quick retry included), then accepted.
    pk.get
      .mockRejectedValueOnce(named("NotAllowedError"))
      .mockRejectedValueOnce(named("NotAllowedError"))
      .mockRejectedValueOnce(named("NotAllowedError"));
    render(<Screen d={deps(client, memoryStorage(), pk)} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await approve();
    expect((await screen.findByTestId("signin-error", {}, { timeout: 3000 })).textContent).toBe(SIGN_UP_NOT_FINISHED);
    expect((screen.getByTestId("signup-approve") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("signup-approve"));
    await screen.findByTestId("status");
  });

  it("a cancelled first prompt is quiet", async () => {
    const client = fakeClient();
    const pk = passkey();
    pk.create.mockRejectedValueOnce(named("NotAllowedError"));
    render(<Screen d={deps(client, memoryStorage(), pk)} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await waitFor(() => expect((screen.getByTestId("signup-passkey") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("signin-error")).toBeNull();
  });

  it("Cancel at the approval step gives up quietly, without asking again", async () => {
    const client = fakeClient();
    const pk = passkey();
    pk.get.mockRejectedValueOnce(named("NotAllowedError"));
    render(<Screen d={deps(client, memoryStorage(), pk)} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    fireEvent.click(await screen.findByTestId("signup-cancel"));
    // Quiet: the panel is back, with no error.
    await screen.findByTestId("signup-passkey");
    expect(screen.queryByTestId("signin-error")).toBeNull();
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(client.signUp).toHaveBeenCalledTimes(1);
  });
});

describe("the invitation screens", () => {
  it("InvitationSignIn says what the invite joins and keeps it on Not now", async () => {
    const client = fakeClient();
    const later = vi.fn();
    function Host() {
      const api = usePasskeySession("test-app", deps(client), { invite: () => "tok-1", onJoinedAtSignUp: () => {} });
      return (
        <InvitationSignIn api={api} appName="Test App" joining="the team" listing={LISTING} onLater={later} />
      );
    }
    render(<Host />);
    expect((await screen.findByTestId("signup-passkey")).textContent).toBe("Create your account and join the team");
    fireEvent.click(screen.getByTestId("invitation-later"));
    expect(later).toHaveBeenCalled();
  });

  it("JoinInvitation redeems on Join, and tells a member they are in already", async () => {
    const client = fakeClient();
    const drop = vi.fn();
    const onJoined = vi.fn();
    const props = {
      client: client as unknown as CalimeroClient,
      token: "tok-1",
      appName: "Test App",
      joining: "the team",
      drop,
      isSpent: () => false,
      after: () => {},
      onJoined,
      onClose: () => {},
    };
    const { unmount } = render(<JoinInvitation {...props} org={null} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-1");
    unmount();

    render(<JoinInvitation {...props} org="org-joined" />);
    expect((await screen.findByTestId("invitation-outcome")).textContent).toContain("You're already in the team");
    expect(client.redeemInvite).toHaveBeenCalledTimes(1);
  });

  it("JoinInvitation names the account that joins, when given one", async () => {
    render(
      <JoinInvitation
        client={fakeClient() as unknown as CalimeroClient}
        token="tok-1"
        org={null}
        appName="Test App"
        joining="Alice's game"
        account="acct-b…1234"
        drop={() => {}}
        after={() => {}}
        onJoined={() => {}}
        onClose={() => {}}
      />,
    );
    expect((await screen.findByRole("heading")).textContent).toBe("Join Alice's game as acct-b…1234?");
  });
});
