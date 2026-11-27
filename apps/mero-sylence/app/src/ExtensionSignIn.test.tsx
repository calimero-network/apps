import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const finish = vi.fn();
vi.mock("@calimero-apps/passkey/native", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  finishNativeSignIn: (options: unknown) => finish(options),
}));

const session = { current: { status: "signed-in", client: { id: "client" } } as Record<string, unknown> };
const clear = vi.fn();
const signIn = vi.fn(async () => undefined);
const signUp = vi.fn(async () => undefined);
const workspaces = { current: [{ appId: "w1", name: "Team", org: "o1", owner: "a" }] as unknown[] };
vi.mock("./sessionContext", () => ({
  useSessionApi: () => ({ api: { session: session.current, store: { clear }, busy: false, error: null, signIn, signUp } }),
  useMaybeSignedIn: () =>
    session.current.status === "signed-in" ? { client: session.current.client, source: "bundle", after: () => undefined } : null,
}));
vi.mock("./lib/orgs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listWorkspaces: async () => workspaces.current,
}));
const pickerProps = { createOnly: undefined as boolean | undefined };
vi.mock("./WorkspacePicker", () => ({
  WorkspacePicker: ({ onOpen, createOnly }: { onOpen: (w: unknown) => void; createOnly?: boolean }) => {
    pickerProps.createOnly = createOnly;
    return (
      <button type="button" onClick={() => onOpen({ appId: "new", org: "o1" })}>
        Start a new workspace
      </button>
    );
  },
}));
vi.mock("./SignIn", () => ({ SignInPanel: () => <div data-testid="signin-panel" /> }));
const named = { current: null as { name: string; self: string } | null };
vi.mock("./CreateNamedWorkspace", () => ({
  CreateNamedWorkspace: ({ request, onDone }: { request: { name: string; self: string }; onDone: () => void }) => {
    named.current = request;
    return (
      <button type="button" onClick={onDone}>
        Created {request.name}
      </button>
    );
  },
}));

import { ExtensionSignIn } from "./App";
import { NATIVE_CALLBACK, captureSignInIntent } from "./native";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  workspaces.current = [{ appId: "w1", name: "Team", org: "o1", owner: "a" }];
  finish.mockReset();
  clear.mockReset();
});

describe("ExtensionSignIn", () => {
  it("signing in from the extension goes straight to the passkey, no form", async () => {
    session.current = { status: "signed-out", client: {} };
    signIn.mockClear();
    render(<ExtensionSignIn />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign in with your passkey");
    expect(screen.queryByTestId("signin-panel")).toBeNull();
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(finish).not.toHaveBeenCalled();
  });

  it("falls back to the full sign-in when the passkey prompt fails", async () => {
    session.current = { status: "signed-out", client: {} };
    signIn.mockRejectedValueOnce(new Error("cancelled"));
    render(<ExtensionSignIn />);
    expect(await screen.findByTestId("signin-panel")).toBeTruthy();
  });

  it("a new account filled in in the extension is created with one passkey prompt, then its workspace", async () => {
    session.current = { status: "signed-out", client: {} };
    captureSignInIntent({ hash: "#native-sign-in&state=s&key=k&intent=signup&name=Eve&label=Work%20laptop&ws=Launch%20team" });
    signUp.mockClear();
    render(<ExtensionSignIn />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Create your passkey");
    await waitFor(() => expect(signUp).toHaveBeenCalledWith("Eve", { passkeyLabel: "Work laptop" }));
  });

  it("hands a signed-in session to the extension's fixed callback and forgets it here", async () => {
    session.current = { status: "signed-in", client: { id: "client" } };
    finish.mockImplementation(async (options: { forgetHere: () => void }) => {
      options.forgetHere();
      return true;
    });
    render(<ExtensionSignIn />);
    await screen.findByText("You are signed in");
    expect(screen.getByText(/You can close this tab/)).toBeTruthy();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]![0]).toMatchObject({ client: { id: "client" }, callback: NATIVE_CALLBACK });
    await waitFor(() => expect(clear).toHaveBeenCalled());
  });

  it("with no workspace yet, still hands off at once: the extension offers workspaces itself", async () => {
    workspaces.current = [];
    session.current = { status: "signed-in", client: { id: "client" } };
    finish.mockResolvedValue(true);
    render(<ExtensionSignIn />);
    await screen.findByText("You are signed in");
    expect(finish).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Create your first workspace")).toBeNull();
  });

  it("a workspace named in the extension is created here, then the session is handed over", async () => {
    session.current = { status: "signed-in", client: { id: "client" } };
    captureSignInIntent({ hash: "#native-sign-in&state=s&key=k&intent=create&name=Launch%20team&self=Eve" });
    finish.mockResolvedValue(true);
    render(<ExtensionSignIn />);
    fireEvent.click(await screen.findByRole("button", { name: "Created Launch team" }));
    expect(named.current).toEqual({ name: "Launch team", self: "Eve" });
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
  });

  it("asked to create one: shows the start form even with workspaces, then hands over", async () => {
    session.current = { status: "signed-in", client: { id: "client" } };
    captureSignInIntent({ hash: "#native-sign-in&state=s&key=k&intent=create" });
    finish.mockResolvedValue(true);
    render(<ExtensionSignIn />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Create a workspace");
    expect(pickerProps.createOnly).toBe(true);
    expect(finish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start a new workspace" }));
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
  });

  it("a workspace named in the extension asks only for the passkey, started at once", async () => {
    session.current = { status: "signed-out", client: {} };
    captureSignInIntent({ hash: "#native-sign-in&state=s&key=k&intent=create&name=Launch%20team" });
    signIn.mockClear();
    render(<ExtensionSignIn />);
    expect(await screen.findByRole("heading", { name: "Sign in with your passkey" })).toBeTruthy();
    expect(screen.getByText(/To create “Launch team”/)).toBeTruthy();
    expect(screen.queryByTestId("signin-panel")).toBeNull();
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
  });

  it("a plain sign-in forgets an earlier create intent", () => {
    captureSignInIntent({ hash: "#native-sign-in&state=s&key=k&intent=create" });
    captureSignInIntent({ hash: "#native-sign-in&state=s&key=k" });
    expect(sessionStorage.getItem("sylence:native-intent")).toBeNull();
  });
});
