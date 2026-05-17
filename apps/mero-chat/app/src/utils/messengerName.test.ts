import { describe, expect, it } from "vitest";
import {
  getMessengerDisplayName,
  setMessengerDisplayName,
} from "./messengerName";

describe("messengerName", () => {
  it("stores a single global messenger name", () => {
    setMessengerDisplayName("Ronit");

    expect(getMessengerDisplayName()).toBe("Ronit");
  });

  it("trims surrounding whitespace before persisting", () => {
    setMessengerDisplayName("  Calimero User  ");

    expect(getMessengerDisplayName()).toBe("Calimero User");
  });
});
