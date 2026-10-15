import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const justJoined = vi.hoisted(() => ({ value: false }));

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isNamespaceJustJoined: () => justJoined.value,
}));

const { readProjectWithJoinRetry, PROJECT_SETTLE_MS, PROJECT_SYNC_MS } = await import("./loadProject");

const NS = "ab".repeat(32);
const notSynced = () => new Error("context not found");

describe("readProjectWithJoinRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    justJoined.value = false;
  });

  it("retries while the team is just joined, until the project arrives", async () => {
    justJoined.value = true;
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(notSynced())
      .mockRejectedValueOnce(notSynced())
      .mockResolvedValue("doc");
    const onSyncing = vi.fn();

    const result = readProjectWithJoinRetry(read, NS, () => false, onSyncing);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toBe("doc");
    expect(read).toHaveBeenCalledTimes(3);
    expect(onSyncing).toHaveBeenCalled();
  });

  it("gives up after the sync window when the project never arrives", async () => {
    justJoined.value = true;
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(notSynced());

    const result = readProjectWithJoinRetry(read, NS, () => false);
    const settled = vi.fn();
    result.then(settled, settled);

    await vi.advanceTimersByTimeAsync(PROJECT_SYNC_MS - 5_000);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).rejects.toThrow("context not found");
  });

  // The usual path after a join: the team page has already cleared the flag
  // when the project is opened, and the project's data is still on its way.
  it("retries briefly when the team is not flagged, and loads a project that arrives", async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(notSynced())
      .mockRejectedValueOnce(notSynced())
      .mockResolvedValue("doc");

    const result = readProjectWithJoinRetry(read, NS, () => false);
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(result).resolves.toBe("doc");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("gives up after the short window when the team is not flagged", async () => {
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(notSynced());
    const settled = vi.fn();

    const result = readProjectWithJoinRetry(read, NS, () => false);
    result.then(settled, settled);
    await vi.advanceTimersByTimeAsync(PROJECT_SETTLE_MS - 3_000);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(6_000);
    await expect(result).rejects.toThrow("context not found");
  });

  it("stops retrying once the editor moves away", async () => {
    justJoined.value = true;
    let cancelled = false;
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(notSynced());

    const result = readProjectWithJoinRetry(read, NS, () => cancelled);
    result.catch(() => {});
    await vi.advanceTimersByTimeAsync(3_000);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(read).toHaveBeenCalledTimes(2);
  });
});
