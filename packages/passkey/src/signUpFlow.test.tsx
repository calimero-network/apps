import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmPromptBlocked, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import type { KeyValueStorage } from "@calimero-apps/connect";

import { PasskeySignIn } from "./PasskeySignIn";
import { usePasskeySession, type SessionDeps } from "./session";
import {
  PROMPT_STUCK_ADVICE,
  SIGN_UP_NOT_FINISHED,
  SIGN_UP_READY,
  SignUpCancelled,
  describeSignUpNotFinished,
  isPromptStuck,
  signUpFlow,
} from "./signUpFlow";

function named(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}
const pending = () => named("NotAllowedError", "A request is already pending.");
const dismissed = () => named("NotAllowedError", "The operation either timed out or was not allowed.");

/** What mero-js `signUp` does with the passkey: create, then (on `412 CONFIRM_REQUIRED`) get, user verification required. */
async function meroSignUp(pk: PasskeyProvider): Promise<{ accountId: string }> {
  await pk.create({});
  try {
    await pk.get(new Uint8Array([1]), "example.com", ["new-cred"], { userVerification: "required" });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "NotAllowedError" || name === "AbortError") {
      throw Object.assign(new Error("the passkey confirmation was cancelled"), { name: "ConfirmCancelled", cause: e });
    }
    throw e;
  }
  return { accountId: "acct-new" };
}

