import { describe, expect, it, beforeEach } from "vitest";
import { clearStashedInvite, decodeInviteLink, encodeInviteLink, JOIN_SESSION_KEY, stashInviteFromHash } from "./invite-link";

const INV = { invitation: { group_id: "1".repeat(64) }, inviter_signature: "sig" } as never;

describe("invite link", () => {
  beforeEach(() => { sessionStorage.clear(); window.location.hash = ""; });

  it("round-trips", () => {
    const url = encodeInviteLink("https://org.example", { namespaceId: "1".repeat(64), invitation: INV });
    expect(url.startsWith("https://org.example/join#")).toBe(true);
    expect(decodeInviteLink(new URL(url).hash)).toEqual({ namespaceId: "1".repeat(64), invitation: INV });
  });

  it("rejects a hash with a missing field", () => {
    expect(decodeInviteLink("#ns=1")).toBeNull();
  });

  it("stashes the hash once and survives a reload", () => {
    const url = encodeInviteLink("http://localhost", { namespaceId: "1".repeat(64), invitation: INV });
    window.location.hash = new URL(url).hash;
    expect(stashInviteFromHash()?.namespaceId).toBe("1".repeat(64));
    expect(window.location.hash).toBe("");
    expect(sessionStorage.getItem(JOIN_SESSION_KEY)).not.toBeNull();
    // Reload: no hash, the stash answers.
    expect(stashInviteFromHash()?.invitation).toEqual(INV);
    clearStashedInvite();
    expect(stashInviteFromHash()).toBeNull();
  });

});
