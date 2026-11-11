import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HyperfeedClient, U64_PARAMS, VIEWS, calimeroTransport, toWire } from "./hyperfeed";
import { otherApps, wireArgs } from "./otherApps";
import { withRoutes } from "@calimero-apps/connect/testing";

const HERE = dirname(fileURLToPath(import.meta.url));
const ABI = resolve(HERE, "..", "..", "logic", "res", "abi.json");

interface AbiMethod {
  kind: string;
  params: [string, string][];
}
const abi = JSON.parse(readFileSync(ABI, "utf8")) as { methods: Record<string, AbiMethod> };
const callable = Object.entries(abi.methods).filter(([, m]) => m.kind !== "init");

describe("the adapter is the committed ABI's", () => {
  const onClient = Object.getOwnPropertyNames(HyperfeedClient.prototype).filter((n) => n !== "constructor" && n !== "run" && n !== "app");

  it("has a method for every ABI method, and no other", () => {
    expect([...onClient].sort()).toEqual(callable.map(([n]) => n).sort());
  });

  it("reads exactly the ABI's views", () => {
    expect([...VIEWS].sort()).toEqual(callable.filter(([, m]) => m.kind === "view").map(([n]) => n).sort());
  });

  it("sends exactly the ABI's u64 parameters as decimal strings", () => {
    const wide = Object.fromEntries(
      callable
        .map(([n, m]) => [n, m.params.filter(([, t]) => t === "u64" || t === "option<u64>").map(([p]) => p)] as const)
        .filter(([, ps]) => ps.length > 0),
    );
    expect(U64_PARAMS).toEqual(wide);
  });
});

describe("the wire", () => {
  it("names arguments as the ABI does and widens 64-bit integers", () => {
    expect(toWire("feed", { filter: "all", app_key: "", limit: 50, before: 0 })).toEqual({
      filter: "all",
      appKey: "",
      limit: 50,
      before: "0",
    });
    // Fields inside a struct argument are the contract's own, snake_case.
    expect(toWire("recordAction", { input: { source_context: "c" } })).toEqual({ input: { source_context: "c" } });
  });

  it("views a read, calls a write, and answers the result", async () => {
    const seen: string[] = [];
    const client = {
      call: async (app: string, method: string, args: unknown) => {
        seen.push(`call ${app} ${method} ${JSON.stringify(args)}`);
        return { index: 2, result: 3, events: [] };
      },
      view: async (app: string, method: string, args: unknown) => {
        seen.push(`view ${app} ${method} ${JSON.stringify(args)}`);
        return { index: 1, result: { counts: {} } };
      },
    };
    const hf = new HyperfeedClient(calimeroTransport(withRoutes(client)), "feed-1");
    expect(await hf.feed({ filter: "all", app_key: "chat", limit: 1, before: 5 })).toEqual({ counts: {} });
    expect(await hf.archive({ chains: ["c"], until: 9 })).toBe(3);
    expect(seen).toEqual([
      'view feed-1 feed {"filter":"all","appKey":"chat","limit":1,"before":"5"}',
      'call feed-1 archive {"chains":["c"],"until":"9"}',
    ]);
  });

  it("calls another app by its v1 method name in camelCase", async () => {
    const seen: string[] = [];
    const apps = otherApps(withRoutes({
      call: async (app: string, method: string, args: unknown) => {
        seen.push(`${app} ${method} ${JSON.stringify(args)}`);
        return { index: 1, result: null, events: [] };
      },
      view: async () => ({ index: 1, result: null }),
    }));
    await apps.call("chat-1", "send_message", { message_id: "m", text: "hi" });
    expect(seen).toEqual(['chat-1 sendMessage {"messageId":"m","text":"hi"}']);
    expect(wireArgs({ a_b: { c_d: 1 } })).toEqual({ aB: { c_d: 1 } });
  });
});
