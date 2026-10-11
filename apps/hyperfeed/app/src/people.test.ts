import { afterEach, describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { appLook } from "./apps";
import { answersYou, isPast, mayAnswer, pastOf, placeOf, readPeopleRows, sentenceOf, sentenceText, writePeopleRows } from "./people";

const appName = (key: string) => appLook(key).name;

const row: FeedItem = {
  id: "r", kind: "action", chain: "c", chain_len: 1, chain_at: 1, app: "chat", source_context: "ctx", source_label: "", title: "", body: "",
  at: 1, needs_you: false, status: "done", status_at: 1, note: "", ask: { kind: "", prompt: "", options: [], draft: "" }, history: [],
  method: "", category: "", why: "", intent_hash: "", executor: "", undoable: false, breach: "", reviewed_at: 0, from: "", event: "",
  seen: true, reply_to: "", item_type: "", fields: "", reply_call: "", doing: "", doing_at: 0, attachments: [],
};

const said = (item: Partial<FeedItem>, root?: FeedItem) => sentenceText(sentenceOf({ ...row, ...item }, appName, root));

describe("people-first rows", () => {
  it("puts a verb in the past tense", () => {
    expect(pastOf("run")).toBe("ran");
    expect(pastOf("create")).toBe("created");
    expect(pastOf("copy")).toBe("copied");
    expect(pastOf("stop")).toBe("stopped");
    expect(pastOf("open")).toBe("opened");
    expect(pastOf("posted")).toBe("posted");
    expect(isPast("Embed")).toBe(false);
    expect(isPast("Filed")).toBe(true);
  });

  it("says what your agent did on your computer: who, verb, what", () => {
    expect(said({ app: "mero-bot", source_label: "This computer", title: "Run tests in calimero" })).toBe("Agent in Mero Bot ran tests in calimero");
  });

  it("says what your agent wants to do, and what it could not", () => {
    expect(said({ status: "pending", needs_you: true, title: "Reply to Jordan with the contract terms" })).toBe(
      "Agent in Chat wants to reply to Jordan with the contract terms",
    );
    expect(said({ status: "failed", title: "Move deal Northwind" })).toBe("Agent in Chat couldn't move deal Northwind");
    // A title that already says what happened leads as it is.
    expect(said({ status: "failed", app: "crm", title: "Couldn't move deal" })).toBe("Agent in CRM couldn't move deal");
    expect(said({ status: "pending", app: "sign", title: 'Prepared "NDA" for your signature' })).toBe('Agent in Sign prepared "NDA" for your signature');
    expect(said({ app: "issue-tracker", title: "Filed: Create my feed fails" })).toBe("Agent in Issue Tracker filed Create my feed fails");
  });

  it("leads with you when your decision was the last thing that happened", () => {
    expect(said({ status: "approved", title: "Book 20 minutes with Maya" })).toBe("You approved Book 20 minutes with Maya");
    expect(said({ status: "declined", title: "Book 20 minutes with Maya" })).toBe("You declined Book 20 minutes with Maya");
    expect(said({ status: "undo_requested", title: "Posted your stand-up" })).toBe("You asked to undo Posted your stand-up");
  });

  it("says an older row titled with a bare method in plain words", () => {
    expect(said({ app: "issue-tracker", method: "set_summary", title: "set summary in issue-tracker" })).toBe(
      "Agent in Issue Tracker set the summary in Issue Tracker",
    );
  });

  it("says a teammate's notification as the teammate", () => {
    const s = sentenceOf({ ...row, kind: "notification", status: "received", from: "Maya Ortiz", title: "Mentioned you", body: "Can you send the deck?" }, appName);
    expect(s).toMatchObject({ actor: "person", who: "Maya Ortiz", initials: "MO", verb: "mentioned you", what: "Can you send the deck?" });
  });

  it("reads your agent's answer in a chat you started as that chat", () => {
    const question: FeedItem = { ...row, id: "q", kind: "message", from: "you", status: "answered", body: "What's left before the board meeting?", chain_len: 2 };
    const answer: Partial<FeedItem> = { id: "a", kind: "message", from: "agent", status: "said", reply_to: "q", body: "Two slides and the KPIs.", chain_len: 2 };
    expect(mayAnswer({ ...row, ...answer })).toBe(true);
    expect(answersYou({ ...row, ...answer }, question)).toBe(true);
    expect(said(answer, question)).toBe("You asked your agent What's left before the board meeting?");
    // Before the chain is read, it is still said plainly.
    expect(said(answer)).toBe("Agent replied Two slides and the KPIs.");
    // A question your agent asks still leads: it waits on you.
    expect(answersYou({ ...row, ...answer, status: "asked" }, question)).toBe(false);
    expect(said({ ...answer, status: "asked", needs_you: true }, question)).toBe("Agent asks you Two slides and the KPIs.");
    // Its only message in a chain of its own needs nothing read.
    expect(mayAnswer({ ...row, ...answer, chain_len: 1 })).toBe(false);
  });

  it("says where, without repeating the app your agent's row already names", () => {
    expect(placeOf({ ...row, source_label: "#eng-standup" }, appName)).toBe("#eng-standup");
    expect(placeOf({ ...row, app: "mero-bot", source_label: "This computer" }, appName)).toBe("");
    expect(placeOf({ ...row, kind: "notification", source_label: "#launch" }, appName)).toBe("Chat · #launch");
  });
});

describe("the new feed's switch", () => {
  afterEach(() => localStorage.clear());

  it("is off until you turn it on, and is remembered", () => {
    expect(readPeopleRows()).toBe(false);
    writePeopleRows(true);
    expect(readPeopleRows()).toBe(true);
    writePeopleRows(false);
    expect(readPeopleRows()).toBe(false);
  });
});
