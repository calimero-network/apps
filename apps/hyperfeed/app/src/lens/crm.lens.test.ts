import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fillReplyCall, parseLens, runLens, type LensHost } from "./lens";
import { validateLens, type Abi } from "./validate";

const APPS = path.resolve(__dirname, "../../../..");
const abi = JSON.parse(readFileSync(path.join(APPS, "mero-crm/logic/res/abi.json"), "utf8")) as Abi;
const lens = parseLens(readFileSync(path.join(__dirname, "fixtures", "crm.json"), "utf8"));

// Accounts as mero-crm writes `created_by` and a note's `author`: the account, hex.
const ME_HEX = "11".repeat(32);
const MAYA = "22".repeat(32);
const ME = new Set([ME_HEX, "me-b58"]);
const SOURCE = { contextId: "ctx-crm", appKey: "crm", label: "crm · ctx-cr" };

const note = (id: string, author: string, body: string, created_at: number) => ({ id, deal_id: "deal-1", author, body, created_at });

/** mero-crm's get_deal (DealDetail) for one deal: notes newest first. */
function crmHost(createdBy: string, notes: ReturnType<typeof note>[]): LensHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    me: async () => ME,
    name: async (id) => (id === MAYA ? "Maya" : ""),
    call: async <T,>(method: string, args: Record<string, unknown>) => {
      calls.push(method);
      if (method !== "get_deal") throw new Error(`no method ${method}`);
      if (args.deal_id !== "deal-1") throw new Error("deal not found");
      return {
        deal: {
          id: "deal-1",
          title: "Acme renewal",
          value: 24000,
          organization: "Acme",
          contact_id: null,
          contact_name: null,
          owner: "sandi",
          stage_id: "stage-2",
          status: "open",
          lost_reason: "",
          expected_close: 1_790_000_000_000,
          source: "referral",
          probability: 40,
          stage_entered_at: 1_780_000_000_000,
          closed_at: null,
          next_activity: null,
          open_activities: 0,
          last_touch_at: notes[0]?.created_at ?? null,
          created_by: createdBy,
          created_at: 1_770_000_000_000,
        },
        contact: null,
        activities: [],
        notes,
      } as T;
    },
  };
}

const NOTES = [
  note("note-3", MAYA, "Legal signed off on the MSA, ready to send", 300),
  note("note-2", ME_HEX, "Called procurement", 200),
  note("note-1", MAYA, "First contact", 100),
];

describe("crm lens", () => {
  it("is valid against mero-crm's ABI", () => {
    expect(validateLens(lens, abi)).toEqual([]);
  });

  it("records a teammate's note on a deal you created, answered with a note", async () => {
    const out = await runLens(lens, "NoteChanged", { id: "note-3", deal_id: "deal-1" }, SOURCE, crmHost(ME_HEX, NOTES));
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({
      item_type: "message",
      title: "Added a note to your deal Acme renewal",
      from: "Maya",
      body: "Legal signed off on the MSA, ready to send",
      source_label: "Acme renewal",
      needs_you: false,
      ask: { kind: "reply", prompt: "Add a note to this deal" },
    });
    expect(JSON.parse(out.reading.fields)).toMatchObject({ from: "Maya", from_id: MAYA, is_dm: false });
    expect(fillReplyCall(out.reading.reply_call, "Thanks, sending today")).toEqual({
      method: "add_note",
      args: { deal_id: "deal-1", body: "Thanks, sending today" },
    });
    // An older note further down the list is found too.
    const older = await runLens(lens, "NoteChanged", { id: "note-1", deal_id: "deal-1" }, SOURCE, crmHost(ME_HEX, NOTES));
    expect(older.kind === "recorded" && older.reading.body).toBe("First contact");
  });

  it("skips your own note, a note on someone else's deal, and a removed note", async () => {
    const own = await runLens(lens, "NoteChanged", { id: "note-2", deal_id: "deal-1" }, SOURCE, crmHost(ME_HEX, NOTES));
    expect(own).toEqual({ kind: "skipped", why: "not for you" });
    const theirs = await runLens(lens, "NoteChanged", { id: "note-3", deal_id: "deal-1" }, SOURCE, crmHost(MAYA, NOTES));
    expect(theirs).toEqual({ kind: "skipped", why: "not for you" });
    const removed = await runLens(lens, "NoteChanged", { id: "note-9", deal_id: "deal-1" }, SOURCE, crmHost(ME_HEX, NOTES));
    expect(removed).toEqual({ kind: "skipped", why: "not for you" });
    // A deal with an ambiguous creator reads "" and is nobody's.
    const nobody = await runLens(lens, "NoteChanged", { id: "note-3", deal_id: "deal-1" }, SOURCE, crmHost("", NOTES));
    expect(nobody.kind).toBe("skipped");
  });

  it("ignores everything else without reading anything", async () => {
    const host = crmHost(ME_HEX, NOTES);
    for (const kind of ["ActivityChanged", "DealCreated", "DealMoved", "DealStatusChanged", "DealUpdated", "AutomationFired", "StagesChanged"]) {
      expect((await runLens(lens, kind, { id: "x", stage_id: "s", status: "won", deal_id: "deal-1", automation_id: "a" }, SOURCE, host)).kind).toBe("skipped");
    }
    expect(host.calls).toEqual([]);
  });

  it("names every event the app emits", () => {
    expect(Object.keys(lens.events).sort()).toEqual(abi.events.map((e) => e.name).sort());
  });
});
