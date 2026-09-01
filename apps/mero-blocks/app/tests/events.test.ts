import { describe, expect, it } from "vitest";
import { decodeSseEvents } from "../src/net/events";

const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));

describe("decodeSseEvents", () => {
  it("decodes the StateMutation shape (events with byte payloads)", () => {
    const data = {
      newRoot: "abc",
      events: [
        { kind: "BlocksChanged", data: bytes("peer-id"), handler: null },
        { kind: "PlayerJoined", data: bytes("peer-id") },
      ],
    };
    expect(decodeSseEvents(data)).toEqual([
      { kind: "BlocksChanged", value: "peer-id" },
      { kind: "PlayerJoined", value: "peer-id" },
    ]);
  });

  it("decodes the tagged-enum shape {Variant: payload}", () => {
    expect(decodeSseEvents({ BlocksChanged: "peer-id" })).toEqual([
      { kind: "BlocksChanged", value: "peer-id" },
    ]);
  });

  it("passes through non-byte event data untouched", () => {
    const data = { events: [{ kind: "PlayerLeft", data: "already-a-string" }] };
    expect(decodeSseEvents(data)).toEqual([{ kind: "PlayerLeft", value: "already-a-string" }]);
  });

  it("handles empty byte payloads", () => {
    expect(decodeSseEvents({ events: [{ kind: "Initialized", data: [] }] })).toEqual([
      { kind: "Initialized", value: null },
    ]);
  });

  it("returns [] for garbage", () => {
    expect(decodeSseEvents(null)).toEqual([]);
    expect(decodeSseEvents("nope")).toEqual([]);
    expect(decodeSseEvents({ lowercase: 1 })).toEqual([]);
    expect(decodeSseEvents({ A: 1, B: 2 })).toEqual([]);
    expect(decodeSseEvents({ events: "not-an-array" })).toEqual([]);
  });

  it("skips malformed entries inside an events array", () => {
    const data = { events: [{ nokind: true }, { kind: "PlayerJoined", data: bytes("x") }] };
    expect(decodeSseEvents(data)).toEqual([{ kind: "PlayerJoined", value: "x" }]);
  });
});
