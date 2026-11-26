/** The signed-in client: a refresh token works once, so the session the client ends with is always saved. */
import { describe, expect, it, vi } from "vitest";
import type { AuthState } from "./messages";

const rotate = { next: null as null | Record<string, unknown> };

vi.mock("@calimero-network/mero-js", () => {
  class LoginRequired extends Error {}
  class AppError extends Error {
    constructor(
      readonly appCode: string,
      readonly fields: Record<string, unknown>,
    ) {
      super(appCode);
    }
  }
  class CalimeroClient {
    session: Record<string, unknown> | null = null;
    constructor(readonly opts: Record<string, unknown>) {}
    useSession(s: Record<string, unknown>) {
      this.session = s;
    }
    refresh() {
      if (rotate.next) this.session = rotate.next;
    }
  }
  return { CalimeroClient, LoginRequired, AppError };
});

const { withClient, makeClient, isSignedOut, describe: say } = await import("./session");
const { LoginRequired, AppError } = (await import("@calimero-network/mero-js")) as unknown as {
  LoginRequired: new (m: string) => Error;
  AppError: new (code: string, fields: Record<string, unknown>) => Error;
};

const AUTH: AuthState = {
  accountId: "acc",
  session: { accountId: "acc", sessionToken: "t1", expiresAt: 1, refreshToken: "r1" },
  nodeUrl: "https://node-1.example",
  nodes: ["https://node-1.example", "https://node-2.example"],
  page: { origin: "https://page.example", version: "1.0.0" },
  workspace: { appId: "app1", name: "Team" },
};

describe("withClient", () => {
  it("saves the rotated session after a call", async () => {
    rotate.next = { accountId: "acc", sessionToken: "t2", expiresAt: 2, refreshToken: "r2" };
    const save = vi.fn(async () => undefined);
    const out = await withClient(AUTH, save, async (client) => {
      (client as unknown as { refresh(): void }).refresh();
      return 42;
    });
    expect(out).toBe(42);
    expect(save).toHaveBeenCalledWith({ ...AUTH, session: rotate.next });
  });

  it("saves the rotated session even when the call fails", async () => {
    rotate.next = { accountId: "acc", sessionToken: "t3", expiresAt: 3, refreshToken: "r3" };
    const save = vi.fn(async () => undefined);
    await expect(
      withClient(AUTH, save, async (client) => {
        (client as unknown as { refresh(): void }).refresh();
        throw new Error("node said no");
      }),
    ).rejects.toThrow("node said no");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the session did not change", async () => {
    const save = vi.fn(async () => undefined);
    await withClient(AUTH, save, async () => "ok");
    expect(save).not.toHaveBeenCalled();
  });

  it("points the client at every node, with Cloud's release policy", () => {
    const client = makeClient(AUTH) as unknown as { opts: { baseUrl: string; nodes: string[]; policy: unknown } };
    expect(client.opts.baseUrl).toBe("https://node-1.example");
    expect(client.opts.nodes).toEqual(AUTH.nodes);
    expect(client.opts.policy).toHaveProperty("release");
  });
});

describe("errors in a sentence", () => {
  it("names a finished session, an app's message, a passkey step-up", () => {
    expect(isSignedOut(new LoginRequired("x"))).toBe(true);
    expect(isSignedOut(new Error("x"))).toBe(false);
    expect(say(new LoginRequired("x"))).toBe("Your session ended. Sign in again.");
    expect(say(new AppError("Forbidden", { message: "only the meeting's recorder may change it" }))).toBe(
      "only the meeting's recorder may change it",
    );
    expect(say(new AppError("Refused", {}))).toBe("Refused");
    expect(say(new Error("HTTP 412 CONFIRM_REQUIRED"))).toMatch(/passkey/);
    expect(say("plain")).toBe("plain");
  });
});
