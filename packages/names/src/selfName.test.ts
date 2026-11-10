import { beforeEach, describe, expect, it, vi } from "vitest";

import { decideSelfName, forgetLastUsedName, lastUsedName, orgMemberName, rememberLastUsedName, setOrgName } from "./selfName";

beforeEach(() => localStorage.clear());

describe("decideSelfName", () => {
  it("uses the org's name, before the org has even finished loading", () => {
    expect(decideSelfName({ orgReady: false, orgName: "Fran" })).toEqual({ kind: "use", name: "Fran" });
  });
  it("waits while the org's names load", () => {
    expect(decideSelfName({ orgReady: false, orgName: "" })).toEqual({ kind: "wait" });
  });
  it("adopts a name the project already has instead of asking", () => {
    expect(decideSelfName({ orgReady: true, orgName: "", fallbacks: ["", " Fran "] })).toEqual({ kind: "adopt", name: "Fran" });
  });
  it("asks once, suggesting the name used in the last org", () => {
    rememberLastUsedName("Fran");
    expect(decideSelfName({ orgReady: true, orgName: null })).toEqual({ kind: "ask", suggestion: "Fran" });
  });
});

describe("setOrgName", () => {
  it("keeps the rest of the member record and remembers the name", async () => {
    const client = {
      getOrg: vi.fn().mockResolvedValue({ memberMetadata: { acc: { name: "old", avatar: "a.png" } } }),
      setMemberMetadata: vi.fn().mockResolvedValue(undefined),
    };
    await setOrgName(client, "org", "acc", "  Fran ");
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org", "acc", { name: "Fran", avatar: "a.png" });
    expect(lastUsedName()).toBe("Fran");
  });
  it("writes just the name when the client cannot read the org", async () => {
    const client = { setMemberMetadata: vi.fn().mockResolvedValue(undefined) };
    await setOrgName(client, "org", "acc", "Fran");
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org", "acc", { name: "Fran" });
  });
  it("does nothing for a blank name", async () => {
    const client = { setMemberMetadata: vi.fn() };
    await setOrgName(client, "org", "acc", "  ");
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });
});

describe("orgMemberName", () => {
  it("reads a member's name, or nothing", () => {
    expect(orgMemberName({ acc: { name: " Fran " } }, "acc")).toBe("Fran");
    expect(orgMemberName({ acc: "x" }, "acc")).toBe("");
    expect(orgMemberName(null, "acc")).toBe("");
  });
});

describe("forgetLastUsedName", () => {
  it("stops offering the name to the next person", () => {
    rememberLastUsedName("Fran");
    forgetLastUsedName();
    expect(lastUsedName()).toBe("");
  });
});
