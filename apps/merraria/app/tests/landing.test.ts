// The launcher's screens against a mocked CalimeroClient: sign in, the world
// list, a pending invitation, creating a world, inviting into the last one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Connection } from "../src/net/session";
import { Landing, type LaunchChoice } from "../src/ui/landing";
import { SessionStore, createInviteStore, type InviteStore, type PendingInvite } from "@calimero-apps/connect";
import { SIGN_UP_NOT_FINISHED, SIGN_UP_READY } from "@calimero-apps/passkey/signUpFlow";
import { SIGN_IN_HINT, accountHintKey, noAccountCopy } from "@calimero-apps/passkey/ceremony";
import type { PasskeyProvider } from "@calimero-network/mero-js";

const target = { kind: "local", nodes: ["http://127.0.0.1:2501"] } as const;

function fakeClient(signedIn: boolean) {
  // org → account → member metadata
  const members: Record<string, Record<string, Record<string, unknown>>> = {};
  const client = {
    members,
    session: signedIn ? { accountId: "acct-ada", sessionToken: "s", expiresAt: 1, refreshToken: "r" } : null,
    signIn: vi.fn(async () => {
      client.session = { accountId: "acct-ada", sessionToken: "s", expiresAt: 1, refreshToken: "r" };
      return client.session;
    }),
    signUp: vi.fn(),
    signOut: vi.fn(async () => {}),
    useSession: vi.fn(),
    listApps: vi.fn(async () => [
      { appId: "w-1", name: "caves", org: "org-1", owner: "o", bundle: "b", package: null, version: null },
    ]),
    redeemInvite: vi.fn(async () => ({})),
    createOrg: vi.fn(async () => "org-new"),
    createApp: vi.fn(async () => "w-new"),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(),
    invite: vi.fn(async () => "tok-9"),
    getOrg: vi.fn(async (org: string) => ({ memberMetadata: members[org] ?? {} })),
    setMemberMetadata: vi.fn(async (org: string, account: string, meta: Record<string, unknown>) => {
      (members[org] ??= {})[account] = meta;
    }),
  };
  return client;
}

