import { describe, expect, it } from "vitest";
import { sentence } from "./ActivityPage";
import type { ActivityRow } from "../generated/MeroOrgClient";
import type { AppView, GroupView, MemberView } from "../backend";

const A = "a".repeat(64), B = "b".repeat(64);
const members = new Map([[A, { account: A, display_name: "Ana" } as MemberView]]);
const groups = new Map([["g1", { id: "g1", name: "Eng" } as GroupView]]);
const apps = new Map([["n1", { id: "n1", label: "Docs" } as AppView]]);
const row = (verb: string, subject: string, object = "", note = ""): ActivityRow => ({ index: 0, at: 0, actor: A, verb, subject, object, note, prev_hash: "", hash: "" });

describe("sentence", () => {
  it("names people, groups and apps, falling back to 8 hex", () => {
    expect(sentence(row("enrolled", B), members, groups, apps)).toBe("bbbbbbbb joined the org");
    expect(sentence(row("membership_set", B, "g1", "lead"), members, groups, apps)).toBe("Ana added bbbbbbbb to Eng as lead");
    expect(sentence(row("access_removed", "g1", "n1"), members, groups, apps)).toBe("Ana removed Eng's access to Docs");
    expect(sentence(row("enrolment", A, "n1", "placed"), members, groups, apps)).toBe("Ana is now placed in Docs");
  });
});
