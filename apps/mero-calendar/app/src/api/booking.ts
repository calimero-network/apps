import type { ExecuteTransport } from "@calimero-network/mero-js";
import { callContract } from "./contract";
import {
  BOOKING_GUEST_METHODS,
  callWithGrant,
  createAccessGrant,
  revokeAccessGrant,
  sha256Hex,
  type OwnerNode,
} from "./accessGrants";

/**
 * Booking links, Calendly style: a link someone with no account opens to book
 * one meeting on the owner's calendar, then reschedule or cancel it with the
 * same link.
 *
 * A link is two things made together: a core access grant (the token, which
 * lets its holder call the five guest methods on the owner's node) and a
 * contract record keyed by the token's SHA-256 (what the link offers, and the
 * booking). The URL carries the node, the calendar and the token in its
 * fragment, so the token never reaches a server log.
 */

export interface WeeklyWindow {
  weekday: number; // 0 = Monday
  startMinute: number;
  endMinute: number;
}

export interface BookingView {
  startMs: number;
  endMs: number;
  guestName: string;
  guestEmail: string;
  guestNote: string;
  bookedAtMs: number;
  rescheduledCount: number;
}

export type LinkStatus = "open" | "booked" | "cancelled";

export interface BookingLinkView {
  linkId: string;
  grantId: string;
  title: string;
  description: string;
  durationMinutes: number;
  weeklyHours: WeeklyWindow[];
  utcOffsetMinutes: number;
  horizonDays: number;
  minNoticeMinutes: number;
  createdAtMs: number;
  expiresAtMs: number | null;
  status: LinkStatus;
  booking: BookingView | null;
}

export interface BookingPage {
  title: string;
  description: string;
  ownerName: string | null;
  durationMinutes: number;
  status: LinkStatus;
  expiresAtMs: number | null;
  booking: BookingView | null;
}

export interface GuestDetails {
  name: string;
  email: string;
  note: string;
}

export interface NewBookingLink {
  title: string;
  description: string;
  durationMinutes: number;
  weeklyHours: WeeklyWindow[];
  horizonDays: number;
  minNoticeMinutes: number;
  /** Unix ms; absent means the link lasts until it is deleted. */
  expiresAtMs?: number | null;
}

/** A meeting time in the viewer's own time zone. */
export function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── The link URL ─────────────────────────────────────────────────────────────

export interface BookingLinkTarget {
  nodeUrl: string;
  contextId: string;
  token: string;
}

/** `{origin}/book#n=<node>&c=<context>&t=<token>`. */
export function bookingUrl(origin: string, target: BookingLinkTarget): string {
  const fragment = new URLSearchParams({
    n: target.nodeUrl,
    c: target.contextId,
    t: target.token,
  });
  return `${origin.replace(/\/+$/, "")}/book#${fragment.toString()}`;
}

/** The target a `/book` URL's fragment names, or `null` when it names none. */
export function parseBookingFragment(hash: string): BookingLinkTarget | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const nodeUrl = params.get("n");
  const contextId = params.get("c");
  const token = params.get("t");
  if (!nodeUrl || !contextId || !token) return null;
  if (!/^https?:\/\//i.test(nodeUrl)) return null;
  if (!/^[0-9a-f]{64}$/i.test(token)) return null;
  return { nodeUrl, contextId, token };
}

// ── The owner ────────────────────────────────────────────────────────────────

/** The browser's UTC offset in minutes, east positive (UTC+2 is 120). */
export function localUtcOffsetMinutes(at = new Date()): number {
  return -at.getTimezoneOffset();
}

/**
 * Make a link: issue the grant, then record the link under the token's hash.
 * If recording fails the grant is revoked again, so no token is left that opens
 * nothing.
 */
export async function createBookingLink(
  node: OwnerNode,
  rpc: ExecuteTransport,
  contextId: string,
  link: NewBookingLink,
): Promise<{ link: BookingLinkView; url: string }> {
  const notAfter = link.expiresAtMs ? Math.floor(link.expiresAtMs / 1000) : null;
  const grant = await createAccessGrant(node, contextId, {
    methods: BOOKING_GUEST_METHODS,
    label: `Booking link: ${link.title}`.slice(0, 128),
    notAfter,
  });
  try {
    const created = await callContract<BookingLinkView>(rpc, contextId, "create_booking_link", {
      link: {
        tokenHash: await sha256Hex(grant.token),
        grantId: grant.grantId,
        title: link.title,
        description: link.description,
        durationMinutes: link.durationMinutes,
        weeklyHours: link.weeklyHours,
        utcOffsetMinutes: localUtcOffsetMinutes(),
        horizonDays: link.horizonDays,
        minNoticeMinutes: link.minNoticeMinutes,
        expiresAtMs: link.expiresAtMs ?? null,
      },
    });
    return {
      link: created,
      url: bookingUrl(window.location.origin, {
        nodeUrl: node.nodeUrl,
        contextId,
        token: grant.token,
      }),
    };
  } catch (err) {
    await revokeAccessGrant(node, contextId, grant.grantId).catch(() => undefined);
    throw err;
  }
}

export function listBookingLinks(
  rpc: ExecuteTransport,
  contextId: string,
): Promise<BookingLinkView[]> {
  return callContract<BookingLinkView[]>(rpc, contextId, "list_booking_links", {}).then(
    (links) => links ?? [],
  );
}

/** Delete a link and revoke its grant. A grant already gone is not an error. */
export async function deleteBookingLink(
  node: OwnerNode,
  rpc: ExecuteTransport,
  contextId: string,
  link: Pick<BookingLinkView, "linkId" | "grantId">,
): Promise<void> {
  await revokeAccessGrant(node, contextId, link.grantId).catch((err: { status?: number }) => {
    if (err?.status !== 404) throw err;
  });
  await callContract(rpc, contextId, "delete_booking_link", { link_id: link.linkId });
}

// ── The guest ────────────────────────────────────────────────────────────────

/**
 * A guest method, under the link's grant. The token goes twice: to the node as
 * the credential, and to the method, which finds the link by it.
 *
 * The route answers the method's return value as JSON, so it is used as is.
 * Not through `parseOutput`: that reads an array of numbers as the bytes of a
 * JSON text, and a list of slots is exactly an array of numbers.
 */
function guestCall<T>(
  target: BookingLinkTarget,
  method: (typeof BOOKING_GUEST_METHODS)[number],
  args: Record<string, unknown>,
): Promise<T> {
  return callWithGrant<T>(target.nodeUrl, target.contextId, target.token, method, {
    token: target.token,
    ...args,
  });
}

export const guest = {
  page: (target: BookingLinkTarget) => guestCall<BookingPage>(target, "get_booking_page", {}),
  slots: (target: BookingLinkTarget, fromMs: number, toMs: number) =>
    guestCall<number[]>(target, "get_available_slots", { from_ms: fromMs, to_ms: toMs }),
  book: (target: BookingLinkTarget, startMs: number, details: GuestDetails) =>
    guestCall<BookingView>(target, "book_slot", { start_ms: startMs, guest: details }),
  reschedule: (target: BookingLinkTarget, startMs: number) =>
    guestCall<BookingView>(target, "reschedule_booking", { start_ms: startMs }),
  cancel: (target: BookingLinkTarget) => guestCall<null>(target, "cancel_booking", {}),
};
