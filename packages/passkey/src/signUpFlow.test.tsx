import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { KeyValueStorage } from "@calimero-apps/connect";

import { PasskeySignIn } from "./PasskeySignIn";
import { usePasskeySession, type SessionDeps } from "./session";
import {
  PROMPT_STUCK_ADVICE,
  SIGN_UP_NOT_FINISHED,
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

/** What mero-js `signUp` does with the passkey: create, then (on `412 CONFIRM_REQUIRED`) get. */
async function meroSignUp(pk: PasskeyProvider): Promise<{ accountId: string }> {
  await pk.create({});
  try {
    await pk.get(new Uint8Array([1]), "example.com", ["new-cred"]);
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
  it("the second prompt waits for approve()", async () => {
    const pk = key(async () => ({}) as never);
    const flow = signUpFlow(pk);
    const run = meroSignUp(flow.passkey);
    await until(() => flow.stage === "approve");
    expect(flow.created).toBe(true);
    expect(pk.create).toHaveBeenCalledTimes(1);
    expect(pk.get).not.toHaveBeenCalled();

    flow.approve();
    await expect(run).resolves.toEqual({ accountId: "acct-new" });
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(pk.get).toHaveBeenCalledWith(new Uint8Array([1]), "example.com", ["new-cred"]);
  });

  it("a refusal that came back at once is asked again, once", async () => {
    let t = 0;
    const sleep = vi.fn(async () => {});
    const pk = key(async () => {
      if (pk.get.mock.calls.length === 1) throw pending();
      return {} as never;
    });
    const flow = signUpFlow(pk, () => {}, { now: () => t, sleep });
    const run = meroSignUp(flow.passkey);
    await until(() => flow.stage === "approve");
    flow.approve();
    await expect(run).resolves.toEqual({ accountId: "acct-new" });
    expect(pk.get).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("a quick refusal twice is not asked a third time: it waits at Approve with the error", async () => {
    const pk = key(async () => Promise.reject(pending()));
    const flow = signUpFlow(pk, () => {}, { now: () => 0, sleep: async () => {} });
    void meroSignUp(flow.passkey).catch(() => {});
    await until(() => flow.stage === "approve");
    flow.approve();
    await until(() => flow.confirmFailure !== null);
    expect(pk.get).toHaveBeenCalledTimes(2);
    expect(flow.stage).toBe("approve");
    flow.cancel();
  });

  it("a slow refusal (a prompt the person saw) is not asked again; Approve asks once more", async () => {
    let t = 0;
    const sleep = vi.fn(async () => {});
    const pk = key(async () => {
      t += 4000; // the prompt was on screen for 4 s
      if (pk.get.mock.calls.length === 1) throw dismissed();
      return {} as never;
    });
    const changes = vi.fn();
    const flow = signUpFlow(pk, changes, { now: () => t, sleep });
    const run = meroSignUp(flow.passkey);
    await until(() => flow.stage === "approve");
    flow.approve();
    await until(() => flow.confirmFailure !== null);
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(flow.stage).toBe("approve");

    flow.approve();
    await expect(run).resolves.toEqual({ accountId: "acct-new" });
    expect(flow.confirmFailure).toBeNull();
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it("cancel() at Approve ends the sign-up with SignUpCancelled", async () => {
    const pk = key(async () => ({}) as never);
    const flow = signUpFlow(pk);
    const run = meroSignUp(flow.passkey);
    await until(() => flow.stage === "approve");
    flow.cancel();
    await expect(run).rejects.toBeInstanceOf(SignUpCancelled);
    expect(pk.get).not.toHaveBeenCalled();
  });

  it("a get that follows no create (a sign-in) goes straight through", async () => {
    const pk = key(async () => ({}) as never);
    const flow = signUpFlow(pk);
    await flow.passkey.get(new Uint8Array(), "example.com");
    expect(flow.stage).toBeNull();
    expect(pk.get).toHaveBeenCalledTimes(1);
  });

  it("explains a prompt an extension or the browser is still holding", () => {
    expect(isPromptStuck(pending())).toBe(true);
    expect(isPromptStuck(named("NotAllowedError", "The document is not focused."))).toBe(true);
    expect(isPromptStuck(named("InvalidStateError", "x"))).toBe(true);
    expect(isPromptStuck(new Error("wrapped", { cause: pending() }))).toBe(true);
    expect(isPromptStuck(dismissed())).toBe(false);
    expect(describeSignUpNotFinished(dismissed())).toBe(SIGN_UP_NOT_FINISHED);
    expect(describeSignUpNotFinished(pending())).toBe(`${SIGN_UP_NOT_FINISHED} ${PROMPT_STUCK_ADVICE}`);
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

  it("asks for the second prompt only after Approve, then signs in", async () => {
    const pk = key(async () => ({}) as never);
    setup(pk);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    const approve = await screen.findByTestId("signup-approve");
    expect(approve.textContent).toBe("Approve with your new passkey");
    expect(screen.getByText("Your passkey is saved. One more tap creates your account.")).toBeTruthy();
    expect(pk.get).not.toHaveBeenCalled();

    fireEvent.click(approve);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-in"));
    expect(pk.get).toHaveBeenCalledTimes(1);
  });

  it("shows a refused second prompt instead of swallowing it, and keeps Approve", async () => {
    const pk = key(async () => Promise.reject(named("NotAllowedError", "The document is not focused.")));
    setup(pk);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    fireEvent.click(await screen.findByTestId("signup-approve"));

    const error = await screen.findByTestId("signin-error", {}, { timeout: 3000 });
    expect(error.textContent).toBe(`${SIGN_UP_NOT_FINISHED} ${PROMPT_STUCK_ADVICE}`);
    // Refused at once, so asked twice; then it waits for the person.
    expect(pk.get).toHaveBeenCalledTimes(2);
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
    const pk = key(async () => ({}) as never);
    setup(pk);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await screen.findByTestId("signup-approve");
    fireEvent.click(screen.getByTestId("signup-cancel"));
    await waitFor(() => expect(screen.queryByTestId("signup-approve")).toBeNull());
    expect((screen.getByTestId("signup-passkey") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("signin-error")).toBeNull();
    expect(pk.get).not.toHaveBeenCalled();
  });
});
