import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  LoginRequired,
  SignUpRefused,
  type CalimeroClient,
  type PasskeyProvider,
  type SignUpPolicy,
} from "@calimero-network/mero-js";
import {
  PASSKEY_UNKNOWN_HERE_MESSAGE,
  PASSKEY_UNKNOWN_SIGN_UP_MESSAGE,
  SIGN_UP_CLOSED,
  SIGN_UP_INVITE_ONLY,
  type KeyValueStorage,
} from "@calimero-apps/connect";

import { PasskeySignIn, type PasskeySignInApi } from "./PasskeySignIn";
import { isPasskeyCancel, usePasskeySession, type SessionDeps } from "./session";

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function cancelled(): Error {
  const e = new Error("The operation either timed out or was not allowed.");
  e.name = "NotAllowedError";
  return e;
}

function fakeClient(over: Partial<Record<string, unknown>> = {}) {
  const client = {
    session: null as null | { accountId: string },
    signIn: vi.fn(async () => {
      client.session = { accountId: "acct-in" };
      return client.session;
    }),
    signUp: vi.fn(async () => {
      client.session = { accountId: "acct-new" };
      return client.session;
    }),
    signOut: vi.fn(async () => {
      client.session = null;
    }),
    useSession: vi.fn(),
    ...over,
  };
  return client;
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: { DEV: true },
    makeClient: async () => client as unknown as CalimeroClient,
    passkey: () => ({}) as PasskeyProvider,
    storage: memoryStorage(),
  };
}

describe("usePasskeySession", () => {
  it("connects signed out, signs up without a name, and signs out", async () => {
    const client = fakeClient();
    const d = deps(client);
    const { result } = renderHook(() => usePasskeySession("test-app", d));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));

    await act(() => result.current.signUp());
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    expect(result.current.session).toMatchObject({ status: "signed-in", accountId: "acct-new" });

    await act(() => result.current.signOut());
    expect(result.current.session.status).toBe("signed-out");
  });

  it("is signed out before /auth/logout returns, and a sign-in right after waits for it", async () => {
    let finishLogout!: () => void;
    const client = fakeClient();
    client.signOut = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLogout = () => {
            client.session = null;
            resolve();
          };
        }),
    );
    const d = deps(client);
    const { result } = renderHook(() => usePasskeySession("test-app", d));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    await act(() => result.current.signUp());

    let out!: Promise<void>;
    act(() => {
      out = result.current.signOut();
    });
    // No screen sees "signed-in" with a session the node is revoking.
    expect(result.current.session.status).toBe("signed-out");
    expect(client.signOut).toHaveBeenCalledTimes(1);

    let signIn!: Promise<void>;
    act(() => {
      signIn = result.current.signIn();
    });
    await Promise.resolve();
    expect(client.signIn).not.toHaveBeenCalled();

    await act(async () => {
      finishLogout();
      await out;
      await signIn;
    });
    expect(client.signIn).toHaveBeenCalledTimes(1);
    expect(result.current.session).toMatchObject({ status: "signed-in", accountId: "acct-in" });
  });

  it("treats a dismissed passkey prompt as a quiet cancel", async () => {
    const client = fakeClient({ signIn: vi.fn(async () => Promise.reject(cancelled())) });
    const d = deps(client);
    const { result } = renderHook(() => usePasskeySession("test-app", d));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));

    await act(() => result.current.signIn());
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(result.current.session.status).toBe("signed-out");
  });

  it("shows any other failure", async () => {
    const client = fakeClient({ signIn: vi.fn(async () => Promise.reject(new Error("node down"))) });
    const d = deps(client);
    const { result } = renderHook(() => usePasskeySession("test-app", d));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));

    await act(() => result.current.signIn());
    expect(result.current.error).toContain("node down");
  });

  it("says a passkey the cluster does not know is unknown here, not 'Sign in first.'", async () => {
    const client = fakeClient({ signIn: vi.fn(async () => Promise.reject(new LoginRequired("unknown passkey"))) });
    const d = deps(client);
    const { result } = renderHook(() => usePasskeySession("test-app", d));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));

    await act(() => result.current.signIn());
    expect(result.current.error).toBe(PASSKEY_UNKNOWN_HERE_MESSAGE);
  });

  it("is unconfigured when the target cannot be resolved", async () => {
    const d: SessionDeps = {
      ...deps(fakeClient()),
      env: { DEV: false, PROD: true, VITE_CALIMERO_CLUSTER: "eu-shared-1" },
    };
    const { result } = renderHook(() => usePasskeySession("test-app", d));
    await waitFor(() => expect(result.current.session.status).toBe("unconfigured"));
    expect(result.current.session).toMatchObject({ message: expect.stringMatching(/VITE_CALIMERO_MIN_RELEASE/) });
  });

  it("reports a listing page no cluster serves as its own status", async () => {
    const d: SessionDeps = { ...deps(fakeClient()), env: { DEV: false, PROD: true }, servedNodes: async () => null };
    const { result } = renderHook(() => usePasskeySession("test-app", d, { package: "com.example.test" }));
    await waitFor(() => expect(result.current.session.status).toBe("listing"));
    expect(result.current.session).toMatchObject({
      status: "listing",
      console: "https://cloud.calimero.network",
      package: "com.example.test",
      message: expect.stringMatching(/test-app's listing page/),
    });
  });

  it("connects a page the cluster serves without a cluster name in the build", async () => {
    const make = vi.fn(async () => fakeClient() as unknown as CalimeroClient);
    const d: SessionDeps = {
      ...deps(fakeClient()),
      makeClient: make,
      env: { DEV: false, PROD: true, VITE_CALIMERO_MIN_RELEASE: "2.3.136" },
      servedNodes: async () => ["https://n1.example"],
    };
    const { result } = renderHook(() => usePasskeySession("test-app", d, { package: "com.example.test" }));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    expect(make).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cloud", nodes: ["https://n1.example"], minReleaseVersion: "2.3.136" }),
    );
  });
});

