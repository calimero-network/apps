import { beforeEach, describe, expect, it } from "vitest";
import { lastUsedName } from "@calimero-apps/names";
import {
  clearMessengerDisplayName,
  getMessengerDisplayName,
  setMessengerDisplayName,
} from "./messengerName";

beforeEach(() => localStorage.clear());

describe("messengerName", () => {
  it("keeps one name per workspace", () => {
    setMessengerDisplayName("Ronit", "ns-a");
    setMessengerDisplayName("R. in B", "ns-b");

    expect(getMessengerDisplayName("ns-a")).toBe("Ronit");
    expect(getMessengerDisplayName("ns-b")).toBe("R. in B");
    expect(getMessengerDisplayName("ns-c")).toBe("");
  });

  it("trims surrounding whitespace before persisting", () => {
    setMessengerDisplayName("  Calimero User  ", "ns-a");

    expect(getMessengerDisplayName("ns-a")).toBe("Calimero User");
  });

  it("remembers the name as the one the next team prefills", () => {
    setMessengerDisplayName("  Ada  ", "ns-a");

    expect(lastUsedName()).toBe("Ada");
  });

  it("forgets every workspace's name on sign-out", () => {
    setMessengerDisplayName("Ada", "ns-a");
    setMessengerDisplayName("Ada B", "ns-b");
    clearMessengerDisplayName();

    expect(getMessengerDisplayName("ns-a")).toBe("");
    expect(getMessengerDisplayName("ns-b")).toBe("");
    expect(lastUsedName()).toBe("");
  });
});