function key(get: PasskeyProvider["get"], create: PasskeyProvider["create"] = async () => ({}) as never) {
  return { create: vi.fn(create), get: vi.fn(get) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await tick();
  expect(check()).toBe(true);
}

describe("signUpFlow", () => {
  it("asks the second prompt right after create, with no click", async () => {
    const pk = key(async () => ({}) as never);
    const stages: (string | null)[] = [];
    const flow = signUpFlow(pk, () => stages.push(flow.stage));
    await expect(meroSignUp(flow.passkey)).resolves.toEqual({ accountId: "acct-new" });
    expect(pk.create).toHaveBeenCalledTimes(1);
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(pk.get).toHaveBeenCalledWith(new Uint8Array([1]), "example.com", ["new-cred"], { userVerification: "required" });
    expect(stages).not.toContain("approve");
  });

  it("a slow failure of that prompt (one the person saw) waits at Approve with the error; Approve then succeeds", async () => {
    let t = 0;
    const pk = key(async () => {
      t += 4000;
      if (pk.get.mock.calls.length === 1) throw dismissed();
      return {} as never;
    });
    const flow = signUpFlow(pk, () => {}, { now: () => t, sleep: async () => {} });
    const run = meroSignUp(flow.passkey);
    await until(() => flow.stage === "approve");
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(flow.confirmFailure).not.toBeNull();
    expect(describeSignUpNotFinished(flow.confirmFailure!.error)).toBe(SIGN_UP_NOT_FINISHED);
    expect(flow.created).toBe(true);
    expect(flow.cancelled).toBe(false);

    flow.approve();
    await expect(run).resolves.toEqual({ accountId: "acct-new" });
    expect(flow.confirmFailure).toBeNull();
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it("any other failure of that prompt (not a NotAllowedError) waits at Approve with the error too", async () => {
    const pk = key(async () => {
      if (pk.get.mock.calls.length === 1) throw named("UnknownError", "The authenticator failed.");
      return {} as never;
    });
    const flow = signUpFlow(pk, () => {}, { now: () => 0, sleep: async () => {} });
    const run = meroSignUp(flow.passkey);
    await until(() => flow.stage === "approve");
    expect(flow.confirmFailure).not.toBeNull();
    flow.approve();
    await expect(run).resolves.toEqual({ accountId: "acct-new" });
  });

  it.each([
    ["an instant NotAllowedError (Safari, no user gesture)", () => named("NotAllowedError", "The request is not allowed by the user agent.")],
    ["a pending prompt", pending],
    ["ConfirmPromptBlocked", () => new ConfirmPromptBlocked(new Error("x"))],
  ])("%s on the first ask waits at Approve; approve() then asks", async (_, refusal) => {
    const pk = key(async () => {
      if (pk.get.mock.calls.length === 1) throw refusal();
      return {} as never;
    });
    const flow = signUpFlow(pk, () => {}, { now: () => 0, sleep: async () => {} });
    const run = meroSignUp(flow.passkey);
    await until(() => flow.stage === "approve");
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(flow.confirmFailure).toBeNull();

    flow.approve();
    await expect(run).resolves.toEqual({ accountId: "acct-new" });
    expect(pk.get).toHaveBeenCalledTimes(2);
    expect(pk.get).toHaveBeenLastCalledWith(new Uint8Array([1]), "example.com", ["new-cred"], { userVerification: "required" });
  });

  it("a blocked prompt that took long still waits at Approve", async () => {
    let t = 0;
    const pk = key(async () => {
      t += 4000;
      if (pk.get.mock.calls.length === 1) throw pending();
      return {} as never;
    });
    const flow = signUpFlow(pk, () => {}, { now: () => t, sleep: async () => {} });
    const run = meroSignUp(flow.passkey);
    await until(() => flow.stage === "approve");
    flow.approve();
    await expect(run).resolves.toEqual({ accountId: "acct-new" });
  });

  /** A sign-up whose first, immediate ask was refused at once (no error shown), now at Approve. */
  async function atApprove(pk: ReturnType<typeof key>, timing: Parameters<typeof signUpFlow>[2] = {}, onChange = () => {}) {
    const flow = signUpFlow(pk, onChange, { now: () => 0, sleep: async () => {}, ...timing });
    const run = meroSignUp(flow.passkey);
    void run.catch(() => {});
    await until(() => flow.stage === "approve");
    return { flow, run };
  }

  it("after a click, a refusal that came back at once is asked again, once", async () => {
    let t = 0;
    const sleep = vi.fn(async () => {});
    const pk = key(async () => {
      if (pk.get.mock.calls.length <= 2) throw pending();
      return {} as never;
    });
    const { flow, run } = await atApprove(pk, { now: () => t, sleep });
    flow.approve();
    await expect(run).resolves.toEqual({ accountId: "acct-new" });
    expect(pk.get).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("after a click, a quick refusal twice is not asked a third time: it waits at Approve with the error", async () => {
    const pk = key(async () => Promise.reject(pending()));
    const { flow } = await atApprove(pk);
    flow.approve();
    await until(() => flow.confirmFailure !== null);
    expect(pk.get).toHaveBeenCalledTimes(3);
    expect(flow.stage).toBe("approve");
    flow.cancel();
  });

  it("after a click, a slow refusal (a prompt the person saw) is not asked again; Approve asks once more", async () => {
    let t = 0;
    const sleep = vi.fn(async () => {});
    const pk = key(async () => {
      const n = pk.get.mock.calls.length;
      if (n === 1) throw pending();
      t += 4000; // the prompt was on screen for 4 s
      if (n === 2) throw dismissed();
      return {} as never;
    });
    const { flow, run } = await atApprove(pk, { now: () => t, sleep });
    flow.approve();
    await until(() => flow.confirmFailure !== null);
    expect(pk.get).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
    expect(flow.stage).toBe("approve");

    flow.approve();
    await expect(run).resolves.toEqual({ accountId: "acct-new" });
    expect(flow.confirmFailure).toBeNull();
    expect(pk.get).toHaveBeenCalledTimes(3);
  });

  it("cancel() at Approve ends the sign-up with SignUpCancelled", async () => {
    const pk = key(async () => {
      if (pk.get.mock.calls.length === 1) throw pending();
      return {} as never;
    });
    const { flow, run } = await atApprove(pk);
    flow.cancel();
    await expect(run).rejects.toBeInstanceOf(SignUpCancelled);
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(flow.cancelled).toBe(true);
  });

  it("a get that follows no create (a sign-in) goes straight through", async () => {
    const pk = key(async () => ({}) as never);
    const flow = signUpFlow(pk);
    await flow.passkey.get(new Uint8Array(), "example.com");
    expect(flow.stage).toBeNull();
    expect(pk.get).toHaveBeenCalledTimes(1);
  });

  it("passes mero-js's userVerification through, before and after a create", async () => {
    const pk = key(async () => ({}) as never);
    const flow = signUpFlow(pk);
    await flow.passkey.get(new Uint8Array([1]), "example.com", ["c"], { userVerification: "required" });
    expect(pk.get).toHaveBeenLastCalledWith(new Uint8Array([1]), "example.com", ["c"], { userVerification: "required" });

    await flow.passkey.create({});
    await flow.passkey.get(new Uint8Array([2]), "example.com", ["new-cred"], { userVerification: "required" });
    expect(pk.get).toHaveBeenLastCalledWith(new Uint8Array([2]), "example.com", ["new-cred"], { userVerification: "required" });
  });

  it("explains a prompt an extension or the browser is still holding", () => {
    expect(isPromptStuck(pending())).toBe(true);
    expect(isPromptStuck(named("NotAllowedError", "The document is not focused."))).toBe(true);
    expect(isPromptStuck(named("InvalidStateError", "x"))).toBe(true);
    expect(isPromptStuck(new Error("wrapped", { cause: pending() }))).toBe(true);
    expect(isPromptStuck(new ConfirmPromptBlocked(new Error("x")))).toBe(true);
    expect(isPromptStuck(dismissed())).toBe(false);
    expect(describeSignUpNotFinished(dismissed())).toBe(SIGN_UP_NOT_FINISHED);
    expect(describeSignUpNotFinished(pending())).toBe(`${SIGN_UP_NOT_FINISHED} ${PROMPT_STUCK_ADVICE}`);
    expect(describeSignUpNotFinished(new ConfirmPromptBlocked(pending()), true)).toContain(PROMPT_STUCK_ADVICE);
  });
});

describe("a sign-up in the control", () => {
  function memoryStorage(): KeyValueStorage {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  }

  function setup(pk: PasskeyProvider) {
    const client = {
      session: null as null | { accountId: string },
      signIn: vi.fn(async () => ({ accountId: "acct-in" })),
      signUp: vi.fn(async (p: PasskeyProvider) => {
        const s = await meroSignUp(p);
        client.session = s;
        return s;
      }),
      signOut: vi.fn(async () => {}),
      useSession: vi.fn(),
    };
    const d: SessionDeps = {
      env: { DEV: true },
      makeClient: async () => client as unknown as CalimeroClient,
      passkey: () => pk,
      storage: memoryStorage(),
    };
    function Panel() {
      const api = usePasskeySession("test-app", d);
      return api.session.status === "signed-out" ? (
        <PasskeySignIn api={api} />
      ) : (
        <p data-testid="status">{api.session.status}</p>
      );
    }
    return { client, ...render(<Panel />) };
  }

  it("asks both prompts back to back, with no click, then signs in", async () => {
    const pk = key(async () => ({}) as never);
    setup(pk);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-in"));
    expect(pk.create).toHaveBeenCalledTimes(1);
    expect(pk.get).toHaveBeenCalledTimes(1);
  });

  it("falls back to Approve when the browser refused the second prompt at once, then signs in", async () => {
    const safari = () => named("NotAllowedError", "The request is not allowed by the user agent.");
    const pk = key(async () => {
      if (pk.get.mock.calls.length === 1) throw safari();
      return {} as never;
    });
    setup(pk);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    const approve = await screen.findByTestId("signup-approve");
    await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
    expect(approve.textContent).toBe("Approve with your new passkey");
    expect(screen.getByText(SIGN_UP_READY)).toBeTruthy();
    expect(screen.queryByTestId("signin-error")).toBeNull();
    expect(pk.get).toHaveBeenCalledTimes(1);

    fireEvent.click(approve);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-in"));
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it("shows a refused second prompt after Approve instead of swallowing it, and keeps Approve", async () => {
    const pk = key(async () => Promise.reject(named("NotAllowedError", "The document is not focused.")));
    setup(pk);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    const approve = await screen.findByTestId("signup-approve");
    await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(approve);

    const error = await screen.findByTestId("signin-error", {}, { timeout: 3000 });
    expect(error.textContent).toBe(`${SIGN_UP_NOT_FINISHED} ${PROMPT_STUCK_ADVICE}`);
    // Once right away; after the click refused at once, so asked twice; then it waits for the person.
    expect(pk.get).toHaveBeenCalledTimes(3);
    expect((screen.getByTestId("signup-approve") as HTMLButtonElement).disabled).toBe(false);

    pk.get.mockImplementation(async () => ({}) as never);
    fireEvent.click(screen.getByTestId("signup-approve"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-in"));
  });

  it("a dismissed first prompt stays a quiet cancel", async () => {
    const pk = key(
      async () => ({}) as never,
      async () => Promise.reject(dismissed()),
    );
    const { client } = setup(pk);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await waitFor(() => expect(client.signUp).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByTestId("signup-passkey") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("signin-error")).toBeNull();
    expect(screen.queryByTestId("signup-approve")).toBeNull();
  });

  it("Cancel at Approve resets quietly", async () => {
    const pk = key(async () => Promise.reject(pending()));
    setup(pk);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    fireEvent.click(await screen.findByTestId("signup-cancel"));
    await waitFor(() => expect(screen.queryByTestId("signup-approve")).toBeNull());
    expect((screen.getByTestId("signup-passkey") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("signin-error")).toBeNull();
    expect(pk.get).toHaveBeenCalledTimes(1);
  });
});
