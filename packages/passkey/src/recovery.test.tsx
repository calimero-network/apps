import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CalimeroError,
  NotFound,
  RecoveryNotReady,
  WrongRecoveryCode,
  type AccountRecovery,
  type CalimeroClient,
  type PasskeyProvider,
} from "@calimero-network/mero-js";
import type { KeyValueStorage } from "@calimero-apps/connect";

import { PasskeySignIn, type PasskeySignInApi } from "./PasskeySignIn";
import { RecoveryAlert } from "./RecoverAccount";
import { CONSOLE_PASSKEYS, describeRecoveryError, timeLeft } from "./recovery";
import { usePasskeySession, type RecoveryApi, type SessionDeps } from "./session";

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 3600;

function pending(over: Partial<AccountRecovery> = {}): AccountRecovery {
  return { accountId: "acct-1", credentialId: "cred-new", startedAt: NOW, readyAt: NOW + 72 * HOUR, ...over };
}

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
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
      client.session = { accountId: "acct-1" };
      return client.session;
    }),
    signOut: vi.fn(async () => {
      client.session = null;
    }),
    useSession: vi.fn(),
    me: vi.fn(async () => ({ recoveryCode: true, recoveryPending: null as AccountRecovery | null })),
    startAccountRecovery: vi.fn(async () => pending()),
    finishAccountRecovery: vi.fn(async () => {
      client.session = { accountId: "acct-1" };
      return client.session;
    }),
    cancelAccountRecovery: vi.fn(async () => {}),
    ...over,
  };
  return client;
}

function deps(client: ReturnType<typeof fakeClient>, storage = memoryStorage()): SessionDeps {
  return {
    env: { DEV: true },
    makeClient: async () => client as unknown as CalimeroClient,
    passkey: () => ({}) as PasskeyProvider,
    storage,
  };
}

async function signedOut(client: ReturnType<typeof fakeClient>, d = deps(client)) {
  const hook = renderHook(() => usePasskeySession("test-app", d));
  await waitFor(() => expect(hook.result.current.session.status).toBe("signed-out"));
  return hook;
}

