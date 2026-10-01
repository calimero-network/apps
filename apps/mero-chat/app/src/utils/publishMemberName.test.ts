import { describe, expect, it, vi } from "vitest";
import { publishMemberName } from "./publishMemberName";

describe("publishMemberName", () => {
  it("resolves only once the write has finished, so a navigation after it cannot cancel it", async () => {
    let finish!: () => void;
    const write = vi.fn(() => new Promise<{ error: null }>((r) => { finish = () => r({ error: null }); }));
    let settled = false;
    const p = publishMemberName(write, "ns", "acct", "Xabi", 5_000).then(() => { settled = true; });
    await Promise.resolve();
    expect(write).toHaveBeenCalledWith("ns", "acct", { name: "Xabi" });
    expect(settled).toBe(false);
    finish();
    await p;
    expect(settled).toBe(true);
  });

  it("gives up after the timeout rather than holding entry hostage", async () => {
    vi.useFakeTimers();
    const write = vi.fn(() => new Promise<{ error: null }>(() => {}));
    const p = publishMemberName(write, "ns", "acct", "Xabi", 3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(p).resolves.toBe("timeout");
    vi.useRealTimers();
  });

  it("reports a refusal instead of throwing", async () => {
    const write = vi.fn(async () => ({ error: { code: 403, message: "no" } }));
    await expect(publishMemberName(write, "ns", "acct", "Xabi", 1_000)).resolves.toBe("refused: no");
  });
});
