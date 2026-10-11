import { useCallback, useEffect, useState } from "react";
import type { FeedItem } from "./generated/HyperfeedClient";
import { headlineOfMessage, rowTitle } from "./format";
import { headlineOf } from "./team";

/**
 * People-first rows: each row read as who did what, "Agent in Mero Bot ran
 * tests in calimero", "You approved Reply to Jordan", "Maya Ortiz mentioned
 * you". The person (you, your agent, a teammate, an app) leads; the verb says
 * what happened last; the rest is what it was about.
 *
 * A reading of the rows the feed already returns; nothing new is stored.
 */

export type Actor = "you" | "agent" | "person" | "app";

export interface Sentence {
  actor: Actor;
  /** "You", "Agent in Chat", "Maya Ortiz". */
  who: string;
  /** Initials for a teammate's face; "" for anyone else. */
  initials: string;
  /** "ran", "wants to run", "approved", "asked your agent". */
  verb: string;
  /** What it was about; may be empty. */
  what: string;
}

/** Past tenses that are not just "-ed". */
const IRREGULAR: Record<string, string> = {
  run: "ran",
  write: "wrote",
  read: "read",
  make: "made",
  send: "sent",
  get: "got",
  find: "found",
  build: "built",
  set: "set",
  put: "put",
  do: "did",
  take: "took",
  give: "gave",
  begin: "began",
  see: "saw",
  pay: "paid",
  buy: "bought",
  leave: "left",
  keep: "kept",
  tell: "told",
  say: "said",
  pull: "pulled",
  undo: "undid",
  rerun: "reran",
  rebuild: "rebuilt",
  rewrite: "rewrote",
  split: "split",
  cut: "cut",
  shut: "shut",
  hold: "held",
  bring: "brought",
  think: "thought",
  draw: "drew",
  show: "showed",
  lookup: "looked up",
};

/** Verbs whose last consonant doubles: "stop" → "stopped". */
const DOUBLED = new Set(["stop", "plan", "ship", "commit", "drop", "tag", "log", "chat", "submit", "admit", "permit", "step", "flag", "pin", "skip", "scan", "map", "zip", "wrap", "prep"]);

/** Words a past-tense title starts with, beyond the "-ed" ones. */
const PAST = new Set([...Object.values(IRREGULAR), "couldn't", "could not", "didn't"]);

/** Verbs that end in "-ed" and still ask for something: "Embed the video". */
const NOT_PAST = new Set(["embed", "feed", "seed", "speed", "need", "shed", "shred", "bleed", "breed", "proceed", "exceed", "succeed"]);

/** Whether a title already says what happened: "Posted your stand-up", "Ran tests". */
export function isPast(word: string): boolean {
  const w = word.toLowerCase();
  if (NOT_PAST.has(w)) return false;
  return w.endsWith("ed") || PAST.has(w);
}

