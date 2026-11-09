import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  LoginRequired,
  type CalimeroClient,
  type PasskeyProvider,
  type SignUpPolicy,
} from "@calimero-network/mero-js";
import {
  PASSKEY_UNKNOWN_HERE_MESSAGE,
  PASSKEY_UNKNOWN_SIGN_UP_MESSAGE,
  SIGN_UP_CLOSED,
  SIGN_UP_INVITE_ONLY,
} from "@calimero-apps/connect";

import { SIGN_UP_NOT_FINISHED } from "@calimero-apps/passkey";

import {
  __setForTests,
  approveSignUp,
  signIn,
  signUp,
  useCalimero,
} from "./calimero";
import { INVITATION_STORAGE_KEY } from "../utils/invitation";

describe("signIn", () => {
  // The node's answer to a passkey it has no account for (one made before
  // eu-shared-1 was recreated, or on another cluster). The popup showed
  // "Sign in first." for it, which reads as if no sign-in had been tried.
  it("tells a person their passkey is unknown on this cluster, not 'Sign in first.'", async () => {
    const client = {
      session: undefined,
      signIn: vi.fn(async () =>
        Promise.reject(new LoginRequired("unknown passkey")),
      ),
    } as unknown as CalimeroClient;
    __setForTests(client, null, () => ({}) as PasskeyProvider);
    const { result } = renderHook(() => useCalimero());

    await act(async () => {
      await expect(signIn()).rejects.toBeInstanceOf(LoginRequired);
    });
    expect(result.current.status).toBe("signed-out");
    expect(result.current.message).toBe(PASSKEY_UNKNOWN_HERE_MESSAGE);
  });
});

describe("an unknown passkey, by the cluster's sign-up policy", () => {
  const POLICY: Record<SignUpPolicy["policy"], SignUpPolicy> = {
    open: {
      policy: "open",
      orgInvites: true,
      signUpInvites: true,
      inviteRequired: false,
    },
    invite: {
      policy: "invite",
      orgInvites: true,
      signUpInvites: true,
      inviteRequired: true,
    },
    closed: {
      policy: "closed",
      orgInvites: false,
      signUpInvites: true,
      inviteRequired: true,
    },
  };

  async function unknownPasskeyOn(policy: SignUpPolicy) {
    const client = {
      session: undefined as undefined | { accountId: string },
      signIn: vi.fn(async () =>
        Promise.reject(new LoginRequired("unknown passkey")),
      ),
      signUp: vi.fn(async () => ({ accountId: "acct-new" })),
      signUpPolicy: vi.fn(async () => policy),
    };
    __setForTests(
      client as unknown as CalimeroClient,
      null,
      () => ({}) as PasskeyProvider,
    );
    const hook = renderHook(() => useCalimero());
    await waitFor(() =>
      expect(hook.result.current.signUpAccess).not.toBe("unknown"),
    );
    await act(async () => {
      await expect(signIn()).rejects.toBeInstanceOf(LoginRequired);
    });
    return { client, result: hook.result };
  }

  it("open: offers an account here, and signs up without an invite", async () => {
    localStorage.removeItem(INVITATION_STORAGE_KEY);
    const { client, result } = await unknownPasskeyOn(POLICY.open);
    expect(result.current.message).toBe(PASSKEY_UNKNOWN_SIGN_UP_MESSAGE);
    expect(result.current.signUpAccess).toBe("allowed");
    expect(result.current.passkeyUnknown).toBe(true);
    await act(() => signUp("Ada"));
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "Ada");
  });

  it("invite with the link's token: signs up with it", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "org-invite-token");
    try {
      const { client, result } = await unknownPasskeyOn(POLICY.invite);
      expect(result.current.message).toBe(PASSKEY_UNKNOWN_SIGN_UP_MESSAGE);
      await act(() => signUp(""));
      expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", {
        invite: "org-invite-token",
      });
    } finally {
      localStorage.removeItem(INVITATION_STORAGE_KEY);
    }
  });

  it("invite without a token: invited people only", async () => {
    const { result } = await unknownPasskeyOn(POLICY.invite);
    expect(result.current.signUpAccess).toBe("needs-invite");
    expect(result.current.message).toBe(
      `This passkey isn't known on this cluster. ${SIGN_UP_INVITE_ONLY}`,
    );
  });

  it("closed: not open to new accounts", async () => {
    const { result } = await unknownPasskeyOn(POLICY.closed);
    expect(result.current.signUpAccess).toBe("closed");
    expect(result.current.message).toBe(
      `This passkey isn't known on this cluster. ${SIGN_UP_CLOSED}`,
    );
  });
});

describe("signUp's second prompt", () => {
  // Since core #4849 a sign-up takes two prompts; a password manager
  // extension still saving the new passkey refused the second when it was
  // asked for at once, which left a passkey and no account.
  function cluster(get: PasskeyProvider["get"]) {
    const pk = { create: vi.fn(async () => ({}) as never), get: vi.fn(get) };
    const client = {
      session: undefined,
      signUp: vi.fn(async (p: PasskeyProvider) => {
        await p.create({});
        await p.get(new Uint8Array([1]), "example.com", ["new-cred"]);
        return { accountId: "acct-new" };
      }),
    } as unknown as CalimeroClient;
    __setForTests(client, null, () => pk);
    return { pk, hook: renderHook(() => useCalimero()) };
  }

  it("waits for Approve before asking, then signs in", async () => {
    const { pk, hook } = cluster(async () => ({}) as never);
    let run!: Promise<void>;
    act(() => {
      run = signUp("Ada");
    });
    await waitFor(() => expect(hook.result.current.signUpStage).toBe("approve"));
    expect(pk.get).not.toHaveBeenCalled();
    await act(async () => {
      approveSignUp();
      await run;
    });
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("signed-in");
    expect(hook.result.current.signUpStage).toBeNull();
  });

  it("shows a refused second prompt and keeps waiting at Approve", async () => {
    const refused = Object.assign(new Error("The operation either timed out or was not allowed."), {
      name: "NotAllowedError",
    });
    const { pk, hook } = cluster(async () => {
      await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
      throw refused;
    });
    let run!: Promise<void>;
    act(() => {
      run = signUp("");
    });
    await waitFor(() => expect(hook.result.current.signUpStage).toBe("approve"));
    act(() => approveSignUp());
    await waitFor(() => expect(hook.result.current.message).toBe(SIGN_UP_NOT_FINISHED), { timeout: 3000 });
    expect(hook.result.current.signUpStage).toBe("approve");
    expect(pk.get).toHaveBeenCalledTimes(1);

    pk.get.mockImplementation(async () => ({}) as never);
    await act(async () => {
      approveSignUp();
      await run;
    });
    expect(hook.result.current.status).toBe("signed-in");
    expect(hook.result.current.message).toBeNull();
  });
});
