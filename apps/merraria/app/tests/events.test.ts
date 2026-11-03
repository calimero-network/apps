import { describe, expect, it } from "vitest";
import { indexOf, toGameEvent } from "../src/net/events";

describe("toGameEvent", () => {
  it("reads the account a tuple variant names", () => {
    expect(toGameEvent({ kind: "TilesChanged", data: { "0": "acct-1" } })).toEqual({
      kind: "TilesChanged",
      value: "acct-1",
    });
    expect(toGameEvent({ kind: "PlayerLeft", data: { "0": "acct-2" } })).toEqual({
      kind: "PlayerLeft",
      value: "acct-2",
    });
  });

  it("gives null for an event that names nobody, or garbage", () => {
    expect(toGameEvent({ kind: "Initialized", data: null })).toEqual({ kind: "Initialized", value: null });
    expect(toGameEvent({ kind: "Initialized", data: {} })).toEqual({ kind: "Initialized", value: null });
    expect(toGameEvent({ kind: "X", data: { "0": 7 } })).toEqual({ kind: "X", value: null });
    expect(toGameEvent({ kind: "X", data: "str" })).toEqual({ kind: "X", value: null });
  });
});

describe("indexOf", () => {
  it("reads the log index an event id starts with", () => {
    expect(indexOf("42:0")).toBe(42);
    expect(indexOf("7")).toBe(7);
    expect(indexOf("nope")).toBeNull();
  });
});