/** A verb in the past tense: "run" → "ran", "create" → "created", "copy" → "copied". */
export function pastOf(verb: string): string {
  const v = verb.toLowerCase();
  if (!v) return v;
  if (isPast(v)) return v;
  if (IRREGULAR[v]) return IRREGULAR[v]!;
  if (DOUBLED.has(v)) return `${v}${v.slice(-1)}ed`;
  if (v.endsWith("e")) return `${v}d`;
  if (/[^aeiou]y$/.test(v)) return `${v.slice(0, -1)}ied`;
  return `${v}ed`;
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** A title split into its first word and the rest: "Run tests in calimero" → ["run", "tests in calimero"]. */
function verbAndRest(title: string): [string, string] {
  const m = /^(\S+)\s*(.*)$/s.exec(title.trim());
  if (!m) return ["", ""];
  // "Filed: Create my feed fails": the colon is the title's, not the verb's.
  return [m[1]!.replace(/:$/, "").toLowerCase(), m[2]!];
}

/** Your agent, and where it acted: "Agent in Chat". */
function agentIn(item: FeedItem, appName: (key: string) => string): string {
  return item.app ? `Agent in ${appName(item.app)}` : "Agent";
}

/** What your decision on an action is said as. */
const YOUR_STEP: Record<string, string> = {
  approved: "approved",
  retrying: "asked to retry",
  undo_requested: "asked to undo",
  declined: "declined",
};

function actionSentence(item: FeedItem, appName: (key: string) => string): Sentence {
  const title = rowTitle(item, appName);
  const mine = YOUR_STEP[item.status];
  if (mine) return { actor: "you", who: "You", initials: "", verb: mine, what: title };

  const who = agentIn(item, appName);
  const agent = (verb: string, what: string): Sentence => ({ actor: "agent", who, initials: "", verb, what });
  const [first, rest] = verbAndRest(title);
  if (!first) return agent("", "");
  // "Couldn't move deal", "Posted your stand-up": already said; it leads as is.
  if (isPast(first) || first === "couldn't") return agent(first, rest);

  switch (item.status) {
    case "pending":
      return agent(`wants to ${first}`, rest);
    case "failed":
      return agent(`couldn't ${first}`, rest);
    case "undone":
      return agent("undid", lowerFirst(title));
    default:
      return agent(pastOf(first), rest);
  }
}

/**
 * A row as one sentence. `root` is the first row of its chain when the feed
 * read it: an answer of your agent's to a message of yours reads as the
 * conversation, "You asked your agent …", not as a row of its own. The answer
 * stays in the thread.
 */
export function sentenceOf(item: FeedItem, appName: (key: string) => string, root?: FeedItem | null): Sentence {
  if (root && root.id !== item.id && answersYou(item, root)) return sentenceOf(root, appName);
  if (item.kind === "action") return actionSentence(item, appName);
  if (item.kind === "message") {
    const what = headlineOfMessage(item);
    if (item.from === "you") return { actor: "you", who: "You", initials: "", verb: "asked your agent", what };
    if (item.status === "asked") return { actor: "agent", who: "Agent", initials: "", verb: "asks you", what };
    if (item.status === "answered") return { actor: "agent", who: "Agent", initials: "", verb: "asked you", what };
    return { actor: "agent", who: "Agent", initials: "", verb: item.reply_to ? "replied" : "said", what };
  }
  const h = headlineOf(item, appName);
  return { actor: h.person ? "person" : "app", who: h.who, initials: h.person ? h.initials : "", verb: h.verb, what: h.object };
}

/**
 * Whether a row is your agent answering in a chat you started: its words
 * belong in that thread, under your question, so the row is your question.
 * A question it asks you still leads: it waits on you.
 */
export function answersYou(item: FeedItem, root: FeedItem | null | undefined): boolean {
  if (item.kind !== "message" || item.from !== "agent" || item.status === "asked") return false;
  return Boolean(root && root.kind === "message" && root.from === "you");
}

/** Whether a row may be an answer in someone's chat, so its chain's first row is worth reading. */
export function mayAnswer(item: FeedItem): boolean {
  return item.kind === "message" && item.from === "agent" && item.status !== "asked" && item.chain_len > 1;
}

/** Where a row happened, under its sentence: "Chat · #launch". "" when it says nothing new. */
export function placeOf(item: FeedItem, appName: (key: string) => string): string {
  if (!item.app || item.app === "hyperfeed") return "";
  // Your agent's rows already say the app in who did it.
  if (item.kind === "action") return item.source_label && item.source_label !== "This computer" ? item.source_label : "";
  return `${appName(item.app)}${item.source_label ? ` · ${item.source_label}` : ""}`;
}

/** The sentence as plain text, for a label or a search. */
export function sentenceText(s: Sentence): string {
  return [s.who, s.verb, s.what].filter(Boolean).join(" ");
}

type LoadChain = (chain: string) => Promise<FeedItem[]>;

/**
 * The first row of each chain, read once and kept, per feed (one `loadChain`
 * each): a chain's first row never changes.
 */
const read = new WeakMap<LoadChain, Map<string, FeedItem | null>>();

function rootsOf(loadChain: LoadChain): Map<string, FeedItem | null> {
  let roots = read.get(loadChain);
  if (!roots) read.set(loadChain, (roots = new Map()));
  return roots;
}

/**
 * The first row of `chain`, once read; null while it is read, when there is
 * none, or when `chain` is "" (nothing to read).
 */
export function useChainRoot(chain: string, loadChain: LoadChain): FeedItem | null {
  const [root, setRoot] = useState<FeedItem | null>(() => (chain ? (rootsOf(loadChain).get(chain) ?? null) : null));
  useEffect(() => {
    if (!chain) return setRoot(null);
    const roots = rootsOf(loadChain);
    if (roots.has(chain)) return setRoot(roots.get(chain) ?? null);
    let live = true;
    loadChain(chain)
      .then((rows) => {
        roots.set(chain, rows[0] ?? null);
        if (live) setRoot(rows[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [chain, loadChain]);
  return root;
}

export const PEOPLE_ROWS_KEY = "hyperfeed:people-rows";

/** Whether the people-first rows are on in this browser. Off until you turn them on. */
export function readPeopleRows(): boolean {
  try {
    return localStorage.getItem(PEOPLE_ROWS_KEY) === "on";
  } catch {
    return false;
  }
}

export function writePeopleRows(on: boolean) {
  try {
    if (on) localStorage.setItem(PEOPLE_ROWS_KEY, "on");
    else localStorage.removeItem(PEOPLE_ROWS_KEY);
  } catch {
    // Private mode: it holds for this visit.
  }
}

/** The new feed's switch, remembered in this browser. */
export function usePeopleRows(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readPeopleRows);
  const set = useCallback((next: boolean) => {
    setOn(next);
    writePeopleRows(next);
  }, []);
  return [on, set];
}