describe("isPasskeyCancel", () => {
  it("knows a cancel, also when wrapped", () => {
    expect(isPasskeyCancel(cancelled())).toBe(true);
    expect(isPasskeyCancel(new Error("wrapped", { cause: cancelled() }))).toBe(true);
    expect(isPasskeyCancel(new Error("other"))).toBe(false);
    expect(isPasskeyCancel(null)).toBe(false);
  });
});

describe("PasskeySignIn", () => {
  function api(over: Partial<PasskeySignInApi> = {}): PasskeySignInApi {
    return { busy: false, error: null, signIn: vi.fn(async () => {}), signUp: vi.fn(async () => {}), ...over };
  }

  it("continues with a passkey, or creates one without asking for a name", () => {
    const a = api();
    render(<PasskeySignIn api={a} />);
    expect(screen.getByText(/any Calimero app/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("signin-passkey"));
    expect(a.signIn).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("signup-passkey"));
    expect(a.signUp).toHaveBeenCalledWith("");
    expect(screen.queryByTestId("signup-name")).toBeNull();
  });

  it("offers an optional name when asked to", () => {
    const a = api();
    render(<PasskeySignIn api={a} askName />);
    fireEvent.click(screen.getByTestId("signup-passkey"));
    expect(a.signUp).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("signup-name"), { target: { value: "  Ada " } });
    fireEvent.click(screen.getByTestId("signup-passkey"));
    expect(a.signUp).toHaveBeenCalledWith("Ada");
  });

  it("disables both while a ceremony runs and shows an error", () => {
    render(<PasskeySignIn api={api({ busy: true, error: "node down" })} />);
    expect((screen.getByTestId("signin-passkey") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("signup-passkey") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("node down");
  });
});

// What core's `GET /sign-up` answers for each policy.
const POLICY: Record<SignUpPolicy["policy"], SignUpPolicy> = {
  open: { policy: "open", orgInvites: true, signUpInvites: true, inviteRequired: false },
  invite: { policy: "invite", orgInvites: true, signUpInvites: true, inviteRequired: true },
  closed: { policy: "closed", orgInvites: false, signUpInvites: true, inviteRequired: true },
};

describe("sign-up policy", () => {
  /** A cluster with `policy` on which the person's passkey is unknown. */
  function cluster(policy: SignUpPolicy | "old-node") {
    const signUpPolicy = vi.fn(async () => policy);
    const client = fakeClient({
      signIn: vi.fn(async () => Promise.reject(new LoginRequired("unknown passkey"))),
      ...(policy === "old-node" ? {} : { signUpPolicy }),
    });
    return Object.assign(client, { policyReads: signUpPolicy });
  }

  function Panel({ d, invite }: { d: SessionDeps; invite?: () => string | null }) {
    const api = usePasskeySession("test-app", d, invite ? { invite } : {});
    return api.session.status === "signed-out" ? (
      <PasskeySignIn api={api} />
    ) : (
      <p data-testid="status">{api.session.status}</p>
    );
  }

  async function signInWithUnknownPasskey() {
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    return screen.findByTestId("signin-error");
  }

  it("open: reads the policy once, offers an account here after an unknown passkey, and runs sign-up", async () => {
    const client = cluster(POLICY.open);
    render(<Panel d={deps(client)} />);
    expect((await screen.findByTestId("signup-passkey") as HTMLButtonElement).disabled).toBe(false);

    expect((await signInWithUnknownPasskey()).textContent).toBe(PASSKEY_UNKNOWN_SIGN_UP_MESSAGE);
    fireEvent.click(screen.getByTestId("signup-here"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-in"));
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    expect(client.policyReads).toHaveBeenCalledTimes(1);
  });

  it("closed: no sign-up up front, the reason shown, and none offered after an unknown passkey", async () => {
    const client = cluster(POLICY.closed);
    render(<Panel d={deps(client)} invite={() => "org-invite-token"} />);
    await waitFor(() => expect((screen.getByTestId("signup-passkey") as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByTestId("signup-unavailable").textContent).toBe(SIGN_UP_CLOSED);

    expect((await signInWithUnknownPasskey()).textContent).toBe(
      `This passkey isn't known on this cluster. ${SIGN_UP_CLOSED}`,
    );
    expect(screen.queryByTestId("signup-here")).toBeNull();
    fireEvent.click(screen.getByTestId("signup-passkey"));
    expect(client.signUp).not.toHaveBeenCalled();
  });

  it("invite without a token: invited people only, no sign-up", async () => {
    const client = cluster(POLICY.invite);
    render(<Panel d={deps(client)} invite={() => null} />);
    await waitFor(() => expect((screen.getByTestId("signup-passkey") as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByTestId("signup-unavailable").textContent).toBe(SIGN_UP_INVITE_ONLY);

    expect((await signInWithUnknownPasskey()).textContent).toBe(
      `This passkey isn't known on this cluster. ${SIGN_UP_INVITE_ONLY}`,
    );
    expect(screen.queryByTestId("signup-here")).toBeNull();
  });

  it("invite with a token: offers an account here and signs up with the invite", async () => {
    const client = cluster(POLICY.invite);
    render(<Panel d={deps(client)} invite={() => "org-invite-token"} />);
    expect((await signInWithUnknownPasskey()).textContent).toBe(PASSKEY_UNKNOWN_SIGN_UP_MESSAGE);
    expect(screen.queryByTestId("signup-unavailable")).toBeNull();

    fireEvent.click(screen.getByTestId("signup-here"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-in"));
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "org-invite-token" });
  });

  it("a node without GET /sign-up blocks nothing and keeps the general wording", async () => {
    const client = cluster("old-node");
    render(<Panel d={deps(client)} />);
    expect((await signInWithUnknownPasskey()).textContent).toBe(PASSKEY_UNKNOWN_HERE_MESSAGE);
    expect((screen.getByTestId("signup-passkey") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("signup-here")).toBeTruthy();
    expect(screen.queryByTestId("signup-unavailable")).toBeNull();
  });

  it("says why a sign-up the cluster refused was refused", async () => {
    const client = fakeClient({
      signUp: vi.fn(async () => Promise.reject(new SignUpRefused("sign-up is by invite only"))),
    });
    const d = deps(client);
    const { result } = renderHook(() => usePasskeySession("test-app", d));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    await act(() => result.current.signUp());
    expect(result.current.error).toBe(SIGN_UP_INVITE_ONLY);
  });
});
