// Fixture data for the screenshot harness. See ../shots.mjs.

export interface Scenario {
  id: string;
  title: string;
  page: "spaces" | "forums" | "feed" | "post";
  theme?: "dark";
  /** Nobody has picked a name — the state the nickname bar calls out. */
  unnamed?: boolean;
  empty?: boolean;
}

export const SCENARIOS: Scenario[] = [
  { id: "spaces", title: "Your spaces", page: "spaces" },
  { id: "forums", title: "Forums inside one space", page: "forums" },
  { id: "feed", title: "A forum, posting as yourself", page: "feed" },
  {
    id: "feed-unnamed",
    title: "No name picked yet",
    page: "feed",
    unnamed: true,
  },
  {
    id: "post",
    title: "A thread, with comment votes and moderation",
    page: "post",
  },
  { id: "dark", title: "Dark theme", page: "post", theme: "dark" },
];

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

export const SELF = "a".repeat(64);
const BOB = "b".repeat(64);

export const POSTS = [
  {
    id: "p1",
    author: SELF,
    author_name: "Ana",
    title: "Should the reaper clamp to a keyframe?",
    body: "A delta frame is undecodable without its keyframe, so pruning by row count alone can leave a window nobody can render.",
    created_at: Date.now() - 3_600_000,
    edited_at: Date.now() - 3_600_000,
    score: 7,
    comment_count: 3,
    my_vote: 1,
  },
  {
    id: "p2",
    author: BOB,
    author_name: "Marek",
    title: "Two broadcasters halves the frame rate",
    body: "Measured on four real nodes: 96% delivery with one author, 43% with two.",
    created_at: Date.now() - 86_400_000,
    edited_at: Date.now() - 86_400_000,
    score: 3,
    comment_count: 1,
    my_vote: 0,
  },
  {
    id: "p3",
    author: "c".repeat(64),
    author_name: "",
    title: "An unnamed author falls back to a short id",
    body: "And it is styled as the placeholder it is, rather than in the same weight as a real name.",
    created_at: Date.now() - 172_800_000,
    edited_at: Date.now() - 172_800_000,
    score: -1,
    comment_count: 0,
    my_vote: -1,
  },
];

export const COMMENTS = [
  {
    id: "c1",
    post_id: "p1",
    author: SELF,
    author_name: "Ana",
    body: "Mine, so it carries Edit and Delete.",
    created_at: Date.now() - 1_800_000,
    edited_at: Date.now() - 1_800_000,
    score: 2,
    my_vote: 1,
  },
  {
    id: "c2",
    post_id: "p1",
    author: BOB,
    author_name: "Marek",
    body: "Somebody else's: votable, but no moderation controls — the contract would refuse them anyway.",
    created_at: Date.now() - 900_000,
    edited_at: Date.now() - 600_000,
    score: 0,
    my_vote: 0,
  },
  {
    id: "c3",
    post_id: "p1",
    author: "d".repeat(64),
    author_name: "",
    body: "An unnamed commenter.",
    created_at: Date.now() - 300_000,
    edited_at: Date.now() - 300_000,
    score: -1,
    my_vote: 0,
  },
];
