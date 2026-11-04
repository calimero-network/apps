import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";

import {
  BOOKING_GUEST_METHODS,
  calendar,
  type BookingLinkView,
  type BookingPage,
  type BookingView,
  type Calendar,
  type GuestDetails,
  type WeeklyWindow,
} from "./calendar";

export type {
  BookingLinkView,
  BookingPage,
  BookingView,
  GuestDetails,
  LinkStatus,
  WeeklyWindow,
} from "./calendar";

/**
 * Booking links: a link someone with no account opens to book one meeting on
 * the owner's calendar, then reschedule or cancel it with the same link.
 *
 * A link is two things made together: a core **API key** for the owner's
 * account (the token), limited to this calendar and the five guest methods,
 * and a contract record keyed by the token's SHA-256 (what the link offers, and
 * the booking). v1 used a node's access grant; on Calimero 1.0 the API key is
 * the same idea, made with the owner's passkey. The URL carries the calendar
 * and the token in its fragment, so the token never reaches a server log.
 */

export interface NewBookingLink {
  title: string;
  description: string;
  durationMinutes: number;
  weeklyHours: WeeklyWindow[];
  horizonDays: number;
  minNoticeMinutes: number;
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

/** What a `/book` link names: the calendar (an app instance) and the token. */
export interface BookingLinkTarget {
  app: string;
  token: string;
}

/** `{base}/book#a=<app>&t=<token>`. */
export function bookingUrl(base: string, target: BookingLinkTarget): string {
  const fragment = new URLSearchParams({ a: target.app, t: target.token });
  return `${base.replace(/\/+$/, "")}/book#${fragment.toString()}`;
}

/** The target a `/book` URL's fragment names, or `null` when it names none. */
export function parseBookingFragment(hash: string): BookingLinkTarget | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const app = params.get("a")?.trim();
  const token = params.get("t")?.trim();
  if (!app || !token) return null;
  return { app, token };
}

/** The browser's UTC offset in minutes, east positive (UTC+2 is 120). */
export function localUtcOffsetMinutes(at = new Date()): number {
  return -at.getTimezoneOffset();
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The signed-in owner, at one calendar. */
export interface Owner {
  client: Pick<CalimeroClient, "createApiKey" | "revokeApiKey" | "call" | "view">;
  app: string;
  passkey: () => PasskeyProvider;
  after?: () => void;
}

/** The longest an API key lives (core's `MAX_API_KEY_TTL`): a link without an expiry ends then. */
export const MAX_KEY_SECS = 365 * 24 * 3600;

/**
 * Make a link: create the API key (a passkey step-up), then record the link
 * under the key's hash. If recording fails the key is revoked again, so no
 * token is left that opens nothing.
 */
export async function createBookingLink(
  owner: Owner,
  link: NewBookingLink,
  base: string,
  now = Date.now(),
): Promise<{ link: BookingLinkView; url: string }> {
  const ttlSecs = link.expiresAtMs
    ? Math.max(60, Math.min(MAX_KEY_SECS, Math.ceil((link.expiresAtMs - now) / 1000)))
    : undefined;
  const key = await owner.client.createApiKey(
    {
      label: `Booking link: ${link.title}`.slice(0, 128),
      apps: [owner.app],
      methods: [...BOOKING_GUEST_METHODS],
      ...(ttlSecs ? { ttlSecs } : {}),
    },
    owner.passkey(),
  );
  owner.after?.();
  try {
    const created = await calendar(owner.client, owner.app, owner.after).createBookingLink({
      tokenHash: await sha256Hex(key.key),
      grantId: key.keyId,
      title: link.title,
      description: link.description,
      durationMinutes: link.durationMinutes,
      weeklyHours: link.weeklyHours,
      utcOffsetMinutes: localUtcOffsetMinutes(),
      horizonDays: link.horizonDays,
      minNoticeMinutes: link.minNoticeMinutes,
      expiresAtMs: link.expiresAtMs ?? null,
    });
    return { link: created, url: bookingUrl(base, { app: owner.app, token: key.key }) };
  } catch (err) {
    await owner.client.revokeApiKey(key.keyId, owner.passkey()).catch(() => undefined);
    throw err;
  }
}

export function listBookingLinks(owner: Owner): Promise<BookingLinkView[]> {
  return calendar(owner.client, owner.app, owner.after).listBookingLinks();
}

/** Revoke the link's API key (already gone is fine), then delete the record. */
export async function deleteBookingLink(
  owner: Owner,
  link: Pick<BookingLinkView, "linkId" | "grantId">,
): Promise<void> {
  if (link.grantId) {
    await owner.client.revokeApiKey(link.grantId, owner.passkey()).catch((err: { status?: number }) => {
      if (err?.status !== 404) throw err;
    });
  }
  await calendar(owner.client, owner.app, owner.after).deleteBookingLink(link.linkId);
}

// ── The guest ────────────────────────────────────────────────────────────────

/**
 * The calendar as the guest reaches it: a client of its own (never the
 * page's signed-in one) that authenticates every request with the link's key.
 */
export function guestCalendar(client: Pick<CalimeroClient, "useApiKey" | "call" | "view">, target: BookingLinkTarget): Calendar {
  client.useApiKey(target.token);
  return calendar(client, target.app);
}

export const guest = {
  page: (cal: Calendar, target: BookingLinkTarget): Promise<BookingPage> => cal.getBookingPage(target.token),
  slots: (cal: Calendar, target: BookingLinkTarget, fromMs: number, toMs: number): Promise<number[]> =>
    cal.getAvailableSlots(target.token, fromMs, toMs),
  book: (cal: Calendar, target: BookingLinkTarget, startMs: number, details: GuestDetails): Promise<BookingView> =>
    cal.bookSlot(target.token, startMs, details),
  reschedule: (cal: Calendar, target: BookingLinkTarget, startMs: number): Promise<BookingView> =>
    cal.rescheduleBooking(target.token, startMs),
  cancel: (cal: Calendar, target: BookingLinkTarget): Promise<null> => cal.cancelBooking(target.token),
};
