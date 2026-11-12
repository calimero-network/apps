import { describe, expect, it } from "vitest";
import { clusterBackend, u64 } from "./backend";
import { HyperfeedClient } from "./generated/client";
import { camel, otherApps, wireArgs } from "./otherApps";
import { withRoutes } from "@calimero-apps/connect/testing";

describe("the wire", () => {
  it("widens 64-bit integers to decimal strings, and names arguments in camelCase", () => {
    expect(u64(9.7)).toBe("9");
    expect(u64(0)).toBe("0");
    expect(camel("app_key")).toBe("appKey");
  });

  it("sends the screens' calls with the ABI's argument names, struct fields as the contract keeps them", async () => {
    const seen: string[] = [];
    const call = async (app: string, method: string, args: unknown) => {
      seen.push(`call ${app} ${method} ${JSON.stringify(args)}`);
      return { index: 2, result: null, events: [] };
    };
    const view = async (app: string, method: string, args: unknown) => {
      seen.push(`view ${app} ${method} ${JSON.stringify(args)}`);
      return { index: 1, result: { counts: {} } };
    };
    const apps = { call: async () => undefined, view: async () => undefined };
    const backend = clusterBackend(new HyperfeedClient(withRoutes({ call, view }), "feed-1"), apps);
    await backend.feed("all", "chat");
    await backend.setPolicy("chat", "ask", "push");
    await backend.recordAction({ source_context: "c" } as unknown as Parameters<typeof backend.recordAction>[0]);
    expect(seen).toEqual([
      'view feed-1 feed {"filter":"all","appKey":"chat","limit":50,"before":"0"}',
      'call feed-1 setPolicy {"appKey":"chat","agent":"ask","notifications":"push"}',
      'call feed-1 recordAction {"input":{"source_context":"c"}}',
    ]);
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
    const hf = new HyperfeedClient(withRoutes(client), "feed-1");
    expect(await hf.feed({ filter: "all", appKey: "chat", limit: 1, before: u64(5) })).toEqual({ counts: {} });
    expect(await hf.archive({ chains: ["c"], until: u64(9) })).toBe(3);
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
