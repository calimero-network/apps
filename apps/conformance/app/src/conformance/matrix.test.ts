// @vitest-environment node
import { CalimeroError } from "@calimero-network/mero-js";
import { describe, expect, it } from "vitest";

import { runMatrix } from "./matrix";
import type { Row } from "./types";

/** A client every request of which the node refuses, by name. */
const GROUPS = new Set(["apps", "auth", "consent", "deployments", "ops", "orgs", "packages", "public"]);

function refusingClient(): never {
  const refuse = () => Promise.reject(new CalimeroError(503, "UNAVAILABLE", "no cluster"));
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return undefined;
        if (prop === "session") return undefined;
        if (prop === "events" || prop === "presenceStream") {
          // eslint-disable-next-line require-yield
          return async function* () {
            throw new CalimeroError(503, "UNAVAILABLE", "no cluster");
          };
        }
        if (prop === "useApiKey" || prop === "useSession") return () => {};
        // The generated method groups: every method refuses too.
        if (typeof prop === "string" && GROUPS.has(prop)) return new Proxy({}, { get: () => refuse });
        return refuse;
      },
    },
  ) as never;
}

describe("the matrix", () => {
  it("runs to the end when every request fails, recording each row once", async () => {
    const seen: Row[] = [];
    const rows = await runMatrix({
      client: () => Promise.resolve(refusingClient()),
      passkey: () => ({ create: () => Promise.reject(new Error("no")), get: () => Promise.reject(new Error("no")) }),
      wasm: new Uint8Array([0, 0x61, 0x73, 0x6d]),
      tag: "test",
      patienceMs: 300,
      onRow: (r) => seen.push(r),
    });
    expect(seen).toEqual(rows);
    expect(rows.length).toBeGreaterThan(120);
    // Every name is unique per caller: the report is keyed by them.
    const keys = rows.map((r) => `${r.who} ${r.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Nothing passes against nothing, except rows that expect the refusal.
    expect(rows.filter((r) => r.pass)).toEqual([]);
    expect(new Set(rows.map((r) => r.actual))).toEqual(new Set(["UNAVAILABLE", "blocked"]));
  }, 30_000);
});
