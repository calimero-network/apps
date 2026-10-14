import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseLens, runLens, type LensHost } from "./lens";
import { validateLens, type Abi } from "./validate";

const APPS = path.resolve(__dirname, "../../../..");
const abi = JSON.parse(readFileSync(path.join(APPS, "mero-sheets", "logic/res/abi.json"), "utf8")) as Abi;
const lens = parseLens(readFileSync(path.join(__dirname, "fixtures", "sheets.json"), "utf8"));

const MY_HEX = "aa".repeat(32);
const MAYA = "bb".repeat(32);
const ME = new Set([MY_HEX, "me-b58"]);
const SOURCE = { contextId: "ctx-sheets", appKey: "sheets", label: "sheets · ctx-sh" };

const comment = (id: string, author: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  sheet_id: "s1",
  row_id: "r3",
  col_id: "c2",
  author,
  text,
  mentions: [],
  parent: "",
  resolved: false,
  created_at: 1,
  updated_at: 1,
  ...extra,
});

/** mero-sheets as the lens sees it. */
function sheetsHost(
  comments: Record<string, unknown>[],
  activity: Record<string, unknown>[] = [],
): LensHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    me: async () => ME,
    name: async (id) => (id === MAYA ? "Maya" : ""),
    call: async <T,>(method: string) => {
      calls.push(method);
      const answer = (() => {
        switch (method) {
          case "whoami":
            return MY_HEX;
          case "get_comments":
            return comments;
          case "get_project":
            return { id: "p1", name: "Q3 budget", created_at: 1 };
          case "get_activity":
            return activity.slice(0, 1);
        }
        throw new Error(`no method ${method}`);
      })();
      return answer as T;
    },
  };
}

describe("sheets lens", () => {
  it("is valid against mero-sheets' ABI and names every event", () => {
    expect(validateLens(lens, abi)).toEqual([]);
    expect(Object.keys(lens.events).sort()).toEqual(abi.events.map((e) => e.name).sort());
  });

  it("makes a comment that mentions you a message you can reply to", async () => {
    const host = sheetsHost([
      comment("cm0", MY_HEX, "older"),
      comment("cm1", MAYA, "@sandi can you check C3?", { mentions: [MY_HEX] }),
      comment("cm2", MAYA, "something later"),
    ]);
    const out = await runLens(lens, "CommentAdded", { id: "cm1", sheet_id: "s1", author: MAYA, mentions: [MY_HEX] }, SOURCE, host);
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({
      item_type: "message",
      title: "Mentioned you in a comment",
      from: "Maya",
      body: "@sandi can you check C3?",
      source_label: "Q3 budget",
      needs_you: true,
      ask: { kind: "reply", prompt: "Reply in Q3 budget" },
    });
    expect(JSON.parse(out.reading.fields)).toMatchObject({ from_id: MAYA, is_dm: false });
    expect(JSON.parse(out.reading.reply_call)).toEqual({
      method: "add_comment",
      args: { sheet_id: "s1", row_id: "r3", col_id: "c2", text: "=answer", parent: "cm1" },
    });
  });

  it("replies in the thread's root when the mention is itself a reply", async () => {
    const host = sheetsHost([comment("cm1", MAYA, "@sandi?", { mentions: [MY_HEX], parent: "root1" })]);
    const out = await runLens(lens, "CommentAdded", { id: "cm1", sheet_id: "s1", author: MAYA, mentions: [MY_HEX] }, SOURCE, host);
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading.title).toBe("Mentioned you in a comment reply");
    expect(JSON.parse(out.reading.reply_call).args.parent).toBe("root1");
  });

  it("skips your own comments, comments that do not mention you, and ones it cannot find", async () => {
    const mine = sheetsHost([comment("cm1", MY_HEX, "@sandi note to self", { mentions: [MY_HEX] })]);
    expect((await runLens(lens, "CommentAdded", { id: "cm1", sheet_id: "s1", author: MY_HEX, mentions: [MY_HEX] }, SOURCE, mine)).kind).toBe("skipped");
    const other = sheetsHost([comment("cm1", MAYA, "@ola look", { mentions: ["cc".repeat(32)] })]);
    expect((await runLens(lens, "CommentAdded", { id: "cm1", sheet_id: "s1", author: MAYA, mentions: ["cc".repeat(32)] }, SOURCE, other)).kind).toBe("skipped");
    const gone = sheetsHost([comment("cmX", MAYA, "x")]);
    expect((await runLens(lens, "CommentAdded", { id: "cm1", sheet_id: "s1", author: MAYA, mentions: [MY_HEX] }, SOURCE, gone)).kind).toBe("skipped");
  });

  it("records an alert sent to you that someone else's edit set off, not your own", async () => {
    const event = { rule_id: "r1", sheet_id: "s1", recipients: [MY_HEX], message: "B4 is now greater than 1000" };
    const byMaya = sheetsHost([], [{ id: "a1", author: MAYA, at: 5, sheet_id: "s1", kind: "cells", summary: "edited B4", count: 1, changes: [] }]);
    const out = await runLens(lens, "AlertTriggered", event, SOURCE, byMaya);
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({
      item_type: "status",
      title: "Sheet alert: B4 is now greater than 1000",
      body: "B4 is now greater than 1000",
      source_label: "Q3 budget",
      needs_you: false,
      reply_call: "",
    });
    const byMe = sheetsHost([], [{ id: "a1", author: MY_HEX, at: 5, sheet_id: "s1", kind: "cells", summary: "edited B4", count: 1, changes: [] }]);
    expect((await runLens(lens, "AlertTriggered", event, SOURCE, byMe)).kind).toBe("skipped");
    expect((await runLens(lens, "AlertTriggered", { ...event, recipients: [MAYA] }, SOURCE, byMaya)).kind).toBe("skipped");
  });

  it("tells you an owner changed your role, not when you changed it or someone else's", async () => {
    const byMaya = sheetsHost([], [{ id: "a1", author: MAYA, at: 5, sheet_id: "", kind: "role", summary: "made Sandi a viewer", count: 0, changes: [] }]);
    const out = await runLens(lens, "RolesChanged", { member_id: MY_HEX }, SOURCE, byMaya);
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({ item_type: "status", title: "Your workbook role changed", body: "An owner made Sandi a viewer" });
    const byMe = sheetsHost([], [{ id: "a1", author: MY_HEX, at: 5, sheet_id: "", kind: "role", summary: "made Sandi a viewer", count: 0, changes: [] }]);
    expect((await runLens(lens, "RolesChanged", { member_id: MY_HEX }, SOURCE, byMe)).kind).toBe("skipped");
    expect((await runLens(lens, "RolesChanged", { member_id: MAYA }, SOURCE, byMaya)).kind).toBe("skipped");
  });

  it("ignores bookkeeping", async () => {
    const host = sheetsHost([]);
    expect(await runLens(lens, "CellUpdated", { id: "s1:r1:c1", sheet_id: "s1" }, SOURCE, host)).toEqual({ kind: "skipped", why: "CellUpdated is ignored" });
    expect(host.calls).toEqual([]);
  });
});
