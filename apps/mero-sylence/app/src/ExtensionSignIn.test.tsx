import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const finish = vi.fn();
vi.mock("@calimero-apps/passkey/native", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  finishNativeSignIn: (options: unknown) => finish(options),
}));

const session = { current: { status: "signed-in", client: { id: "client" } } as Record<string, unknown> };
const clear = vi.fn();
const workspaces = { current: [{ appId: "w1", name: "Team", org: "o1", owner: "a" }] as unknown[] };
vi.mock("./sessionContext", () => ({
  useSessionApi: () => ({ api: { session: session.current, store: { clear }, busy: false } }),
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
  it("asks a signed-out person to sign in for the extension", () => {
    session.current = { status: "signed-out", client: {} };
    render(<ExtensionSignIn />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign in to the Sylence extension");
    expect(screen.getByTestId("signin-panel")).toBeTruthy();
    expect(finish).not.toHaveBeenCalled();
  });

  it("hands a signed-in session to the extension's fixed callback and forgets it here", async () => {
    session.current = { status: "signed-in", client: { id: "client" } };
    finish.mockImplementation(async (options: { forgetHere: () => void }) => {
      options.forgetHere();
      return true;
    });
    render(<ExtensionSignIn />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Signing you in to the Sylence extension…");
    await screen.findByText("You are signed in");
    expect(screen.getByText(/You can close this tab/)).toBeTruthy();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]![0]).toMatchObject({ client: { id: "client" }, callback: NATIVE_CALLBACK });
    await waitFor(() => expect(clear).toHaveBeenCalled());
  });

  it("with no workspace yet, offers one before the handoff, then hands off", async () => {
    workspaces.current = [];
    session.current = { status: "signed-in", client: { id: "client" } };
    finish.mockResolvedValue(true);
    render(<ExtensionSignIn />);
    expect(await screen.findByRole("heading", { level: 1, name: "Create your first workspace" })).toBeTruthy();
    expect(finish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start a new workspace" }));
    await screen.findByText("You are signed in");
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("lets the person skip the workspace step", async () => {
    workspaces.current = [];
    session.current = { status: "signed-in", client: { id: "client" } };
    finish.mockResolvedValue(true);
    render(<ExtensionSignIn />);
    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
    await screen.findByText("You are signed in");
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

  it("a plain sign-in forgets an earlier create intent", () => {
    captureSignInIntent({ hash: "#native-sign-in&state=s&key=k&intent=create" });
    captureSignInIntent({ hash: "#native-sign-in&state=s&key=k" });
    expect(sessionStorage.getItem("sylence:native-intent")).toBeNull();
  });
});