function launcher(
  signedIn: boolean,
  setup?: (client: ReturnType<typeof fakeClient>) => void,
  passkey: () => PasskeyProvider = () => ({}) as never,
) {
  const client = fakeClient(signedIn);
  setup?.(client);
  const conn = new Connection(
    client as never,
    target as never,
    new SessionStore("merraria", target as never, localStorage),
    passkey,
    localStorage,
  );
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const landing = new Landing(parent, conn, "bundle-hash", invites);
  const chosen = landing.show({ name: "Ada", seed: 1337 });
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    parent.querySelector<T>(`[data-testid="${id}"]`);
  return { client, conn, parent, chosen, $ };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** The launcher's pending-invite store, on the page's storage as in the browser. */
let invites: InviteStore;
/** An invite link opened before the launcher: what `main.ts` leaves in the store. */
function invited(token: string, more: Partial<PendingInvite> = {}) {
  invites.put({ token, org: null, team: null, doc: null, route: null, extra: {}, ...more });
}

beforeEach(() => {
  localStorage.clear();
  invites = createInviteStore("merraria", { storage: localStorage, keep: ["world", "from"] });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("a sign-up's second prompt", () => {
  // Since core #4849 a sign-up takes two prompts. The second is asked right
  // after the first; it waits for Approve only when that failed or was refused
  // (a blocked prompt, Safari's user-gesture rule, a closed prompt).
  function signingUp(get: PasskeyProvider["get"]) {
    const pk = { create: vi.fn(async () => ({}) as never), get: vi.fn(get) };
    const l = launcher(
      false,
      (client) =>
        client.signUp.mockImplementation(async (p: PasskeyProvider) => {
          await p.create({} as never);
          await p.get(new Uint8Array([1]), "example.com", ["new-cred"]);
          return client.signIn();
        }),
      () => pk as unknown as PasskeyProvider,
    );
    return { pk, ...l };
  }
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(check()).toBe(true);
  };
  const notAllowed = (message = "The request is not allowed by the user agent.") =>
    Object.assign(new Error(message), { name: "NotAllowedError" });

  it("asks both prompts back to back, with no click, then lists the account's worlds", async () => {
    const { pk, client, $ } = signingUp(async () => ({}) as never);
    $("sign-up-btn")!.click();
    await until(() => $("account-badge") !== null);
    expect(pk.create).toHaveBeenCalledTimes(1);
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "Ada");
  });

  it("a second prompt refused at once waits for Approve, which then lists the worlds", async () => {
    const { pk, $ } = signingUp(async () => {
      if (pk.get.mock.calls.length === 1) throw notAllowed();
      return {} as never;
    });
    $("sign-up-btn")!.click();
    await until(() => $<HTMLButtonElement>("signup-approve")?.disabled === false && $("signup-approve-step")?.hidden === false);
    expect($("signup-approve")?.textContent).toBe("Approve with your new passkey");
    expect($("signup-approve-note")?.textContent).toBe(SIGN_UP_READY);
    expect($("sign-up-btn")?.hidden).toBe(true);
    expect($("sign-in-error")?.textContent).toBe("");
    expect(pk.get).toHaveBeenCalledTimes(1);
    $("signup-approve")!.click();
    await until(() => $("account-badge") !== null);
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it("a second prompt the person saw and closed shows the error with Approve, which then lists the worlds", async () => {
    const { pk, $ } = signingUp(async () => {
      if (pk.get.mock.calls.length > 1) return {} as never;
      await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
      throw notAllowed("The operation either timed out or was not allowed.");
    });
    $("sign-up-btn")!.click();
    await until(() => $("sign-in-error")?.textContent === SIGN_UP_NOT_FINISHED);
    expect($<HTMLButtonElement>("signup-approve")?.disabled).toBe(false);
    expect($("signup-cancel")?.hidden).toBe(false);
    $("signup-approve")!.click();
    await until(() => $("account-badge") !== null);
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it("shows a second prompt refused after Approve and keeps Approve", async () => {
    const { pk, $ } = signingUp(async () => {
      if (pk.get.mock.calls.length === 1) throw notAllowed();
      await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
      throw notAllowed("The operation either timed out or was not allowed.");
    });
    $("sign-up-btn")!.click();
    await until(() => $<HTMLButtonElement>("signup-approve")?.disabled === false && $("signup-approve-step")?.hidden === false);
    $("signup-approve")!.click();
    await until(() => $("sign-in-error")?.textContent === SIGN_UP_NOT_FINISHED);
    expect(pk.get).toHaveBeenCalledTimes(2);
    expect($<HTMLButtonElement>("signup-approve")?.disabled).toBe(false);

    pk.get.mockImplementation(async () => ({}) as never);
    $("signup-approve")!.click();
    await until(() => $("account-badge") !== null);
  });

  it("Cancel at Approve resets quietly", async () => {
    const { pk, $ } = signingUp(async () => Promise.reject(notAllowed()));
    $("sign-up-btn")!.click();
    await until(() => $<HTMLButtonElement>("signup-approve")?.disabled === false && $("signup-approve-step")?.hidden === false);
    $("signup-cancel")!.click();
    await until(() => $("signup-approve-step")?.hidden === true);
    expect($("sign-up-btn")?.hidden).toBe(false);
    expect($<HTMLButtonElement>("sign-up-btn")?.disabled).toBe(false);
    expect($("sign-in-error")?.textContent).toBe("");
    expect(pk.get).toHaveBeenCalledTimes(1);
  });
});

describe("the launcher", () => {
  it("signs in with a passkey, then lists the account's worlds", async () => {
    const { client, $ } = launcher(false);
    expect($("sign-in-btn")).not.toBeNull();
    $("sign-in-btn")!.click();
    await settle();
    expect(client.signIn).toHaveBeenCalledTimes(1);
    await settle();
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
    expect($("world-card-0")?.textContent).toContain("caves");
    expect($("account-badge")?.textContent).toContain("acct-ada");
  });

  it("enters a listed world and remembers it as the last played", async () => {
    // A world from before names lived on the org: the old launcher name is adopted, not asked.
    localStorage.setItem("mt-name", "Ada");
    const { client, conn, chosen, $ } = launcher(true);
    await settle();
    $("join-world-0")!.click();
    const choice: LaunchChoice = await chosen;
    expect(choice).toEqual({ name: "Ada", world: { appId: "w-1", name: "caves", org: "org-1" } });
    expect(JSON.parse(localStorage.getItem(conn.scopedKey("current-world")!)!)).toEqual(choice.world);
    expect($("name-modal")).toBeNull();
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-1", "acct-ada", { name: "Ada" });
  });

  it("enters a world whose org has the player's name without asking, as that name", async () => {
    localStorage.setItem("mt-name", "Old");
    const { client, chosen, $ } = launcher(true, (c) => {
      c.members["org-1"] = { "acct-ada": { name: "Grace" } };
    });
    await settle();
    expect($("name-input")).toBeNull();
    $("join-world-0")!.click();
    const choice = await chosen;
    expect(choice.name).toBe("Grace");
    expect($("name-modal")).toBeNull();
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it("changes the player's name in a world's org from the card menu", async () => {
    const { client, parent } = launcher(true, (c) => {
      c.members["org-1"] = { "acct-ada": { name: "Grace", color: "red" } };
    });
    await settle();
    parent.querySelector<HTMLElement>("[data-testid=world-card-0] [data-action=rename]")!.click();
    await settle();
    const input = parent.querySelector<HTMLInputElement>("[data-testid=name-modal] input")!;
    expect(input.value).toBe("Grace");
    input.value = "Grace H";
    parent.querySelector<HTMLElement>("[data-testid=name-save-btn]")!.click();
    await settle();
    await settle();
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-1", "acct-ada", { name: "Grace H", color: "red" });
  });

  it("signed out with a pending invite, the launcher is the invitation, with Not now", async () => {
    invited("tok-1");
    const { $ } = launcher(false);
    expect($("invite-waiting")?.textContent).toContain(
      "You've been invited to join a world in Merraria. Sign in or create an account to accept.",
    );
    expect($("sign-in-btn")).not.toBeNull();
    expect($("sign-up-btn")).not.toBeNull();
    expect($("invite-not-now")).not.toBeNull();
  });

  describe("an invitation, once signed in", () => {
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
      expect(check()).toBe(true);
    };
    const THEIRS = { appId: "w-9", name: "their caves", org: "org-9", owner: "o", bundle: "b", package: null, version: null };
    /** The account reaches org-9's worlds only once the invite is redeemed. */
    const joinable = (c: ReturnType<typeof fakeClient>) => {
      let joined = false;
      const mine = c.listApps.getMockImplementation()!;
      c.listApps.mockImplementation(async () => [...(await mine()), ...(joined ? [THEIRS] : [])]);
      c.redeemInvite.mockImplementation(async () => {
        joined = true;
        return { org: "org-9" };
      });
    };

    it("asks which account joins whose game, redeems nothing until Join, then asks the name once and enters the invited world", async () => {
      invited("tok-1", { extra: { from: "Bo" } });
      localStorage.setItem("calimero-names:last", "Grace");
      // The world last played is NOT what an invitation opens (B11).
      const { client, conn, chosen, $ } = launcher(true, joinable);
      localStorage.setItem(conn.scopedKey("current-world")!, JSON.stringify({ appId: "w-1", name: "caves", org: "org-1" }));
      await until(() => $("invite-confirm") !== null);
      expect($("invite-question")?.textContent).toBe("Join Bo's game as acct-ada?");
      await new Promise((r) => setTimeout(r, 30));
      expect(client.redeemInvite).not.toHaveBeenCalled();

      $("invite-join")!.click();
      // Joined: the world's org has no name for the player yet, asked once, prefilled.
      await until(() => $("name-modal") !== null);
      const input = $<HTMLInputElement>("self-name-input")!;
      expect(input.value).toBe("Grace");
      input.value = "Hopper";
      $("name-save-btn")!.click();
      const choice = await chosen;
      expect(choice.name).toBe("Hopper");
      expect(client.setMemberMetadata).toHaveBeenCalledWith("org-9", "acct-ada", { name: "Hopper" });
      expect(client.redeemInvite).toHaveBeenCalledWith("tok-1");
      expect(choice.world).toEqual({ appId: "w-9", name: "their caves", org: "org-9" });
      expect(invites.token()).toBeNull();
    });

    it("signing in from the invitation asks too", async () => {
      invited("tok-1");
      const { client, $ } = launcher(false);
      $("sign-in-btn")!.click();
      await until(() => $("invite-confirm") !== null);
      expect($("invite-question")?.textContent).toBe("Join the game as acct-ada?");
      expect(client.redeemInvite).not.toHaveBeenCalled();
    });

    it("Not now joins nothing, forgets the invite and lists the player's worlds", async () => {
      invited("tok-1");
      const { client, $ } = launcher(true);
      await until(() => $("invite-confirm") !== null);
      $("invite-later")!.click();
      await until(() => $("world-card-0") !== null);
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
      expect($("invite-confirm")).toBeNull();
    });

    it("enters the invited world without spending the link when the player is in it already", async () => {
      invited("tok-1", { org: "org-1" });
      const { client, chosen } = launcher(true, (c) => {
        c.members["org-1"] = { "acct-ada": { name: "Grace" } };
      });
      const choice = await chosen;
      expect(choice.world.appId).toBe("w-1");
      expect(choice.name).toBe("Grace");
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
    });

    it("drops an invite the node refuses for good and says so", async () => {
      invited("tok-1");
      const { CalimeroError } = await import("@calimero-network/mero-js");
      const { $ } = launcher(true, (c) => {
        c.redeemInvite.mockRejectedValueOnce(new CalimeroError(400, "REJECTED", "invite was used up, revoked or never existed"));
      });
      await until(() => $("invite-confirm") !== null);
      $("invite-join")!.click();
      await until(() => $("world-card-0") !== null);
      expect($("notice")?.textContent).toBe(
        "This invite was already used or has expired. Ask the person who invited you for a new link.",
      );
      expect(invites.token()).toBeNull();
    });

    it.each([
      [401, "UNAUTHORIZED", "session expired"],
      [429, "RATE_LIMITED", "too many requests"],
    ])("keeps the invite and the question when the redemption fails with %i", async (status, code, message) => {
      invited("tok-1");
      const { CalimeroError } = await import("@calimero-network/mero-js");
      const { $ } = launcher(true, (c) => {
        c.redeemInvite.mockRejectedValue(new CalimeroError(status, code, message));
      });
      await until(() => $("invite-confirm") !== null);
      $("invite-join")!.click();
      await until(() => /invite is kept/i.test($("invite-error")?.textContent ?? ""));
      expect(invites.token()).toBe("tok-1");
      expect($("invite-join")?.textContent).toBe("Try again");
    });

    it("signing out drops the pending invite, so the next person is not asked to join", async () => {
      const { $ } = launcher(true, (c) =>
        c.signOut.mockImplementation(async () => {
          c.session = null;
        }),
      );
      await until(() => $("world-card-0") !== null);
      invited("tok-1");
      $("disconnect-btn")!.click();
      await until(() => $("sign-in-btn") !== null);
      expect(invites.token()).toBeNull();
      expect($("invite-waiting")).toBeNull();
    });

    it("another account signing in on this browser drops an invite held for the first", async () => {
      invited("tok-1");
      invites.signedIn("acct-other");
      const { client, $ } = launcher(true);
      await until(() => $("world-card-0") !== null);
      expect($("invite-confirm")).toBeNull();
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
    });
  });

  it("creates a world: an org, the instance, then createWorld with the seed", async () => {
    const { client, chosen, $ } = launcher(true);
    await settle();
    $("create-world-open-btn")!.click();
    $<HTMLInputElement>("world-name-input")!.value = "mesa";
    $<HTMLInputElement>("seed-input")!.value = "42";
    // The name is asked here, once, and lives on the world's org.
    expect($<HTMLInputElement>("self-name-input")!.value).toBe("Ada");
    $<HTMLInputElement>("self-name-input")!.value = "Grace";
    $("create-world-btn")!.click();
    const choice = await chosen;
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-new", "acct-ada", { name: "Grace" });
    expect(choice.name).toBe("Grace");
    expect($("name-modal")).toBeNull();
    expect(choice.world).toEqual({ appId: "w-new", name: "mesa", org: "org-new" });
    expect(client.createApp).toHaveBeenCalledWith("mesa", "bundle-hash", { org: "org-new" });
    expect(client.call).toHaveBeenCalledWith("w-new", "createWorld", expect.objectContaining({ name: "mesa", seed: 42 }));
  });

  it("invites friends into the world last played, as a link with the org invite", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const first = launcher(true);
    localStorage.setItem(first.conn.scopedKey("current-world")!, JSON.stringify({ appId: "w-1", name: "caves", org: "org-1" }));
    document.body.innerHTML = "";
    const { client, $ } = launcher(true);
    await settle();
    $("invite-btn")!.click();
    await settle();
    await settle();
    expect(client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("?invite=tok-9&org=org-1&world=w-1&from=Ada"));
  });
});

describe("one sign-in everywhere (@calimero-apps/passkey)", () => {
  const OPEN = { policy: "open", orgInvites: true, signUpInvites: true, inviteRequired: false };
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(check()).toBe(true);
  };
  function withPasskey(setup?: (client: ReturnType<typeof fakeClient>) => void) {
    const pk = {
      create: vi.fn(async () => ({}) as never),
      get: vi.fn(async (..._args: unknown[]) => ({ credentialId: "cred-here" }) as never),
    };
    const l = launcher(
      false,
      (client) => {
        const signedIn = client.signIn.getMockImplementation()!;
        client.signIn.mockImplementation((async (p: PasskeyProvider) => {
          await p.get(new Uint8Array([1]), "calimero.network");
          return signedIn();
        }) as never);
        Object.assign(client, {
          signUpPolicy: vi.fn(async () => OPEN),
          me: vi.fn(async () => ({ orgs: [{ orgId: "org-1" }] })),
        });
        setup?.(client);
      },
      () => pk as unknown as PasskeyProvider,
    );
    return { pk, ...l };
  }
  /** The sign-in card's buttons, top to bottom, by test id. */
  const order = (parent: HTMLElement) =>
    [...parent.querySelectorAll<HTMLElement>("[data-testid=sign-in-btn], [data-testid=sign-up-btn]")].map(
      (b) => b.dataset.testid,
    );

  it("a sign-in offers only the passkeys that worked on this cluster", async () => {
    const first = withPasskey();
    first.$("sign-in-btn")!.click();
    await until(() => first.$("account-badge") !== null);
    expect(first.pk.get.mock.calls[0]?.[2]).toBeUndefined();
    document.body.innerHTML = "";

    const again = withPasskey();
    again.$("sign-in-btn")!.click();
    await until(() => again.$("account-badge") !== null);
    expect(again.pk.get.mock.calls[0]?.[2]).toEqual(["cred-here"]);
  });

  it("says which passkeys work here", () => {
    const { $ } = withPasskey();
    expect($("sign-in-hint")?.textContent).toBe(SIGN_IN_HINT);
  });

  it("a sign-in the cluster has no account for switches to creating one, in place", async () => {
    invited("tok-1");
    localStorage.setItem(accountHintKey(target as never), "1");
    const { CalimeroError } = await import("@calimero-network/mero-js");
    const { parent, $ } = withPasskey((c) =>
      c.signIn.mockRejectedValue(new CalimeroError(401, "PASSKEY_UNKNOWN_HERE", "unknown passkey")),
    );
    expect(order(parent)).toEqual(["sign-in-btn", "sign-up-btn"]);
    $("sign-in-btn")!.click();
    await until(() => $("signin-switched")?.hidden === false);
    expect($("signin-switched")?.textContent).toBe(noAccountCopy("a world", true));
    expect(order(parent)).toEqual(["sign-up-btn", "sign-in-btn"]);
    expect($("sign-up-btn")?.textContent).toBe("Create your account and join");
    expect($("sign-in-error")?.textContent).toBe("");
  });

  it("an invited person with no account here sees Create first; one who has signed in here sees Sign in first", () => {
    invited("tok-1");
    const fresh = withPasskey();
    expect(order(fresh.parent)).toEqual(["sign-up-btn", "sign-in-btn"]);
    document.body.innerHTML = "";
    localStorage.setItem(accountHintKey(target as never), "1");
    const known = withPasskey();
    expect(order(known.parent)).toEqual(["sign-in-btn", "sign-up-btn"]);
  });

  it("a sign-up carries the invite on an open cluster, joins in that step and enters the world", async () => {
    invited("tok-1");
    const { client, chosen, $ } = withPasskey((c) =>
      c.signUp.mockImplementation(async () => {
        c.session = { accountId: "acct-ada", sessionToken: "s", expiresAt: 1, refreshToken: "r" };
        return c.session;
      }),
    );
    await settle();
    $("sign-up-btn")!.click();
    // Joined at sign-up: straight into the world of the org it joined, nothing
    // redeemed; only the player's name in it is asked, once.
    for (let i = 0; i < 100 && !$("name-modal"); i++) await new Promise((r) => setTimeout(r, 20));
    $<HTMLInputElement>("self-name-input")!.value = "Grace";
    $("name-save-btn")!.click();
    const choice = await chosen;
    expect(choice.name).toBe("Grace");
    expect(choice.world.appId).toBe("w-1");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "Ada", { invite: "tok-1" });
    expect(invites.token()).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it("a sign-up the node refuses for its invite drops the token and offers the account without it", async () => {
    invited("tok-dead");
    const { SignUpRefused } = await import("@calimero-network/mero-js");
    const { client, $ } = withPasskey((c) =>
      c.signUp
        .mockRejectedValueOnce(new SignUpRefused("sign-up refused: the invite has expired"))
        .mockImplementation(async () => {
          c.session = { accountId: "acct-ada", sessionToken: "s", expiresAt: 1, refreshToken: "r" };
          return c.session;
        }),
    );
    await settle();
    $("sign-up-btn")!.click();
    await until(() => ($("sign-in-error")?.textContent ?? "") !== "");
    expect($("sign-in-error")?.textContent).toBe(
      "That invite has expired or has no uses left: ask whoever sent it for a new one. You can still create your account without it.",
    );
    expect(invites.token()).toBeNull();
    expect($("invite-waiting")).toBeNull();
    // The next sign-up goes without it.
    $("sign-up-btn")!.click();
    await until(() => $("account-badge") !== null);
    expect(client.signUp).toHaveBeenLastCalledWith(expect.anything(), "Ada");
  });
});

describe("a new version of a world", () => {
  /** What the node reports: world w-1 of org-1 runs 1.0.0 with 1.1.0 waiting; the account is `role` there. */
  function reports(client: Record<string, unknown>, role: string, upgradesHeldBy = "owner") {
    Object.assign(client, {
      me: vi.fn(async () => ({ accountId: "acct-ada", orgs: [{ orgId: "org-1", role }] })),
      // The org already holds the player's name, so entering the world asks for none.
      getOrg: vi.fn(async () => ({
        members: { "acct-ada": role },
        memberMetadata: { "acct-ada": { name: "Ada" } },
        defaultCapabilities: 4,
        capabilities: {},
        teams: {},
      })),
      getApp: vi.fn(async () => ({ appId: "w-1", owner: "someone-else", org: "org-1" })),
      appsReportAll: vi.fn(async (scope: string | null) => ({
        scope: scope ? { kind: "org", org: scope } : { kind: "account" },
        governance: { releases: "owner", appUpgrades: "owner", outbound: "owner" },
        approvedReleases: null,
        clusterReleases: [],
        next: null,
        apps: scope
          ? [
              {
                app: "w-1",
                name: "caves",
                scope: { kind: "org", org: "org-1" },
                package: { package: "com.calimero.merraria", version: "1.0.0" },
                upgradesHeldBy,
                availableVersions: ["1.1.0"],
              },
            ]
          : [],
      })),
      requestConsent: vi.fn(async () => ({ requestId: "r-1", url: "https://node/consent/r-1", expiresAt: 9e9 })),
    });
  }
  const upgradePrompt = () => document.querySelector("[data-testid=upgrade-prompt]");
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 50 && !check(); i++) await settle();
    expect(check()).toBe(true);
  };

  it("offers the world's organization owner the update, and it goes when the world is entered", async () => {
    const { $, chosen } = launcher(true, (c) => reports(c, "owner"));
    await until(() => upgradePrompt() !== null);
    expect(upgradePrompt()!.textContent).toContain("Version 1.1.0 of Merraria is available (you run 1.0.0).");
    $("join-world-0")!.click();
    await chosen;
    expect(upgradePrompt()).toBeNull();
  });

  it("Not now hides it, and it stays hidden for that version", async () => {
    launcher(true, (c) => reports(c, "admin"));
    await until(() => upgradePrompt() !== null);
    (document.querySelector("[data-testid=upgrade-later]") as HTMLElement).click();
    expect(upgradePrompt()).toBeNull();
    document.body.innerHTML = "";
    const again = launcher(true, (c) => reports(c, "admin"));
    await until(() => again.client.listApps.mock.calls.length > 0);
    await settle();
    await settle();
    expect(upgradePrompt()).toBeNull();
  });

  it("shows nothing to a member who may not upgrade, nor where the publisher or the operator upgrades", async () => {
    for (const [role, holder] of [
      ["member", "owner"],
      ["owner", "publisher"],
      ["owner", "operator"],
    ] as const) {
      const { client } = launcher(true, (c) => reports(c, role, holder));
      await until(() => (client as unknown as { appsReportAll: { mock: { calls: unknown[] } } }).appsReportAll.mock.calls.length === 2);
      await settle();
      await settle();
      expect(upgradePrompt()).toBeNull();
      document.body.innerHTML = "";
    }
  });
});
