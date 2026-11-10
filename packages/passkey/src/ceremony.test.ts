import { describe, expect, it, vi } from "vitest";
import { CalimeroError, type CalimeroClient, type PasskeyProvider, type SignUpPolicy } from "@calimero-network/mero-js";
import type { KeyValueStorage, Target } from "@calimero-apps/connect";
import {
  accountHintKey,
  describeCeremonyFailure,
  invitedFirst,
  knownAccountHere,
  noAccountHereAfter,
  signInHere,
  signUpHere,
  signUpInviteHere,
} from "./ceremony";
import { SIGN_UP_NOT_FINISHED } from "./signUpFlow";

const TARGET: Target = { kind: "local", nodes: ["http://127.0.0.1:2428"] };

function memory(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const policy = (p: SignUpPolicy["policy"]): SignUpPolicy => ({
  policy: p,
  orgInvites: p !== "closed",
  signUpInvites: true,
  inviteRequired: p !== "open",
});

const pk = (): PasskeyProvider =>
  ({ create: vi.fn(), get: vi.fn(async () => ({ credentialId: "cred-1" })) }) as unknown as PasskeyProvider;

describe("the shared ceremony", () => {
  it("a sign-in remembers the account here; a second offers only this cluster's passkey", async () => {
    const storage = memory();
    const passkey = pk();
    const client = {
      signIn: vi.fn(async (p: PasskeyProvider) => {
        await p.get(new Uint8Array([1]), "calimero.network");
        return { accountId: "acct-1" };
      }),
    };
    expect(knownAccountHere(TARGET, storage)).toBe(false);
    await signInHere(client as unknown as CalimeroClient, TARGET, passkey, storage);
    expect(storage.getItem(accountHintKey(TARGET))).toBe("1");
    await signInHere(client as unknown as CalimeroClient, TARGET, passkey, storage);
    expect(vi.mocked(passkey.get).mock.calls[1]?.[2]).toEqual(["cred-1"]);
  });

  it("forwards an AbortSignal only when given one", async () => {
    const client = {
      signIn: vi.fn(async (..._args: unknown[]) => ({ accountId: "a" })),
      signUp: vi.fn(async (..._args: unknown[]) => ({ accountId: "a" })),
    };
    const c = client as unknown as CalimeroClient;
    const signal = new AbortController().signal;
    await signInHere(c, TARGET, pk(), memory());
    expect(client.signIn.mock.calls[0]).toHaveLength(1);
    await signInHere(c, TARGET, pk(), memory(), { signal });
    expect(client.signIn.mock.calls[1]?.[1]).toEqual({ signal });
    await signUpHere(c, TARGET, pk(), { name: "Ada", storage: memory() });
    expect(client.signUp.mock.calls[0]).toEqual([expect.anything(), "Ada"]);
    await signUpHere(c, TARGET, pk(), { name: "Ada", invite: "tok", join: true, storage: memory(), signal });
    expect(client.signUp.mock.calls[1]?.[2]).toEqual({ invite: "tok", signal });
  });

  it("carries the invite at sign-up by the policy, and reports the join", async () => {
    expect(signUpInviteHere(policy("open"), "tok", true)).toBe("tok");
    expect(signUpInviteHere(policy("open"), "tok", false)).toBeNull();
    expect(signUpInviteHere(undefined, "tok", true)).toBe("tok");
    expect(signUpInviteHere(policy("invite"), "tok", false)).toBe("tok");
    expect(signUpInviteHere(policy("closed"), "tok", true)).toBe(signUpInviteHere(policy("closed"), "tok", false));
    const client = {
      signUp: vi.fn(async () => ({ accountId: "acct-new" })),
      me: vi.fn(async () => ({ orgs: [{ orgId: "org-1" }] })),
    };
    const made = await signUpHere(client as unknown as CalimeroClient, TARGET, pk(), {
      invite: "tok",
      policy: policy("open"),
      join: true,
      storage: memory(),
    });
    expect(made).toEqual({ accountId: "acct-new", joined: { invite: "tok", org: "org-1" } });
  });

  it("takes the joined org from the sign-up's answer when the node says it, and asks me() only when not (B4)", async () => {
    const client = {
      signUp: vi.fn(async () => ({ accountId: "acct-new", org: "org-said" })),
      me: vi.fn(async () => ({ orgs: [{ orgId: "org-1" }, { orgId: "org-2" }] })),
    };
    const made = await signUpHere(client as unknown as CalimeroClient, TARGET, pk(), {
      invite: "tok",
      policy: policy("open"),
      join: true,
      storage: memory(),
    });
    expect(made.joined).toEqual({ invite: "tok", org: "org-said" });
    expect(client.me).not.toHaveBeenCalled();
  });

  it("names a new account in the org its invite joined, and a refusal there fails nothing", async () => {
    const client = {
      signUp: vi.fn(async () => ({ accountId: "acct-new", org: "org-1" })),
      me: vi.fn(),
      setMemberMetadata: vi.fn(async () => {}),
    };
    const c = client as unknown as CalimeroClient;
    const opts = { invite: "tok", policy: policy("open"), join: true, storage: memory() };
    await signUpHere(c, TARGET, pk(), { ...opts, name: "  Eve " });
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-1", "acct-new", { name: "Eve" });
    // No name, or no join: nothing to write.
    await signUpHere(c, TARGET, pk(), { ...opts, name: " " });
    await signUpHere(c, TARGET, pk(), { name: "Eve", storage: memory() });
    expect(client.setMemberMetadata).toHaveBeenCalledTimes(1);
    client.setMemberMetadata.mockRejectedValueOnce(new Error("refused"));
    const made = await signUpHere(c, TARGET, pk(), { ...opts, name: "Eve" });
    expect(made.joined).toEqual({ invite: "tok", org: "org-1" });
  });

  it("an unknown passkey, or a prompt closed with none chosen, is no account here", () => {
    const unknown = new CalimeroError(401, "PASSKEY_UNKNOWN_HERE", "unknown passkey");
    const closed = Object.assign(new Error("closed"), { name: "NotAllowedError" });
    expect(noAccountHereAfter({ error: unknown, during: "sign-in" })).toBe(true);
    expect(noAccountHereAfter({ error: closed, during: "sign-in" })).toBe(true);
    expect(noAccountHereAfter({ error: closed, during: "sign-up" })).toBe(false);
    expect(invitedFirst(true, false)).toBe("sign-in");
    expect(invitedFirst(true, true)).toBe("create");
    expect(invitedFirst(false, false)).toBe("create");
  });

  it("says nothing for a dismissed prompt, and why an approval failed", () => {
    const closed = Object.assign(new Error("closed"), { name: "NotAllowedError" });
    expect(describeCeremonyFailure({ error: closed, during: "sign-in" }, "allowed")).toBeNull();
    expect(describeCeremonyFailure(null, "allowed", { error: closed })).toBe(SIGN_UP_NOT_FINISHED);
  });
});
