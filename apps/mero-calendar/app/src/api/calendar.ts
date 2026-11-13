import { AppError } from "@calimero-network/mero-js";

import type {
  CalendarEvent,
  CreateBookingLink,
  CreateCalendarEvent,
  UpdateCalendarEvent,
} from "../generated/client";

/**
 * The calendar contract (`logic/`), typed, and the one adapter that turns its
 * Calimero 1.0 answers back into the shapes the screens were written for.
 *
 * What changed on the wire, and is undone here so no screen has to know:
 *
 * - method and argument names are camelCase (`get_events` → `getEvents`,
 *   `event_data` → `eventData`); event fields keep v1's `event_type`;
 * - v1's `timestamp` arguments are gone (the app's log is the clock);
 * - 64-bit integers are decimal strings (`"1783296000000"`): converted back to
 *   numbers (every one here is a millisecond time, well inside 2^53);
 * - errors are typed (`AppError` with a code): turned back into v1's messages.
 *
 * The contract is called through `MeroCalendarClient`, which `mero-app-build
 * codegen` writes from `logic/res/abi.json` (`src/generated/client.ts`;
 * `client.test.ts` checks it against the ABI), typed from the ABI's record
 * shapes: each answer passes through the `to*` here, and each record argument
 * through `eventArgs` / `updateArgs` / `linkArgs`.
 */

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-calendar";

/** The methods a booking link's API key may call, and nothing else. */
export const BOOKING_GUEST_METHODS = [
  "getBookingPage",
  "getAvailableSlots",
  "bookSlot",
  "rescheduleBooking",
  "cancelBooking",
] as const;

// ── Shapes (as the screens use them) ─────────────────────────────────────────

/** An event as the contract answers it (v1's field names). */
export type WireEvent = CalendarEvent;

/** What a create or update sends. `peers` are account ids. */
export interface EventFields {
  title: string;
  description: string;
  start: string;
  end: string;
  event_type: string;
  color: string;
  peers: string[];
}

export interface WireMember {
  id: string;
  username: string;
  joinedAt: number;
  usernameUpdatedAt: number;
}

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
  /** The API key the link's token is (v1: the access grant). */
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

export interface CreateBookingLinkArgs {
  tokenHash: string;
  grantId: string;
  title: string;
  description: string;
  durationMinutes: number;
  weeklyHours: WeeklyWindow[];
  utcOffsetMinutes: number;
  horizonDays: number;
  minNoticeMinutes: number;
  expiresAtMs: number | null;
}

/** Partial fields of an update; absent ones stay as they are. */
export type EventUpdate = Partial<EventFields>;

// ── Conversions ──────────────────────────────────────────────────────────────

/** A decimal string (or a number) as a number; `null` stays `null`. */
export function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

function optNum(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

/** A number as the decimal string a u64 argument must be. */
export function u64(ms: number): string {
  return String(Math.max(0, Math.trunc(ms)));
}

type Raw = Record<string, unknown>;

export function toBooking(raw: unknown): BookingView | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Raw;
  return {
    startMs: num(b.startMs),
    endMs: num(b.endMs),
    guestName: String(b.guestName ?? ""),
    guestEmail: String(b.guestEmail ?? ""),
    guestNote: String(b.guestNote ?? ""),
    bookedAtMs: num(b.bookedAtMs),
    rescheduledCount: num(b.rescheduledCount),
  };
}

export function toLink(raw: unknown): BookingLinkView {
  const l = (raw ?? {}) as Raw;
  return {
    linkId: String(l.linkId ?? ""),
    grantId: String(l.grantId ?? ""),
    title: String(l.title ?? ""),
    description: String(l.description ?? ""),
    durationMinutes: num(l.durationMinutes),
    weeklyHours: (l.weeklyHours as WeeklyWindow[] | undefined) ?? [],
    utcOffsetMinutes: num(l.utcOffsetMinutes),
    horizonDays: num(l.horizonDays),
    minNoticeMinutes: num(l.minNoticeMinutes),
    createdAtMs: num(l.createdAtMs),
    expiresAtMs: optNum(l.expiresAtMs),
    status: (l.status as LinkStatus) ?? "open",
    booking: toBooking(l.booking),
  };
}

