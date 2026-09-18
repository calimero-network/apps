// Aliased over ../../src/lib/groups by vite.config.ts, so the streams and rooms
// pages render their real markup against fixture rows. See ../shots.mjs.
import type { NamespaceRow, ForumRow } from "../../src/lib/groups";
import { scenarioById } from "./fixtures";

export type { NamespaceRow, ForumRow } from "../../src/lib/groups";

const sc = () =>
  scenarioById(new URLSearchParams(location.search).get("s") ?? "idle");

/** The identity this node holds in the room it has already joined. */
const MY_IDENTITY = "8Qk2Hs9vLxTnR4mZbA1cWpYeUf3gJd6NqSvXhKrM8tBz";

const NAMESPACES: NamespaceRow[] = [
  {
    namespaceId: "9xKm2QpLvR7nTzB4aW1cYeUf3gJd6NqSvXhKrM8tZoPq",
    name: "Engineering",
    memberCount: 9,
    forumCount: 3,
  },
  {
    namespaceId: "4bHt7YnQ2vLmXcR9zA1kWpEuF5gJd8NsSvThKrB6tMoZ",
    name: "Design review",
    memberCount: 5,
    forumCount: 1,
  },
  {
    namespaceId: "7CsW3RmT9xKp2QvLnZbA4aY1cWeUf6gJd5NqSvXhKrM8",
    name: "Retro",
    memberCount: 12,
    forumCount: 2,
  },
];

const ROOMS: ForumRow[] = [
  {
    forumId: "forum-daily",
    name: "General",
    contextId: "7Hs2Qk9vLxTnR4mZbA1cWpYeUf3gJd6NqSvXhKrM8tBz",
    memberCount: 7,
    joined: true,
    // The room's roster is keyed by the identity this node holds, so without it
    // a member list cannot mark which row is you.
    identity: MY_IDENTITY,
  },
  {
    forumId: "forum-pairing",
    name: "Bugs",
    contextId: "2FgW8nQmT3xKp9vLzRbA4aY1cWeUf6gJd5NqSvXhKrM8",
    memberCount: 2,
    joined: false,
    identity: null,
  },
  {
    // The state the UI used to render as an inert button: a room whose context
    // has not replicated to this node yet cannot be entered at all.
    forumId: "forum-incident",
    name: "Incident review",
    contextId: null,
    memberCount: 4,
    joined: false,
    identity: null,
  },
];

/** A realistic invite code: deflated JSON, base58, one long line. */
const CODE =
  "5Kd8mQvR2xLnT9pZbA4aYcWeUf6gJd3NsSvXhKrM8tBzQ7Hs2Wk9vLxTnR4mZbA1cWpYeUf3gJd6NqSvXhKrM8tBz" +
  "9xKm2QpLvR7nTzB4aW1cYeUf3gJd6NqSvXhKrM8tZoPq4bHt7YnQ2vLmXcR9zA1kWpEuF5gJd8NsSvThKrB6tMoZ" +
  "7CsW3RmT9xKp2QvLnZbA4aY1cWeUf6gJd5NqSvXhKrM8Kd8mQvR2xLnT9pZbA4aYcWeUf6gJd3NsSvXhKrM8tBzQ";

export async function listSpaceNamespaces(): Promise<NamespaceRow[]> {
  return sc().id === "streams-empty" ? [] : NAMESPACES;
}

export async function listForums(): Promise<ForumRow[]> {
  return ROOMS;
}

export async function namespaceName(): Promise<string> {
  return "Engineering";
}

export async function mintNamespaceInvite(): Promise<string> {
  return CODE;
}

export async function mintForumInvite(): Promise<string> {
  return CODE;
}

export async function createSpaceNamespace() {
  return { namespaceId: NAMESPACES[0].namespaceId, contextId: null };
}

export async function createForum() {
  return { forumId: ROOMS[0].forumId, contextId: ROOMS[0].contextId };
}

export async function acceptInvite() {
  return { namespaceId: NAMESPACES[0].namespaceId };
}

export async function redeemInvite() {
  return { kind: "namespace" as const, namespaceId: NAMESPACES[0].namespaceId };
}

export async function enterForumContext() {
  return MY_IDENTITY;
}

export async function deleteSpace() {
  /* the shots never mutate — the confirm dialog is photographed, not driven */
}

export async function deleteForum() {
  /* as above */
}
