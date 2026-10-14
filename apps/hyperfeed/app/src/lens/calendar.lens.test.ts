import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseLens, runLens, type LensHost } from "./lens";
import { validateLens, type Abi } from "./validate";

const APPS = path.resolve(__dirname, "../../../..");
const abi = JSON.parse(readFileSync(path.join(APPS, "mero-calendar/logic/res/abi.json"), "utf8")) as Abi;
const lens = parseLens(readFileSync(path.join(__dirname, "fixtures", "calendar.json"), "utf8"));

// Accounts as mero-calendar writes them: 32 bytes, hex.
const ME_HEX = "11".repeat(32);
const MAYA = "22".repeat(32);
const PRIYA = "33".repeat(32);
const ME = new Set([ME_HEX, "me-b58"]);
const SOURCE = { contextId: "ctx-cal", appKey: "calendar", label: "calendar · ctx-ca" };

const ev = (id: string, owner: string, peers: string[], title: string) => ({
  id,
  title,
  description: "Quarterly planning",
  owner,
  start: "2026-10-20T09:00:00.000Z",
  end: "2026-10-20T10:00:00.000Z",
  event_type: "event",
  color: "#3b82f6",
  peers,
  private: false,
});

/** mero-calendar's get_events as the caller sees it: events they own or are invited to. */
function calendarHost(events: ReturnType<typeof ev>[]): LensHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    me: async () => ME,
    name: async (id) => (id === MAYA ? "Maya" : ""),
    call: async <T,>(method: string) => {
      calls.push(method);
      if (method === "get_events") return events as T;
      throw new Error(`no method ${method}`);
    },
  };
}

const filler = Array.from({ length: 5 }, (_, i) => ev(`own-${i}`, ME_HEX, [PRIYA], `Mine ${i}`));

describe("calendar lens", () => {
  it("is valid against mero-calendar's ABI", () => {
    expect(validateLens(lens, abi)).toEqual([]);
  });

  it("makes someone else's event that names you an invite", async () => {
    const host = calendarHost([...filler, ev("evt-q4", MAYA, [ME_HEX, PRIYA], "Q4 planning"), ev("other", PRIYA, [ME_HEX], "Lunch")]);
    const out = await runLens(lens, "CalendarEventCreated", "evt-q4", SOURCE, host);
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({
      item_type: "invite",
      title: "Invited you to Q4 planning",
      from: "Maya",
      source_label: "Calendar",
      needs_you: false,
      reply_call: "",
    });
    expect(JSON.parse(out.reading.fields)).toEqual({
      from: "Maya",
      from_id: MAYA,
      what: "Q4 planning",
      when: "2026-10-20T09:00:00.000Z",
      where: "Calendar",
    });
  });

  it("skips your own event, and one you are not in", async () => {
    const own = await runLens(lens, "CalendarEventCreated", "own-2", SOURCE, calendarHost(filler));
    expect(own).toEqual({ kind: "skipped", why: "not for you" });
    // Not invited: get_events does not list it to you, so nothing matches.
    const notMine = await runLens(lens, "CalendarEventCreated", "evt-x", SOURCE, calendarHost(filler));
    expect(notMine).toEqual({ kind: "skipped", why: "not for you" });
  });

  it("ignores edits, deletions and member bookkeeping without reading anything", async () => {
    const host = calendarHost(filler);
    for (const kind of ["CalendarEventEdited", "CalendarEventDeleted", "MemberJoined", "MemberUsernameUpdated"]) {
      expect((await runLens(lens, kind, "evt-q4", SOURCE, host)).kind).toBe("skipped");
    }
    expect(host.calls).toEqual([]);
  });
});
