import { describe, expect, it } from "vitest";
import type { DMContextInfo } from "../../hooks/useDMs";

// ── Pure logic mirrors of DMHeader hooks ────────────────────────────────────
// These replicate the useMemo/useCallback logic from DMHeader.tsx so the
// invariants can be verified without rendering the component.

function computeFilteredMembers(
  availableMembers: Map<string, string>,
  privateDMs: Pick<DMContextInfo, "namespaceMemberIdentity" | "otherIdentity">[],
): Map<string, string> {
  const existingDmIdentities = new Set(
    privateDMs
      .map((dm) => dm.namespaceMemberIdentity || dm.otherIdentity)
      .filter(Boolean),
  );
  const filtered = new Map<string, string>();
  for (const [identity, label] of availableMembers) {
    if (!existingDmIdentities.has(identity)) {
      filtered.set(identity, label);
    }
  }
  return filtered;
}

function computeIsValidIdentityId(
  value: string,
  availableMembers: Map<string, string>,
  privateDMs: Pick<DMContextInfo, "namespaceMemberIdentity" | "otherIdentity">[],
): { isValid: boolean; error: string } {
  const identity = value.trim();
  const isMember = availableMembers.has(identity);
  if (!isMember) {
    return {
      isValid: false,
      error: "Cannot create DM: the user is not in the workspace",
    };
  }
  if (
    privateDMs.some(
      (dm) => (dm.namespaceMemberIdentity || dm.otherIdentity) === identity,
    )
  ) {
    return { isValid: false, error: "A DM with this user already exists" };
  }
  return { isValid: true, error: "" };
}

// ── createDM duplicate-check predicate (mirrors Home/index.tsx) ─────────────

function findExistingDm(
  freshDms: Pick<DMContextInfo, "namespaceMemberIdentity" | "otherIdentity">[],
  otherIdentity: string,
) {
  return freshDms.find(
    (dm) => (dm.namespaceMemberIdentity || dm.otherIdentity) === otherIdentity,
  );
}

// ── Test helpers ─────────────────────────────────────────────────────────────

const makeDM = (
  overrides: Partial<
    Pick<DMContextInfo, "namespaceMemberIdentity" | "otherIdentity">
  > = {},
) => ({
  namespaceMemberIdentity: "",
  otherIdentity: "",
  ...overrides,
});

// ── filteredMembers tests ─────────────────────────────────────────────────────

describe("DMHeader — filteredMembers", () => {
  it("excludes members who already have a DM (via namespaceMemberIdentity)", () => {
    const members = new Map([
      ["alice", "Alice"],
      ["bob", "Bob"],
    ]);
    const dms = [makeDM({ namespaceMemberIdentity: "alice" })];

    const result = computeFilteredMembers(members, dms);

    expect(result.has("alice")).toBe(false);
    expect(result.has("bob")).toBe(true);
  });

  it("excludes members matched by otherIdentity when namespaceMemberIdentity is absent", () => {
    const members = new Map([["charlie", "Charlie"]]);
    const dms = [makeDM({ otherIdentity: "charlie" })];

    const result = computeFilteredMembers(members, dms);

    expect(result.size).toBe(0);
  });

  it("namespaceMemberIdentity takes precedence over otherIdentity for the exclusion key", () => {
    // When both fields are set, namespaceMemberIdentity is used.
    // The member with identity "ns-id" must be excluded; "other-id" must stay.
    const members = new Map([
      ["ns-id", "Named"],
      ["other-id", "Other"],
    ]);
    const dms = [
      makeDM({ namespaceMemberIdentity: "ns-id", otherIdentity: "other-id" }),
    ];

    const result = computeFilteredMembers(members, dms);

    expect(result.has("ns-id")).toBe(false);
    expect(result.has("other-id")).toBe(true);
  });

  it("returns all members when no DMs exist", () => {
    const members = new Map([
      ["a", "A"],
      ["b", "B"],
    ]);

    const result = computeFilteredMembers(members, []);

    expect(result.size).toBe(2);
  });

  it("handles empty availableMembers gracefully", () => {
    const dms = [makeDM({ namespaceMemberIdentity: "x" })];
    const result = computeFilteredMembers(new Map(), dms);
    expect(result.size).toBe(0);
  });
});

// ── isValidIdentityId tests ───────────────────────────────────────────────────

describe("DMHeader — isValidIdentityId", () => {
  const members = new Map([
    ["alice", "Alice"],
    ["bob", "Bob"],
  ]);

  it("returns invalid when identity is not in availableMembers", () => {
    const result = computeIsValidIdentityId("unknown", members, []);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/not in the workspace/i);
  });

  it("returns invalid with duplicate-DM error when a DM with that identity already exists", () => {
    const dms = [makeDM({ namespaceMemberIdentity: "alice" })];
    const result = computeIsValidIdentityId("alice", members, dms);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });

  it("returns valid for a member who has no existing DM", () => {
    const dms = [makeDM({ namespaceMemberIdentity: "alice" })];
    const result = computeIsValidIdentityId("bob", members, dms);
    expect(result.isValid).toBe(true);
    expect(result.error).toBe("");
  });

  it("trims whitespace before checking membership", () => {
    const result = computeIsValidIdentityId("  bob  ", members, []);
    expect(result.isValid).toBe(true);
  });

  it("checks otherIdentity as fallback when namespaceMemberIdentity is blank", () => {
    const dms = [makeDM({ otherIdentity: "bob" })];
    const result = computeIsValidIdentityId("bob", members, dms);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });
});

// ── createDM fresh-fetch duplicate-check tests ────────────────────────────────

describe("createDM — fresh-fetch duplicate check", () => {
  it("finds an existing DM by namespaceMemberIdentity", () => {
    const dms = [makeDM({ namespaceMemberIdentity: "target-x" })];
    expect(findExistingDm(dms, "target-x")).toBeDefined();
  });

  it("finds an existing DM by otherIdentity when namespaceMemberIdentity is absent", () => {
    const dms = [makeDM({ otherIdentity: "target-y" })];
    expect(findExistingDm(dms, "target-y")).toBeDefined();
  });

  it("returns undefined for a new identity (no duplicate DM)", () => {
    const dms = [makeDM({ namespaceMemberIdentity: "existing" })];
    expect(findExistingDm(dms, "new-user")).toBeUndefined();
  });

  it("returns undefined for the otherIdentity (executor key) when namespaceMemberIdentity is authoritative", () => {
    // The createDM check uses namespaceMemberIdentity || otherIdentity.
    // When namespaceMemberIdentity is set, looking up by otherIdentity alone must NOT match,
    // so passing the executor key doesn't accidentally block a new DM creation.
    const dms = [
      makeDM({ namespaceMemberIdentity: "ns-id", otherIdentity: "ctx-id" }),
    ];
    expect(findExistingDm(dms, "ns-id")).toBeDefined();
    expect(findExistingDm(dms, "ctx-id")).toBeUndefined();
  });

  it("returns undefined when DM list is empty", () => {
    expect(findExistingDm([], "any-user")).toBeUndefined();
  });
});
