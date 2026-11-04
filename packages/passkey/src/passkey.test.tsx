import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { KeyValueStorage } from "@calimero-apps/connect";

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

  it("is unconfigured when the target cannot be resolved", async () => {
    const d: SessionDeps = {
      ...deps(fakeClient()),
      env: { DEV: false, PROD: true, VITE_CALIMERO_CLUSTER: "eu-shared-1" },
    };
    const { result } = renderHook(() => usePasskeySession("test-app", d));
    await waitFor(() => expect(result.current.session.status).toBe("unconfigured"));
    expect(result.current.session).toMatchObject({ message: expect.stringMatching(/VITE_CALIMERO_MIN_RELEASE/) });
  });

  it("says a listing page no cluster serves is opened from Calimero Cloud", async () => {
    const d: SessionDeps = { ...deps(fakeClient()), env: { DEV: false, PROD: true }, servedNodes: async () => null };
    const { result } = renderHook(() => usePasskeySession("test-app", d));
    await waitFor(() => expect(result.current.session.status).toBe("unconfigured"));
    expect(result.current.session).toMatchObject({ message: expect.stringMatching(/test-app's listing page/) });
  });

  it("reports a listing page as its own status when the app asks", async () => {
    const d: SessionDeps = { ...deps(fakeClient()), env: { DEV: false, PROD: true }, servedNodes: async () => null };
    const { result } = renderHook(() => usePasskeySession("test-app", d, { listing: true }));
    await waitFor(() => expect(result.current.session.status).toBe("listing"));
    expect(result.current.session).toMatchObject({
      status: "listing",
      console: "https://cloud.calimero.network",
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
