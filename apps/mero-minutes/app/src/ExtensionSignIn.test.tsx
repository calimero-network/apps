import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const finish = vi.fn();
vi.mock("@calimero-apps/passkey/native", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  finishNativeSignIn: (options: unknown) => finish(options),
}));

const session = { current: { status: "signed-in", client: { id: "client" } } as Record<string, unknown> };
const clear = vi.fn();
vi.mock("./sessionContext", () => ({
  useSessionApi: () => ({ api: { session: session.current, store: { clear }, busy: false } }),
}));
vi.mock("./SignIn", () => ({ SignInPanel: () => <div data-testid="signin-panel" /> }));

import { ExtensionSignIn } from "./App";
import { NATIVE_CALLBACK } from "./native";

afterEach(() => {
  cleanup();
  finish.mockReset();
  clear.mockReset();
});

describe("ExtensionSignIn", () => {
  it("asks a signed-out person to sign in for the extension", () => {
    session.current = { status: "signed-out", client: {} };
    render(<ExtensionSignIn />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign in to the Minutes extension");
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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Signing you in to the Minutes extension…");
    await screen.findByText("You are signed in");
    expect(screen.getByText(/You can close this tab/)).toBeTruthy();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]![0]).toMatchObject({ client: { id: "client" }, callback: NATIVE_CALLBACK });
    await waitFor(() => expect(clear).toHaveBeenCalled());
  });
});