export function toPage(raw: unknown): BookingPage {
  const p = (raw ?? {}) as Raw;
  return {
    title: String(p.title ?? ""),
    description: String(p.description ?? ""),
    ownerName: (p.ownerName as string | null | undefined) ?? null,
    durationMinutes: num(p.durationMinutes),
    status: (p.status as LinkStatus) ?? "open",
    expiresAtMs: optNum(p.expiresAtMs),
    booking: toBooking(p.booking),
  };
}

export function toMember(raw: unknown): WireMember {
  const m = (raw ?? {}) as Raw;
  return {
    id: String(m.id ?? ""),
    username: String(m.username ?? ""),
    joinedAt: num(m.joinedAt),
    usernameUpdatedAt: num(m.usernameUpdatedAt),
  };
}

/**
 * v1's message for a typed contract error, so toasts and the booking page read
 * as they did. Anything else keeps its own message.
 */
export function messageOf(error: unknown): string {
  if (error instanceof AppError || (error as { appCode?: unknown } | null)?.appCode) {
    const e = error as { appCode: string; fields?: Raw; message?: string };
    const fields = e.fields ?? {};
    switch (e.appCode) {
      case "NotFound":
        return `key not found: ${String(fields.id ?? "")}`;
      case "Forbidden":
        return "operation forbidden";
      case "Invalid":
        return String(fields.message ?? "invalid input");
      case "LinkExists":
        return "a booking link already exists for this token";
      case "AlreadyBooked":
        return "this link already booked a meeting; reschedule it instead";
      case "LinkCancelled":
        return "this link's meeting was cancelled; ask for a new link";
      case "LinkExpired":
        return "this booking link has expired";
      case "NotBooked":
        return "this link has no booked meeting";
      case "SlotUnavailable":
        return "that time is not available";
      default:
        return e.message || e.appCode;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

// ── The contract ─────────────────────────────────────────────────────────────

/**
 * Only the fields an update names: the contract refuses unknown keys, and null
 * means "unchanged". Every field of `UpdateCalendarEvent` is `#[serde(default)]`,
 * which the ABI records, so the generated type has each one optional.
 */
export function updateArgs(update: EventUpdate): UpdateCalendarEvent {
  const out: UpdateCalendarEvent = {};
  for (const key of ["title", "description", "start", "end", "event_type", "color", "peers"] as const) {
    if (update[key] !== undefined) (out as Raw)[key] = update[key];
  }
  return out;
}

export function eventArgs(event: EventFields): CreateCalendarEvent {
  return {
    title: event.title,
    description: event.description,
    start: event.start,
    end: event.end,
    event_type: event.event_type,
    color: event.color,
    peers: event.peers,
  };
}

/** `createBookingLink`'s `link` argument: its expiry a u64. */
export function linkArgs(link: CreateBookingLinkArgs): CreateBookingLink {
  return { ...link, expiresAtMs: link.expiresAtMs === null ? null : u64(link.expiresAtMs) };
}

/** `getEvents` / `getPrivateEvents`'s answer. */
export const toEvents = (v: WireEvent[] | null): WireEvent[] => v ?? [];
/** `getMembers`' answer. */
export const toMembers = (v: unknown): WireMember[] => ((v as unknown[] | null) ?? []).map(toMember);
/** `listBookingLinks`' answer. */
export const toLinks = (v: unknown): BookingLinkView[] => ((v as unknown[] | null) ?? []).map(toLink);
/** `getAvailableSlots`' answer: slot starts in ms. */
export const toSlots = (v: unknown): number[] => ((v as unknown[] | null) ?? []).map(num);
