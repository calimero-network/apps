// An invented workspace for the landing page's recordings. Every id is derived
// from a name, so a run is deterministic. Since core rc.27 every id is 64-char
// hex on BOTH the admin and the contract side, as on a real node.

import { buildDmAlias } from "../../src/utils/dmContext";

function hex32(seed: string): string {
  // Tiny deterministic 32-byte digest (FNV-1a stretched) — ids only need to be
  // stable and distinct, not cryptographic.
  const out: string[] = [];
  let h = 0x811c9dc5;
  for (let round = 0; round < 32; round++) {
    for (const ch of `${seed}#${round}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out.push((h & 0xff).toString(16).padStart(2, "0"));
  }
  return out.join("");
}

// Kept under their old names so the fake node reads unchanged: base58 is gone
// (rc.27), so both are the identity on a hex id.
export function hexToB58(hex: string): string {
  return hex;
}

export function toB58Id(id: string): string {
  return id;
}

export interface Person {
  key: string;
  name: string;
  accountHex: string;
  accountB58: string;
  role: "Admin" | "Member";
}

function person(key: string, name: string, role: Person["role"] = "Member"): Person {
  const accountHex = hex32(`account:${key}`);
  return { key, name, accountHex, accountB58: hexToB58(accountHex), role };
}

export const ME = person("me", "Maya Okafor", "Admin");
export const PEOPLE: Person[] = [
  ME,
  person("theo", "Theo Brandt"),
  person("priya", "Priya Nair", "Admin"),
  person("sam", "Sam Whitfield"),
  person("lena", "Lena Kovač"),
  person("jonas", "Jonas Ekberg"),
  person("ada", "Ada Mensah"),
];
export const P = Object.fromEntries(PEOPLE.map((p) => [p.key, p])) as Record<string, Person>;

export const NAMESPACE_ID = hex32("namespace:northwind");
export const NAMESPACE_NAME = "Northwind Labs";
export const OTHER_NAMESPACES = [
  { id: hex32("namespace:rowing"), name: "Harbour Rowing Club" },
  { id: hex32("namespace:studio"), name: "Fieldnotes Studio" },
];
export const SELF_DEVICE_HEX = hex32("device:me");

export interface Msg {
  id: string;
  from: string; // person key
  text: string;
  minutesAgo: number;
  reactions?: Record<string, string[]>; // emoji -> person keys
  thread?: Msg[];
  edited?: boolean;
  files?: { name: string; mime_type: string; size: number }[];
  /** Set for a message sent during a recording: the composer's HTML, as sent. */
  html?: string;
  /** Wall-clock send time, for messages sent during a recording. */
  sentAt?: number;
}

export interface Ctx {
  key: string;
  name: string;
  type: "Channel" | "Dm";
  visibility: "open" | "restricted";
  description?: string;
  creator: string; // person key
  members: string[]; // person keys
  joined: boolean;
  unread?: number;
  mentions?: number;
  messages: Msg[];
  subgroupId: string;
  contextId: string; // base58, the form the app carries
  selfIdentity: string; // this node's per-context key (base58)
  dmWith?: string;
}

const ALL = PEOPLE.map((p) => p.key);
let msgSeq = 0;
function m(from: string, minutesAgo: number, text: string, extra: Partial<Msg> = {}): Msg {
  msgSeq += 1;
  return { id: `msg-${msgSeq}`, from, text, minutesAgo, ...extra };
}

function ctx(
  key: string,
  name: string,
  opts: Omit<Ctx, "key" | "name" | "subgroupId" | "contextId" | "selfIdentity">,
): Ctx {
  return {
    key,
    name,
    ...opts,
    subgroupId: hex32(`subgroup:${key}`),
    contextId: hexToB58(hex32(`context:${key}`)),
    selfIdentity: hexToB58(hex32(`ctxid:${key}`)),
  };
}

const launchThread: Msg[] = [
  m("priya", 50, "Agreed on Tuesday. Legal signed off on the privacy page this morning, so nothing blocks us on that side."),
  m("sam", 46, "I can have the release notes draft in the doc by Friday noon. Anyone want to review?"),
  m("me", 44, "I'll review, and Lena said she'd do a copy pass."),
  m("theo", 41, "If we ship Tuesday the Android build needs to go to review Friday at the latest. I'll cut the RC tonight."),
  m("lena", 37, "Copy pass works for me. Send it over whenever it's ready."),
];

export const CONTEXTS: Ctx[] = [
  ctx("launch", "launch-planning", {
    type: "Channel",
    visibility: "open",
    description: "Coordinating the 2.0 release",
    creator: "priya",
    members: ALL,
    joined: true,
    messages: [
      m("priya", 188, "Morning all. Quick status round for the 2.0 launch: what's still open on your side?"),
      m("theo", 181, "Offline sync is merged. Two flaky tests left on iOS, both timing related. I should have them fixed today."),
      m("ada", 176, "Onboarding illustrations are final. The export is in the shared drive under **Launch / Assets**.", {
        reactions: { "🎉": ["priya", "me", "lena"], "❤️": ["sam"] },
      }),
      m("sam", 170, "Pricing page is ready for review. The one open question is whether we show annual pricing by default."),
      m("jonas", 162, "Support macros for the new sync settings are drafted. I'd like someone from eng to sanity-check the troubleshooting steps."),
      m("theo", 158, "@Jonas Ekberg happy to, send me the link"),
      m("me", 64, "Proposal: we move the launch from Thursday to **Tuesday** so we're not shipping into the long weekend. Thoughts?", {
        reactions: { "👍": ["priya", "theo", "sam", "ada"], "👀": ["jonas"] },
        thread: launchThread,
      }),
      m("ada", 30, "Tuesday is fine for design. I'll move the social posts and the blog header to match."),
      m("priya", 22, "Great. I've updated the launch checklist: https://notes.northwind.example/launch-2-0", {
        edited: true,
      }),
      m("jonas", 12, "Support is staffed for Tuesday and Wednesday. I'll post the on-call rota here tomorrow.", {
        reactions: { "🙏": ["me", "priya"] },
      }),
      m("theo", 4, "RC1 is building now. I'll share the TestFlight link once it's through processing."),
    ],
  }),
  ctx("general", "general", {
    type: "Channel",
    visibility: "open",
    description: "Company-wide announcements",
    creator: "priya",
    members: ALL,
    joined: true,
    unread: 3,
    messages: [
      m("priya", 900, "Reminder: the office is closed next Monday for the public holiday."),
      m("lena", 420, "Welcome Ada to the team! She's joining us as a product designer. 👋", {
        reactions: { "👋": ["theo", "sam", "jonas", "me", "priya"] },
      }),
      m("ada", 415, "Thank you! Excited to be here."),
      m("sam", 30, "Lunch order for Friday is up on the kitchen board."),
    ],
  }),
  ctx("design", "design", {
    type: "Channel",
    visibility: "open",
    description: "Critique, work in progress, inspiration",
    creator: "ada",
    members: ALL,
    joined: true,
    unread: 1,
    mentions: 1,
    messages: [
      m("ada", 240, "Posting the new empty states for review. Comments welcome, I'd like to lock them by Thursday."),
      m("lena", 200, "@Maya Okafor could you look at the copy on the second one?"),
    ],
  }),
  ctx("engineering", "engineering", {
    type: "Channel",
    visibility: "open",
    description: "Builds, reviews and incidents",
    creator: "theo",
    members: ALL,
    joined: true,
    messages: [
      m("theo", 300, "Staging is on the new database version. Let me know if anything looks off."),
      m("jonas", 280, "Seeing slightly slower search, but within the budget."),
    ],
  }),
  ctx("random", "random", {
    type: "Channel",
    visibility: "open",
    description: "Everything else",
    creator: "sam",
    members: ALL,
    joined: true,
    messages: [m("sam", 600, "Who left the sourdough starter in the fridge? It has achieved sentience.")],
  }),
  ctx("leadership", "leadership", {
    type: "Channel",
    visibility: "restricted",
    description: "Private: planning and hiring",
    creator: "priya",
    members: ["me", "priya", "theo"],
    joined: true,
    messages: [m("priya", 1400, "Q4 hiring plan draft is ready for comments.")],
  }),
  // DMs
  ctx("dm-theo", "Theo Brandt", {
    type: "Dm",
    visibility: "restricted",
    creator: "me",
    members: ["me", "theo"],
    joined: true,
    dmWith: "theo",
    unread: 2,
    messages: [
      m("me", 95, "Hey, do you have a minute to look at the sync conflict screen before the RC?"),
      m("theo", 90, "Sure. Is it the one where both devices edit the same note offline?"),
      m("me", 88, "Yes. Right now we keep the newer edit and drop the other one silently. I'd like to keep both and let the user pick."),
      m("theo", 80, "That's doable. The merge layer already has both versions, we just never surface them."),
      m("theo", 79, "I'd rather not squeeze it into 2.0 though. Can we put it first thing in 2.1?"),
      m("me", 70, "Fair. Let's ship 2.0 with a clear \"conflicting copy\" note instead, so nothing is lost."),
      m("theo", 8, "Done, it's in RC1. The conflicting copy shows up next to the original with the device name in the title."),
      m("theo", 7, "Screenshots are in #launch-planning if you want to check the wording."),
    ],
  }),
  ctx("dm-priya", "Priya Nair", {
    type: "Dm",
    visibility: "restricted",
    creator: "priya",
    members: ["me", "priya"],
    joined: true,
    dmWith: "priya",
    messages: [
      m("priya", 300, "Can we move our 1:1 to Thursday this week?"),
      m("me", 290, "Thursday 10:00 works."),
    ],
  }),
  ctx("dm-sam", "Sam Whitfield", {
    type: "Dm",
    visibility: "restricted",
    creator: "sam",
    members: ["me", "sam"],
    joined: true,
    dmWith: "sam",
    messages: [m("sam", 1500, "Thanks for the pricing feedback, updated the page.")],
  }),
  ctx("dm-lena", "Lena Kovač", {
    type: "Dm",
    visibility: "restricted",
    creator: "me",
    members: ["me", "lena"],
    joined: true,
    dmWith: "lena",
    messages: [m("lena", 2900, "Sending the copy doc over now.")],
  }),
];

export function dmAliasFor(c: Ctx): string {
  return buildDmAlias(ME.accountHex, P[c.dmWith!].accountHex);
}

export const NOW_S = Math.floor(Date.now() / 1000);