describe("account recovery in usePasskeySession", () => {
  it("starts with the code and a new passkey, stays signed out, and keeps the recovery for later", async () => {
    const client = fakeClient();
    const storage = memoryStorage();
    const d = deps(client, storage);
    const { result, unmount } = await signedOut(client, d);
    expect(result.current.recovery.where).toEqual({ kind: "here" });

    await act(() => result.current.recovery.start("  abcd-efgh  "));
    expect(client.startAccountRecovery).toHaveBeenCalledWith("abcd-efgh", expect.anything());
    expect(result.current.session.status).toBe("signed-out");
    expect(result.current.recovery.started).toMatchObject({ accountId: "acct-1", readyAt: NOW + 72 * HOUR });
    unmount();

    // Back days later in a new tab: the recovery is still there to finish.
    const again = await signedOut(client, d);
    expect(again.result.current.recovery.started).toMatchObject({ accountId: "acct-1" });
  });

  it("says a wrong or spent code in words", async () => {
    const client = fakeClient({
      startAccountRecovery: vi.fn(async () => Promise.reject(new WrongRecoveryCode("unknown or used recovery code"))),
    });
    const { result } = await signedOut(client);
    await act(() => result.current.recovery.start("nope"));
    expect(result.current.error).toMatch(/doesn't match this account's/);
    expect(result.current.recovery.started).toBeNull();
  });

  it("treats a dismissed create prompt as a quiet cancel", async () => {
    const client = fakeClient({ startAccountRecovery: vi.fn(async () => Promise.reject(cancelled())) });
    const { result } = await signedOut(client);
    await act(() => result.current.recovery.start("code"));
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("finishes with the new passkey, signs in, and forgets the kept recovery", async () => {
    const client = fakeClient();
    const storage = memoryStorage();
    const { result } = await signedOut(client, deps(client, storage));
    await act(() => result.current.recovery.start("code"));

    await act(() => result.current.recovery.finish());
    expect(client.finishAccountRecovery).toHaveBeenCalledWith(expect.anything(), "acct-1");
    expect(result.current.session).toMatchObject({ status: "signed-in", accountId: "acct-1" });
    expect(result.current.recovery.started).toBeNull();
    expect([...storage.map.keys()].some((k) => k.startsWith("calimero-recovery:"))).toBe(false);
  });

  it("refuses an early finish with the time it can finish", async () => {
    const readyAt = NOW + 5 * HOUR;
    const client = fakeClient({
      finishAccountRecovery: vi.fn(async () =>
        Promise.reject(new RecoveryNotReady("too early", { readyAt })),
      ),
    });
    const { result } = await signedOut(client);
    await act(() => result.current.recovery.finish());
    expect(result.current.session.status).toBe("signed-out");
    expect(result.current.error).toMatch(/^Not yet: the recovery can finish on /);
  });

  it("reads a recovery under way once signed in, and cancels it with a passkey", async () => {
    const client = fakeClient({ me: vi.fn(async () => ({ recoveryPending: pending() })) });
    const { result } = await signedOut(client);
    await act(() => result.current.signIn());
    await waitFor(() => expect(result.current.recovery.underWay).toMatchObject({ credentialId: "cred-new" }));

    await act(() => result.current.recovery.cancel());
    expect(client.cancelAccountRecovery).toHaveBeenCalled();
    expect(result.current.recovery.underWay).toBeNull();
  });

  it("on a Calimero Cloud app sends recovery to the console and never runs it in place", async () => {
    const client = fakeClient();
    const d: SessionDeps = {
      ...deps(client),
      env: { DEV: false, PROD: true, VITE_CALIMERO_MIN_RELEASE: "2.3.136" },
      servedNodes: async () => ["https://n1.example"],
    };
    const { result } = renderHook(() => usePasskeySession("test-app", d, { package: "com.example.test" }));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    expect(result.current.recovery.where).toEqual({ kind: "console", url: CONSOLE_PASSKEYS });

    await act(() => result.current.recovery.start("code"));
    expect(client.startAccountRecovery).not.toHaveBeenCalled();
  });
});

describe("describeRecoveryError and timeLeft", () => {
  it("names each refusal", () => {
    expect(describeRecoveryError(new CalimeroError(409, "RECOVERY_PENDING", "pending"), "start")).toMatch(
      /already under way/,
    );
    expect(describeRecoveryError(new NotFound("no route"), "start")).toMatch(/doesn't offer account recovery yet/);
    expect(describeRecoveryError(new NotFound("none"), "finish")).toMatch(/cancelled with one of the account's passkeys/);
    expect(describeRecoveryError(new Error("node down"), "cancel")).toBe("node down");
  });

  it("counts down in days, hours and minutes", () => {
    const now = NOW * 1000;
    expect(timeLeft(NOW + 72 * HOUR, now)).toBe("3 days");
    expect(timeLeft(NOW + 47 * HOUR + 30 * 60, now)).toBe("1 day 23 hours");
    expect(timeLeft(NOW + 90 * 60, now)).toBe("1 hour 30 minutes");
    expect(timeLeft(NOW + 30, now)).toBe("1 minute");
    expect(timeLeft(NOW, now)).toBeNull();
  });
});

function recoveryApi(over: Partial<RecoveryApi> = {}): RecoveryApi {
  return {
    where: { kind: "here" },
    started: null,
    start: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
    forget: vi.fn(),
    underWay: null,
    cancel: vi.fn(async () => {}),
    ...over,
  };
}

function signInApi(recovery?: RecoveryApi, over: Partial<PasskeySignInApi> = {}): PasskeySignInApi {
  return { busy: false, error: null, signIn: vi.fn(async () => {}), signUp: vi.fn(async () => {}), recovery, ...over };
}

describe("PasskeySignIn: lost your passkey", () => {
  it("has no recovery link without a recovery api", () => {
    render(<PasskeySignIn api={signInApi()} />);
    expect(screen.queryByTestId("recovery-open")).toBeNull();
  });

  it("opens the code form, starts with the code, and goes back", () => {
    const recovery = recoveryApi();
    render(<PasskeySignIn api={signInApi(recovery)} />);
    fireEvent.click(screen.getByText("Lost your passkey? Use a recovery code"));
    expect(screen.getByText(/72 hours later/)).toBeTruthy();
    const start = screen.getByTestId("recovery-start") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("recovery-code"), { target: { value: "ABCD-1234" } });
    fireEvent.click(start);
    expect(recovery.start).toHaveBeenCalledWith("ABCD-1234");

    fireEvent.click(screen.getByTestId("recovery-back"));
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
  });

  it("opens on a started recovery: when it can finish, what happens meanwhile, finish disabled until then", () => {
    const recovery = recoveryApi({ started: pending({ readyAt: NOW + 50 * HOUR }) });
    render(<PasskeySignIn api={signInApi(recovery)} />);
    expect(screen.getByText("Recovery in progress")).toBeTruthy();
    expect(screen.getByTestId("recovery-ready-at").textContent).toMatch(/in 2 days 2 hours/);
    expect(screen.getByText(/can cancel the recovery/)).toBeTruthy();
    expect((screen.getByTestId("recovery-finish") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("recovery-forget"));
    expect(recovery.forget).toHaveBeenCalled();
  });

  it("finishes once the delay passed", () => {
    const recovery = recoveryApi({ started: pending({ startedAt: NOW - 73 * HOUR, readyAt: NOW - HOUR }) });
    render(<PasskeySignIn api={signInApi(recovery)} />);
    expect(screen.getByText("Ready to finish")).toBeTruthy();
    const finish = screen.getByTestId("recovery-finish") as HTMLButtonElement;
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish);
    expect(recovery.finish).toHaveBeenCalled();
  });

  it("shows a recovery error", () => {
    const recovery = recoveryApi();
    render(<PasskeySignIn api={signInApi(recovery, { error: "That recovery code doesn't match" })} />);
    fireEvent.click(screen.getByTestId("recovery-open"));
    expect(screen.getByTestId("recovery-error").textContent).toContain("doesn't match");
  });

  it("on a Calimero Cloud app links to the console instead", () => {
    const recovery = recoveryApi({ where: { kind: "console", url: CONSOLE_PASSKEYS } });
    render(<PasskeySignIn api={signInApi(recovery)} />);
    fireEvent.click(screen.getByTestId("recovery-open"));
    const link = screen.getByTestId("recovery-open-console") as HTMLAnchorElement;
    expect(link.href).toBe(CONSOLE_PASSKEYS);
    expect(link.target).toBe("_blank");
    expect(screen.queryByTestId("recovery-code")).toBeNull();
  });
});

describe("RecoveryAlert", () => {
  const api = (recovery: RecoveryApi, error: string | null = null) => ({ busy: false, error, recovery });

  it("renders nothing with no recovery under way", () => {
    const { container } = render(<RecoveryAlert api={api(recoveryApi())} />);
    expect(container.firstChild).toBeNull();
  });

  it("warns and cancels in place", () => {
    const recovery = recoveryApi({ underWay: pending({ readyAt: NOW + 10 * HOUR }) });
    render(<RecoveryAlert api={api(recovery)} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Someone is recovering this account/);
    expect(screen.getByRole("alert").textContent).toMatch(/this one included/);
    fireEvent.click(screen.getByTestId("recovery-cancel"));
    expect(recovery.cancel).toHaveBeenCalled();
  });

  it("links to the console to cancel on a Calimero Cloud app", () => {
    const recovery = recoveryApi({
      where: { kind: "console", url: CONSOLE_PASSKEYS },
      underWay: pending(),
    });
    render(<RecoveryAlert api={api(recovery)} />);
    expect((screen.getByTestId("recovery-cancel-console") as HTMLAnchorElement).href).toBe(CONSOLE_PASSKEYS);
    expect(screen.queryByTestId("recovery-cancel")).toBeNull();
  });
});
