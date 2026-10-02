import { describe, expect, it } from "vitest";

import { invitationFromRaw } from "./capture";

describe("invitationFromRaw", () => {
  it("reads the invitation parameter out of a link", () => {
    expect(invitationFromRaw("https://links.calimero.network/app/join?invitation=abc")).toBe("abc");
    expect(invitationFromRaw("calimero://mero-sign/join?invitation=xyz")).toBe("xyz");
  });

  it("accepts a bare code", () => {
    expect(invitationFromRaw("  4WoJA5rDhe5WQVVyZF  ")).toBe("4WoJA5rDhe5WQVVyZF");
  });

  it("refuses a page URL or path that carries no invitation", () => {
    expect(invitationFromRaw("http://localhost:5390/teams")).toBeNull();
    expect(invitationFromRaw("https://app.example/agreements/1")).toBeNull();
    expect(invitationFromRaw("/teams")).toBeNull();
    expect(invitationFromRaw("https://app.example/?tab=1")).toBeNull();
  });
});
