import { IntentRefusedError } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";
import { clockNonces, parsePublicLink, publicLinkUrl, publicRefusal, sendWithSkips, type PublicLink } from "./publicLink";

const link: PublicLink = {
  relayUrl: "https://relay.example",
  contextId: "c0".repeat(32),
  formId: "f".repeat(32),
  account: "ac".repeat(32),
  credential: "0123abcd".repeat(20),
  deviceSecret: "5e".repeat(32),
};

describe("a public link", () => {
  it("carries the key in the fragment, which a browser never sends to the server", () => {
    const url = new URL(publicLinkUrl("https://mero-forms.vercel.app/", link));
    expect(url.origin + url.pathname).toBe("https://mero-forms.vercel.app/f");
    expect(url.search).toBe("");
    expect(url.hash.length).toBeGreaterThan(1);
    expect(parsePublicLink(url.hash)).toEqual(link);
  });

  it("refuses anything that is not a whole link", () => {
    expect(parsePublicLink("")).toBeNull();
    expect(parsePublicLink("#not-base64-json")).toBeNull();
    const hash = new URL(publicLinkUrl("https://x.example", { ...link, deviceSecret: "short" })).hash;
    expect(parsePublicLink(hash)).toBeNull();
    // The app's own routes, and an auth callback, are not links.
    expect(parsePublicLink("#/form/abc/edit")).toBeNull();
    expect(parsePublicLink("#access_token=x")).toBeNull();
  });
});

describe("nonces shared by every visitor", () => {
  it("follow the clock in microseconds, strictly increasing within a tab", async () => {
    let t = 1_700_000_000_000;
    const nonces = clockNonces(() => t, () => 7);
    expect(await nonces.next()).toBe(1_700_000_000_000_007n);
    // Same millisecond: still a new nonce.
    expect(await nonces.next()).toBe(1_700_000_000_000_008n);
    t += 1;
    expect(await nonces.next()).toBe(1_700_000_000_001_007n);
  });

  it("skip ahead when a visitor whose clock runs ahead sent more recently", async () => {
    const t = 1_700_000_000_000;
    const nonces = clockNonces(() => t, () => 0);
    nonces.skipMs(10_000);
    expect(await nonces.next()).toBe(BigInt(t + 10_000) * 1000n);
  });
});

describe("sending", () => {
  const spent = () => new IntentRefusedError("this warrant's nonce has already been spent by this author device", true, 403);

  it("retries a spent nonce further ahead each time, then gives up", async () => {
    const nonces = clockNonces(() => 0, () => 0);
    const skip = vi.spyOn(nonces, "skipMs");
    const send = vi.fn().mockRejectedValueOnce(spent()).mockRejectedValueOnce(spent()).mockResolvedValue("ok");
    await expect(sendWithSkips(nonces, send, [0, 1_000, 10_000])).resolves.toBe("ok");
    expect(skip.mock.calls).toEqual([[1_000], [9_000]]);

    const never = vi.fn().mockRejectedValue(spent());
    await expect(sendWithSkips(nonces, never, [0, 1_000])).rejects.toBeInstanceOf(IntentRefusedError);
    expect(never).toHaveBeenCalledTimes(2);
  });

  it("does not retry a refusal that a fresh warrant cannot fix", async () => {
    const send = vi.fn().mockRejectedValue(
      new IntentRefusedError("the author's account is not a member of the group owning this context", false, 403),
    );
    await expect(sendWithSkips(clockNonces(), send)).rejects.toThrow(/not a member/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("tells a visitor what went wrong in plain words", () => {
    expect(publicRefusal(new Error("execute failed: this form is closed"))).toMatch(/closed/);
    expect(
      publicRefusal(new IntentRefusedError("the author's account is not a member of the group owning this context", false, 403)),
    ).toMatch(/no longer works/);
  });
});
