import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signIn = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());
vi.mock("@calimero-apps/cloud", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class FakeMero {
    constructor(readonly url: string) {}
    signIn = () => signIn(this.url);
    signUp = (name: string) => signUp(this.url, name);
    close() {}
  }
  return { ...actual, CloudMero: FakeMero };
});

import { beginWebLogin, createAccount } from "../src/net/auth";
import { getSession, resetSession } from "../src/net/session";

beforeEach(() => {
  localStorage.clear();
  resetSession();
  signIn.mockReset().mockResolvedValue({});
  signUp.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe("passkey sign-in", () => {
  it("signs in on the cluster, records it, and reloads into the picker", async () => {
    const navigate = vi.fn();
    await beginWebLogin("https://cloud.example///", navigate);
    expect(signIn).toHaveBeenCalledWith("https://cloud.example");
    expect(getSession()).toMatchObject({ kind: "node", nodeUrl: "https://cloud.example" });
    expect(navigate).toHaveBeenCalledWith(window.location.href);
  });

  it("creates an account with the name given", async () => {
    await createAccount("https://cloud.example", "  Ada ", vi.fn());
    expect(signUp).toHaveBeenCalledWith("https://cloud.example", "Ada");
  });

  it("records nothing and stays put when the passkey prompt is dismissed", async () => {
    signIn.mockRejectedValue(Object.assign(new Error("dismissed"), { name: "NotAllowedError" }));
    const navigate = vi.fn();
    await expect(beginWebLogin("https://cloud.example", navigate)).rejects.toThrow("dismissed");
    expect(getSession().nodeUrl).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
