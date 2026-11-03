import { describe, expect, it } from "vitest";
import {
  canEditDocument,
  effectiveDocumentRole,
} from "./documentRoles";

const ACCOUNT = "a".repeat(64);

describe("effectiveDocumentRole", () => {
  it("reports the granted role", () => {
    expect(effectiveDocumentRole({ [ACCOUNT]: "admin" }, ACCOUNT)).toBe("admin");
    expect(effectiveDocumentRole({ [ACCOUNT]: "editor" }, ACCOUNT)).toBe("editor");
    expect(effectiveDocumentRole({ [ACCOUNT]: "viewer" }, ACCOUNT)).toBe("viewer");
  });

  it("treats an absent entry as viewer, not as unknown", () => {
    // `list_roles` only enumerates members who have opened the document, so an
    // absent entry is a plain viewer — the same answer the contract's own
    // `get_role` gives for an account it has never seen. Treating absent as
    // unknown is what left rows with no role badge at all.
    expect(effectiveDocumentRole({}, ACCOUNT)).toBe("viewer");
  });

  it("does not trust an unrecognised role string", () => {
    expect(effectiveDocumentRole({ [ACCOUNT]: "owner" }, ACCOUNT)).toBe("viewer");
    expect(effectiveDocumentRole({ [ACCOUNT]: "" }, ACCOUNT)).toBe("viewer");
  });
});

describe("canEditDocument", () => {
  it("is true for admin and editor, false for viewer and absent", () => {
    expect(canEditDocument({ [ACCOUNT]: "admin" }, ACCOUNT)).toBe(true);
    expect(canEditDocument({ [ACCOUNT]: "editor" }, ACCOUNT)).toBe(true);
    expect(canEditDocument({ [ACCOUNT]: "viewer" }, ACCOUNT)).toBe(false);
    expect(canEditDocument({}, ACCOUNT)).toBe(false);
  });
});

describe("team owners and admins", () => {
  it("edit a document whose roster has not seen them", () => {
    expect(effectiveDocumentRole({}, "a", "admin")).toBe("editor");
    expect(effectiveDocumentRole({}, "a", "owner")).toBe("editor");
    expect(canEditDocument({}, "a", "member")).toBe(false);
    expect(canEditDocument({}, "a", "guest")).toBe(false);
  });

  it("keep the document's own answer when it has one", () => {
    expect(effectiveDocumentRole({ a: "admin" }, "a", "member")).toBe("admin");
  });
});
