import { beforeEach, describe, expect, it, vi } from "vitest";

import { LayeredRepository } from "./LayeredRepository";
import type { PersistentLayer, RepositoryPolicy, Resolved, SourceLayer } from "./types";

const BASE: RepositoryPolicy = {
  ttlMs: 1000,
  staleWhileRevalidate: true,
  persist: false,
  negativeTtlMs: 500,
};

function source(
  answers: Record<string, string | undefined>,
  calls: string[][] = [],
): SourceLayer<string> & { calls: string[][] } {
  return {
    calls,
    async load(keys) {
      calls.push([...keys]);
      const out = new Map<string, string | undefined>();
      for (const k of keys) out.set(k, answers[k]);
      return out;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("LayeredRepository", () => {
  beforeEach(() => vi.useRealTimers());

  it("coalesces concurrent misses into a single source call", async () => {
    // A message list renders hundreds of rows at once. One request must answer
    // them all, or the node is asked once per row.
    const src = source({ a: "Ann", b: "Bob", c: "Cid" });
    const repo = new LayeredRepository(src, BASE);

    expect(repo.get("a")).toBeUndefined();
    expect(repo.get("b")).toBeUndefined();
    expect(repo.get("c")).toBeUndefined();
    await tick();

    expect(src.calls).toHaveLength(1);
    expect(src.calls[0].sort()).toEqual(["a", "b", "c"]);
    expect(repo.get("a")).toBe("Ann");
  });

  it("does not re-request a key already in flight", async () => {
    const src = source({ a: "Ann" });
    const repo = new LayeredRepository(src, BASE);

    repo.get("a");
    repo.get("a");
    repo.get("a");
    await tick();

    expect(src.calls).toHaveLength(1);
  });

  it("remembers that the source has no value, instead of asking forever", async () => {
    // Plenty of accounts have no name. Without negative caching every render
    // re-triggers a fetch for each of them.
    const src = source({ a: undefined });
    const repo = new LayeredRepository(src, BASE);

    repo.get("a");
    await tick();
    expect(src.calls).toHaveLength(1);

    repo.get("a");
    await tick();
    expect(src.calls).toHaveLength(1);
  });

  it("does NOT cache a failed load as 'no value'", async () => {
    // An unanswered request is not an answer. Caching it as one would hide the
    // key behind negativeTtlMs even after the node comes back.
    let fail = true;
    const calls: string[][] = [];
    const repo = new LayeredRepository<string>(
      {
        async load(keys) {
          calls.push([...keys]);
          if (fail) throw new Error("node down");
          return new Map(keys.map((k) => [k, "Ann"]));
        },
      },
      BASE,
    );

    repo.get("a");
    await tick();
    expect(repo.peek("a")).toBeUndefined();

    fail = false;
    repo.get("a");
    await tick();
    expect(repo.peek("a")).toBe("Ann");
    expect(calls).toHaveLength(2);
  });

  it("serves a stale value and refreshes behind it", async () => {
    const answers: Record<string, string> = { a: "Old" };
    const src = source(answers);
    const repo = new LayeredRepository(src, { ...BASE, ttlMs: 10 });

    repo.get("a");
    await tick();
    expect(repo.get("a")).toBe("Old");

    answers.a = "New";
    await new Promise((r) => setTimeout(r, 20));

    // Stale value returned immediately...
    expect(repo.get("a")).toBe("Old");
    await tick();
    // ...and replaced once the refresh lands.
    expect(repo.get("a")).toBe("New");
  });

  it("withholds a stale value when the policy forbids serving one", async () => {
    const src = source({ a: "Old" });
    const repo = new LayeredRepository(src, {
      ...BASE,
      ttlMs: 10,
      staleWhileRevalidate: false,
    });

    repo.get("a");
    await tick();
    expect(repo.get("a")).toBe("Old");

    await new Promise((r) => setTimeout(r, 20));
    expect(repo.get("a")).toBeUndefined();
  });

  it("re-fetches after invalidation without waiting for the TTL", async () => {
    // The rename path: a value changed at the source, and no TTL should decide
    // how long the old one keeps being shown.
    const answers: Record<string, string> = { a: "Before" };
    const src = source(answers);
    const repo = new LayeredRepository(src, { ...BASE, ttlMs: 60_000 });

    repo.get("a");
    await tick();
    expect(repo.get("a")).toBe("Before");

    answers.a = "After";
    repo.invalidate("a");
    repo.get("a");
    await tick();
    expect(repo.get("a")).toBe("After");
  });

  it("hydrates from the persistent layer so a reload does not refetch everything", async () => {
    const stored = new Map<string, Resolved<string>>([
      ["a", { value: "Ann", origin: "storage", fetchedAt: Date.now() }],
    ]);
    const persistent: PersistentLayer<string> = {
      read: async () => stored,
      write: async () => {},
      clear: async () => {},
    };
    const src = source({ a: "Ann" });
    const repo = new LayeredRepository(src, { ...BASE, persist: true }, persistent);

    await repo.hydrated;
    expect(repo.peek("a")).toBe("Ann");
    expect(src.calls).toHaveLength(0);
  });

  it("does not let a late hydration overwrite a value already fetched", async () => {
    // Hydration is async, so it can land AFTER a source answer for the same
    // key. The source is authoritative; a cached value from a previous session
    // arriving late must not replace it.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const persistent: PersistentLayer<string> = {
      read: async () => {
        await gate;
        return new Map<string, Resolved<string>>([
          ["a", { value: "Stale", origin: "storage", fetchedAt: 0 }],
        ]);
      },
      write: async () => {},
      clear: async () => {},
    };
    const src = source({ a: "Fresh" });
    const repo = new LayeredRepository(src, { ...BASE, persist: true }, persistent);

    repo.get("a");
    await tick();
    expect(repo.peek("a")).toBe("Fresh");

    release();
    await repo.hydrated;
    expect(repo.peek("a")).toBe("Fresh");
  });

  it("notifies subscribers when values land", async () => {
    const src = source({ a: "Ann" });
    const repo = new LayeredRepository(src, BASE);
    const seen = vi.fn();
    repo.subscribe(seen);

    repo.get("a");
    await tick();
    expect(seen).toHaveBeenCalled();
  });
});
