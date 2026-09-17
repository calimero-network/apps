import { describe, expect, it } from "vitest";
import {
  adminsMissingDocumentAccess,
  canEditDocument,
  effectiveDocumentRole,
} from "./documentRoles";

const ACCOUNT = "a".repeat(64);
const ACCOUNT_2 = "c".repeat(64);

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

describe("adminsMissingDocumentAccess", () => {
  it("names a team admin who is only a viewer on the document", () => {
    // The reported case: the row reads Admin and the person still cannot edit,
    // because the two role systems never spoke to each other.
    expect(
      adminsMissingDocumentAccess([{ identity: ACCOUNT, role: "Admin" }], {
        [ACCOUNT]: "viewer",
      }),
    ).toEqual([ACCOUNT]);
  });

  it("names a team admin the document has never heard from", () => {
    // Unlike mero-design, this app CAN grant to someone who has never opened
    // the document — a member id is an account, so the grant is a parse, not a
    // lookup. So an absent entry is actionable here, not a reason to skip.
    expect(
      adminsMissingDocumentAccess([{ identity: ACCOUNT, role: "Admin" }], {}),
    ).toEqual([ACCOUNT]);
  });

  it("leaves an admin who already has access alone", () => {
    expect(
      adminsMissingDocumentAccess([{ identity: ACCOUNT, role: "Admin" }], {
        [ACCOUNT]: "editor",
      }),
    ).toEqual([]);
    expect(
      adminsMissingDocumentAccess([{ identity: ACCOUNT, role: "Admin" }], {
        [ACCOUNT]: "admin",
      }),
    ).toEqual([]);
  });

  it("never touches a plain member", () => {
    expect(
      adminsMissingDocumentAccess([{ identity: ACCOUNT, role: "Member" }], {
        [ACCOUNT]: "viewer",
      }),
    ).toEqual([]);
    expect(adminsMissingDocumentAccess([{ identity: ACCOUNT, role: "Member" }], {})).toEqual([]);
  });

  it("returns every admin that needs one", () => {
    expect(
      adminsMissingDocumentAccess(
        [
          { identity: ACCOUNT, role: "Admin" },
          { identity: ACCOUNT_2, role: "Admin" },
        ],
        { [ACCOUNT]: "viewer" },
      ),
    ).toEqual([ACCOUNT, ACCOUNT_2]);
  });
});
