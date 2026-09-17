import { describe, expect, it } from "vitest";
import { adminsMissingCanvasAccess, indexBoardMembers } from "./boardMembers";

// Both ids are 64 hex since rc.27 — the fixtures use realistic shapes, because
// the whole bug was that one can be mistaken for the other without anything
// throwing.
const ACCOUNT = "a".repeat(64);
const MEMBER = "b".repeat(64);
const ACCOUNT_2 = "c".repeat(64);
const MEMBER_2 = "d".repeat(64);

describe("indexBoardMembers", () => {
  it("keys the board username and role by ACCOUNT, not by member key", () => {
    const { roles, names } = indexBoardMembers(
      [{ member: MEMBER, role: "editor", account: ACCOUNT }],
      [{ id: MEMBER, username: "fran1" }],
    );

    // The namespace roster only ever holds the account, so that is what has to
    // resolve. Keying by member key is what made rows render a raw id.
    expect(names[ACCOUNT]).toBe("fran1");
    expect(roles[ACCOUNT]).toBe("editor");
    expect(names[MEMBER]).toBeUndefined();
  });

  it("does not cross usernames between members", () => {
    const { names } = indexBoardMembers(
      [
        { member: MEMBER, role: "admin", account: ACCOUNT },
        { member: MEMBER_2, role: "viewer", account: ACCOUNT_2 },
      ],
      [
        { id: MEMBER, username: "fran1" },
        { id: MEMBER_2, username: "bob" },
      ],
    );

    expect(names[ACCOUNT]).toBe("fran1");
    expect(names[ACCOUNT_2]).toBe("bob");
  });

  it("falls back to the member key when the pairing is unknown", () => {
    // Someone who joined but has never written: the contract has no account for
    // them, so no namespace row can match — and none should.
    const { roles, names } = indexBoardMembers(
      [{ member: MEMBER, role: "viewer", account: null }],
      [{ id: MEMBER, username: "ghost" }],
    );

    expect(roles[MEMBER]).toBe("viewer");
    expect(names[MEMBER]).toBe("ghost");
    expect(roles[ACCOUNT]).toBeUndefined();
  });

  it("keeps the role when the member has no board username", () => {
    const { roles, names } = indexBoardMembers(
      [{ member: MEMBER, role: "editor", account: ACCOUNT }],
      [],
    );

    expect(roles[ACCOUNT]).toBe("editor");
    expect(names[ACCOUNT]).toBeUndefined();
  });

  it("ignores a blank username rather than showing an empty label", () => {
    const { names } = indexBoardMembers(
      [{ member: MEMBER, role: "viewer", account: ACCOUNT }],
      [{ id: MEMBER, username: "   " }],
    );

    expect(names[ACCOUNT]).toBeUndefined();
  });

  it("survives a malformed row", () => {
    const { roles } = indexBoardMembers(
      [
        { member: "", role: "admin", account: ACCOUNT },
        { member: MEMBER, role: "editor", account: ACCOUNT_2 },
      ],
      [],
    );

    expect(roles[ACCOUNT]).toBeUndefined();
    expect(roles[ACCOUNT_2]).toBe("editor");
  });
});

describe("adminsMissingCanvasAccess", () => {
  it("names a team admin who is only a viewer on the board", () => {
    // Exactly the reported case: the row reads Admin and the person still
    // cannot edit, because the two role systems never spoke to each other.
    expect(
      adminsMissingCanvasAccess(
        [{ identity: ACCOUNT, role: "Admin" }],
        { [ACCOUNT]: "viewer" },
      ),
    ).toEqual([ACCOUNT]);
  });

  it("leaves an admin who already has canvas access alone", () => {
    expect(
      adminsMissingCanvasAccess([{ identity: ACCOUNT, role: "Admin" }], {
        [ACCOUNT]: "editor",
      }),
    ).toEqual([]);
    expect(
      adminsMissingCanvasAccess([{ identity: ACCOUNT, role: "Admin" }], {
        [ACCOUNT]: "admin",
      }),
    ).toEqual([]);
  });

  it("never touches a plain member", () => {
    expect(
      adminsMissingCanvasAccess([{ identity: ACCOUNT, role: "Member" }], {
        [ACCOUNT]: "viewer",
      }),
    ).toEqual([]);
  });

  it("skips an admin the board has never seen", () => {
    // No contract row means no device→account pairing, so a grant would be
    // refused. Nothing to reconcile until they open the board once.
    expect(
      adminsMissingCanvasAccess([{ identity: ACCOUNT, role: "Admin" }], {}),
    ).toEqual([]);
  });

  it("returns every admin that needs one, not just the first", () => {
    expect(
      adminsMissingCanvasAccess(
        [
          { identity: ACCOUNT, role: "Admin" },
          { identity: ACCOUNT_2, role: "Admin" },
        ],
        { [ACCOUNT]: "viewer", [ACCOUNT_2]: "viewer" },
      ),
    ).toEqual([ACCOUNT, ACCOUNT_2]);
  });
});
