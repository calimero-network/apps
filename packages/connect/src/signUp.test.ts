import { CalimeroError, LoginRequired, SignUpRefused, type SignUpPolicy } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import {
  PASSKEY_UNKNOWN_HERE_MESSAGE,
  SIGN_UP_CLOSED,
  SIGN_UP_INVITE_ONLY,
  describeSignInError,
  isPasskeyUnknownHere,
  readSignUpPolicy,
  signUpAccess,
  signUpInvite,
  signUpNotice,
} from "./index";

// What core's `GET /sign-up` answers for each policy.
const OPEN: SignUpPolicy = { policy: "open", orgInvites: true, signUpInvites: true, inviteRequired: false };
const INVITE: SignUpPolicy = { policy: "invite", orgInvites: true, signUpInvites: true, inviteRequired: true };
const CLOSED: SignUpPolicy = { policy: "closed", orgInvites: false, signUpInvites: true, inviteRequired: true };

const unknownPasskey = () => new LoginRequired("unknown passkey");

describe("readSignUpPolicy", () => {
  it("reads the cluster's policy", async () => {
    expect(await readSignUpPolicy({ signUpPolicy: vi.fn(async () => INVITE) })).toEqual(INVITE);
  });

  it("is null (unknown, never blocking) on a node without GET /sign-up or any failure", async () => {
    const notFound = new CalimeroError(404, "NOT_FOUND", "no route");
    expect(await readSignUpPolicy({ signUpPolicy: vi.fn(async () => Promise.reject(notFound)) })).toBeNull();
    expect(await readSignUpPolicy({})).toBeNull();
    expect(await readSignUpPolicy({ signUpPolicy: vi.fn(async () => ({ policy: "weird" }) as never) })).toBeNull();
  });
});

describe("signUpAccess", () => {
  it("lets anyone in on an open cluster", () => {
    expect(signUpAccess(OPEN, false)).toBe("allowed");
  });

  it("lets an invite-only cluster in with an invite token, else needs one", () => {
    expect(signUpAccess(INVITE, true)).toBe("allowed");
    expect(signUpAccess(INVITE, false)).toBe("needs-invite");
  });

  it("is closed on a closed cluster, even with an organization invite", () => {
    expect(signUpAccess(CLOSED, false)).toBe("closed");
    expect(signUpAccess(CLOSED, true)).toBe("closed");
  });

  it("is unknown when the policy could not be read", () => {
    expect(signUpAccess(null, false)).toBe("unknown");
    expect(signUpAccess(undefined, true)).toBe("unknown");
  });

  it("sends the invite with a sign-up only where the policy requires one", () => {
    expect(signUpInvite(INVITE, "tok")).toBe("tok");
    expect(signUpInvite(INVITE, null)).toBeNull();
    expect(signUpInvite(OPEN, "tok")).toBeNull();
    expect(signUpInvite(CLOSED, "tok")).toBeNull();
    expect(signUpInvite(null, "tok")).toBeNull();
  });

  it("says why sign-up is not offered, and nothing when it is", () => {
    expect(signUpNotice("needs-invite")).toBe(SIGN_UP_INVITE_ONLY);
    expect(signUpNotice("closed")).toBe(SIGN_UP_CLOSED);
    expect(signUpNotice("allowed")).toBeNull();
    expect(signUpNotice("unknown")).toBeNull();
  });
});

describe("describeSignInError for a passkey this cluster does not know, by policy", () => {
  it("open (or invite with a token): offers an account here, made with a new passkey", () => {
    const text = describeSignInError(unknownPasskey(), "allowed");
    expect(text).toBe(
      "This passkey isn't known on this cluster. Create an account here: it makes a new passkey for this cluster.",
    );
  });

  it("invite without a token: invited people only", () => {
    expect(describeSignInError(unknownPasskey(), "needs-invite")).toBe(
      "This passkey isn't known on this cluster. This cluster lets in invited people only: open the invite link you were sent, or ask the cluster's owner for one.",
    );
  });

  it("closed: not open to new accounts", () => {
    expect(describeSignInError(unknownPasskey(), "closed")).toBe(
      "This passkey isn't known on this cluster. This cluster isn't open to new accounts: ask its operator for a sign-up invite.",
    );
  });

  it("unknown policy: the general wording", () => {
    expect(describeSignInError(unknownPasskey(), "unknown")).toBe(PASSKEY_UNKNOWN_HERE_MESSAGE);
    expect(describeSignInError(unknownPasskey())).toBe(PASSKEY_UNKNOWN_HERE_MESSAGE);
  });

  it("knows the failure for what it is", () => {
    expect(isPasskeyUnknownHere(unknownPasskey())).toBe(true);
    expect(isPasskeyUnknownHere(new CalimeroError(401, "PASSKEY_UNKNOWN_HERE", "x"))).toBe(true);
    expect(isPasskeyUnknownHere(new LoginRequired("signature counter did not advance"))).toBe(false);
    expect(isPasskeyUnknownHere(new Error("unknown passkey"))).toBe(false);
  });
});

describe("describeSignInError for a refused sign-up (403 SIGN_UP_REFUSED)", () => {
  // The node's sentences, as mero-js reads `reason` from them.
  const refused = (message: string) => new SignUpRefused(message);

  it("says each reason plainly", () => {
    const cases: [string, string, string][] = [
      ["sign-up is by invite only", "invite-only", SIGN_UP_INVITE_ONLY],
      ["sign-up needs a sign-up invite", "closed", SIGN_UP_CLOSED],
      [
        "unknown invite",
        "unknown-invite",
        "This cluster doesn't know that invite: check the link you were sent, or ask for a new one.",
      ],
      [
        "the invite has expired",
        "expired-invite",
        "That invite has expired or has no uses left: ask whoever sent it for a new one.",
      ],
      [
        "the invite's organization is gone",
        "org-gone",
        "The organization that invite was for no longer exists: ask for an invite to another one.",
      ],
    ];
    for (const [message, reason, text] of cases) {
      const e = refused(message);
      expect(e.reason).toBe(reason);
      expect(describeSignInError(e)).toBe(text);
    }
  });

  it("gives the node's reason for anything else", () => {
    expect(describeSignInError(refused("rate limited"))).toBe("This cluster refused the sign-up: rate limited");
  });
});
