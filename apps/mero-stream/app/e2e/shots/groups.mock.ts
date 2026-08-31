// Aliased over ../../src/lib/groups by vite.config.ts, so the streams and rooms
// pages render their real markup against fixture rows. See ../shots.mjs.
import type { NamespaceRow, RoomRow } from "../../src/lib/groups";
import { scenarioById } from "./fixtures";

export type { NamespaceRow, RoomRow } from "../../src/lib/groups";

const sc = () => scenarioById(new URLSearchParams(location.search).get("s") ?? "idle");

const NAMESPACES: NamespaceRow[] = [
  {
    namespaceId: "9xKm2QpLvR7nTzB4aW1cYeUf3gJd6NqSvXhKrM8tZoPq",
    name: "Engineering standup",
    memberCount: 9,
    roomCount: 3,
  },
  {
    namespaceId: "4bHt7YnQ2vLmXcR9zA1kWpEuF5gJd8NsSvThKrB6tMoZ",
    name: "Design review",
    memberCount: 5,
    roomCount: 1,
  },
  {
    namespaceId: "7CsW3RmT9xKp2QvLnZbA4aY1cWeUf6gJd5NqSvXhKrM8",
    name: "Retro",
    memberCount: 12,
    roomCount: 2,
  },
];

const ROOMS: RoomRow[] = [
  {
    roomId: "room-daily",
    name: "Daily",
    contextId: "7Hs2Qk9vLxTnR4mZbA1cWpYeUf3gJd6NqSvXhKrM8tBz",
    memberCount: 7,
    joined: true,
  },
  {
    roomId: "room-pairing",
    name: "Pairing",
    contextId: "2FgW8nQmT3xKp9vLzRbA4aY1cWeUf6gJd5NqSvXhKrM8",
    memberCount: 2,
    joined: false,
  },
  {
    // The state the UI used to render as an inert button: a room whose context
    // has not replicated to this node yet cannot be entered at all.
    roomId: "room-incident",
    name: "Incident room",
    contextId: null,
    memberCount: 4,
    joined: false,
  },
];

/** A realistic invite code: deflated JSON, base58, one long line. */
const CODE =
  "5Kd8mQvR2xLnT9pZbA4aYcWeUf6gJd3NsSvXhKrM8tBzQ7Hs2Wk9vLxTnR4mZbA1cWpYeUf3gJd6NqSvXhKrM8tBz" +
  "9xKm2QpLvR7nTzB4aW1cYeUf3gJd6NqSvXhKrM8tZoPq4bHt7YnQ2vLmXcR9zA1kWpEuF5gJd8NsSvThKrB6tMoZ" +
  "7CsW3RmT9xKp2QvLnZbA4aY1cWeUf6gJd5NqSvXhKrM8Kd8mQvR2xLnT9pZbA4aYcWeUf6gJd3NsSvXhKrM8tBzQ";

export async function listStreamNamespaces(): Promise<NamespaceRow[]> {
  return sc().id === "streams-empty" ? [] : NAMESPACES;
}

export async function listRooms(): Promise<RoomRow[]> {
  return ROOMS;
}

export async function namespaceName(): Promise<string> {
  return "Engineering standup";
}

export async function mintNamespaceInvite(): Promise<string> {
  return CODE;
}

export async function mintRoomInvite(): Promise<string> {
  return CODE;
}

export async function createStreamNamespace() {
  return { namespaceId: NAMESPACES[0].namespaceId, contextId: null };
}

export async function createRoom() {
  return { roomId: ROOMS[0].roomId, contextId: ROOMS[0].contextId };
}

export async function acceptInvite() {
  return { namespaceId: NAMESPACES[0].namespaceId };
}

export async function redeemInvite() {
  return { kind: "namespace" as const, namespaceId: NAMESPACES[0].namespaceId };
}

export async function enterRoomContext() {
  return "identity";
}
