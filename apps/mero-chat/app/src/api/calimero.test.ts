import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  LoginRequired,
  type CalimeroClient,
  type PasskeyProvider,
} from "@calimero-network/mero-js";
import { PASSKEY_UNKNOWN_HERE_MESSAGE } from "@calimero-apps/connect";

import { __setForTests, signIn, useCalimero } from "./calimero";

describe("signIn", () => {
  // The node's answer to a passkey it has no account for (one made before
  // eu-shared-1 was recreated, or on another cluster). The popup showed
  // "Sign in first." for it, which reads as if no sign-in had been tried.
  it("tells a person their passkey is unknown on this cluster, not 'Sign in first.'", async () => {
    const client = {
      session: undefined,
      signIn: vi.fn(async () =>
        Promise.reject(new LoginRequired("unknown passkey")),
      ),
    } as unknown as CalimeroClient;
    __setForTests(client, null, () => ({}) as PasskeyProvider);
    const { result } = renderHook(() => useCalimero());

    await act(async () => {
      await expect(signIn()).rejects.toBeInstanceOf(LoginRequired);
    });
    expect(result.current.status).toBe("signed-out");
    expect(result.current.message).toBe(PASSKEY_UNKNOWN_HERE_MESSAGE);
  });
});
