//! Booking links: a Calendly-style link that lets someone with no account book
//! one meeting on the owner's calendar, and later reschedule or cancel it.
//!
//! # Who calls what
//!
//! The owner calls `create_booking_link`, `list_booking_links` and
//! `delete_booking_link` from their own node, as with every other method.
//!
//! The guest has no account and no node. The owner's node issues them a core
//! **access grant** (`POST /admin-api/contexts/:id/grants`) naming only the five
//! guest methods below, and the guest calls them through the public
//! `/grant-calls` route with the grant's token. The node runs those calls as
//! itself, so inside the contract the caller is the owner; what tells one guest
//! from another is the token, which every guest method takes as `token`. The
//! link is stored under the SHA-256 of that token, so the contract keeps no
//! secret and a token opens exactly one link.
//!
//! - `get_booking_page(token)` — what the link offers, and the booking if any
//! - `get_available_slots(token, from_ms, to_ms)` — free start times
//! - `book_slot(token, start_ms, guest)` — book once
//! - `reschedule_booking(token, start_ms)` — move that booking
//! - `cancel_booking(token)` — cancel it; the link is then spent
//!
//! # Why everything here is private storage
//!
//! Links, guests' names and emails, and the booked meetings live in
//! `#[app::private]` storage on the owner's node and never replicate. A team
//! member has no business holding the owner's booking links, and a guest's email
//! is not team data. It also means only the owner's node can ever answer a
//! guest: on any other node the link does not exist.
//!
//! # Time
//!
//! Every instant here is Unix milliseconds, UTC. Weekly hours are wall-clock
//! minutes at a fixed UTC offset the owner's browser reports when the link is
//! made; a daylight-saving change moves them by an hour until the link is
//! re-made. Events this calendar already holds store their times as text, in
//! either ISO 8601 or the format a browser's `Date.toString()` produces, and
//! [`parse_event_time_ms`] reads both so they can block slots.

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env};
use calimero_storage::collections::UnorderedMap;
use sha2::{Digest, Sha256};

/// One minute, in milliseconds.
const MINUTE_MS: i64 = 60_000;
/// One day, in milliseconds.
const DAY_MS: i64 = 86_400_000;
/// The widest window `get_available_slots` answers for, so a guest cannot make
/// the owner's node enumerate a year of slots in one call.
pub const MAX_SLOT_RANGE_DAYS: i64 = 62;
/// The most slots one answer carries.
pub const MAX_SLOTS: usize = 1_000;
pub const MAX_TITLE_LEN: usize = 120;
pub const MAX_DESCRIPTION_LEN: usize = 2_000;
pub const MAX_GUEST_NAME_LEN: usize = 100;
pub const MAX_GUEST_EMAIL_LEN: usize = 254;
pub const MAX_GUEST_NOTE_LEN: usize = 2_000;
/// The color a booked meeting is drawn in.
const BOOKING_COLOR: &str = "rgb(121, 134, 203)";

// ── Stored state (node-local) ───────────────────────────────────────────────

/// One stretch of the week the owner takes bookings in: `weekday` 0 is Monday,
/// minutes are wall-clock minutes of that day at the link's UTC offset.
#[derive(
    Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct WeeklyWindow {
    pub weekday: u8,
    pub start_minute: u16,
    pub end_minute: u16,
}

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct BookingState {
    /// The private event the meeting is in the owner's calendar as.
    pub event_id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub guest_name: String,
    pub guest_email: String,
    pub guest_note: String,
    pub booked_at_ms: u64,
    pub rescheduled_count: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub enum LinkStatus {
    /// Nothing booked yet.
    Open,
    /// One meeting booked; it can be rescheduled or cancelled.
    Booked,
    /// The meeting was cancelled. The link is spent: it books once.
    Cancelled,
}

impl LinkStatus {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Booked => "booked",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct BookingLinkState {
    /// The core access grant the token belongs to, so the owner's client can
    /// revoke it with the link. Opaque here.
    pub grant_id: String,
    pub title: String,
    pub description: String,
    pub duration_minutes: u32,
    pub weekly_hours: Vec<WeeklyWindow>,
    pub utc_offset_minutes: i32,
    pub horizon_days: u32,
    pub min_notice_minutes: u32,
    pub created_at_ms: u64,
    pub expires_at_ms: Option<u64>,
    pub status: LinkStatus,
    pub booking: Option<BookingState>,
}

/// The owner's booking links, keyed by the hex SHA-256 of each link's token.
#[derive(BorshSerialize, BorshDeserialize, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[app::private]
pub struct BookingLinks {
    pub links: UnorderedMap<String, BookingLinkState>,
}

impl Default for BookingLinks {
    fn default() -> Self {
        Self {
            links: UnorderedMap::new(),
        }
    }
}

// ── Requests and views ──────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct CreateBookingLink {
    /// Hex SHA-256 of the access grant's token. The token itself never reaches
    /// the contract from the owner.
    pub token_hash: String,
    pub grant_id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub duration_minutes: u32,
    pub weekly_hours: Vec<WeeklyWindow>,
    /// The owner's UTC offset in minutes, east positive (UTC+2 is 120).
    pub utc_offset_minutes: i32,
    /// How far ahead a guest may book.
    pub horizon_days: u32,
    /// How soon a guest may book.
    #[serde(default)]
    pub min_notice_minutes: u32,
    #[serde(default)]
    pub expires_at_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct GuestDetails {
    pub name: String,
    pub email: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct BookingView {
    pub start_ms: u64,
    pub end_ms: u64,
    pub guest_name: String,
    pub guest_email: String,
    pub guest_note: String,
    pub booked_at_ms: u64,
    pub rescheduled_count: u32,
}

/// What a guest sees of a link.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct BookingPage {
    pub title: String,
    pub description: String,
    pub owner_name: Option<String>,
    pub duration_minutes: u32,
    /// `open`, `booked` or `cancelled`.
    pub status: String,
    pub expires_at_ms: Option<u64>,
    pub booking: Option<BookingView>,
}

/// What the owner sees of a link.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct BookingLinkView {
    pub link_id: String,
    pub grant_id: String,
    pub title: String,
    pub description: String,
    pub duration_minutes: u32,
    pub weekly_hours: Vec<WeeklyWindow>,
    pub utc_offset_minutes: i32,
    pub horizon_days: u32,
    pub min_notice_minutes: u32,
    pub created_at_ms: u64,
    pub expires_at_ms: Option<u64>,
    pub status: String,
    pub booking: Option<BookingView>,
}

impl BookingState {
    pub fn view(&self) -> BookingView {
        BookingView {
            start_ms: self.start_ms,
            end_ms: self.end_ms,
            guest_name: self.guest_name.clone(),
            guest_email: self.guest_email.clone(),
            guest_note: self.guest_note.clone(),
            booked_at_ms: self.booked_at_ms,
            rescheduled_count: self.rescheduled_count,
        }
    }
}

impl BookingLinkState {
    pub fn owner_view(&self, link_id: String) -> BookingLinkView {
        BookingLinkView {
            link_id,
            grant_id: self.grant_id.clone(),
            title: self.title.clone(),
            description: self.description.clone(),
            duration_minutes: self.duration_minutes,
            weekly_hours: self.weekly_hours.clone(),
            utc_offset_minutes: self.utc_offset_minutes,
            horizon_days: self.horizon_days,
            min_notice_minutes: self.min_notice_minutes,
            created_at_ms: self.created_at_ms,
            expires_at_ms: self.expires_at_ms,
            status: self.status.as_str().to_owned(),
            booking: self.booking.as_ref().map(BookingState::view),
        }
    }

    pub fn guest_page(&self, owner_name: Option<String>) -> BookingPage {
        BookingPage {
            title: self.title.clone(),
            description: self.description.clone(),
            owner_name,
            duration_minutes: self.duration_minutes,
            status: self.status.as_str().to_owned(),
            expires_at_ms: self.expires_at_ms,
            booking: self.booking.as_ref().map(BookingState::view),
        }
    }

    /// Whether the link has passed its own expiry at `now_ms`.
    pub fn expired(&self, now_ms: u64) -> bool {
        self.expires_at_ms.is_some_and(|at| now_ms > at)
    }

    fn duration_ms(&self) -> i64 {
        i64::from(self.duration_minutes) * MINUTE_MS
    }
}

// ── Validation ──────────────────────────────────────────────────────────────

/// The id a token's link is stored under: hex SHA-256 of the token's text.
///
/// The owner's browser computes the same value (Web Crypto) when it creates the
/// link, so the token itself never has to be handed to the contract by the owner.
pub fn link_id_of(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn is_hex_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn check_len(value: &str, field: &str, max: usize) -> app::Result<()> {
    if value.chars().count() > max {
        app::bail!("{field} cannot be longer than {max} characters");
    }
    Ok(())
}

pub fn validate_link(link: &CreateBookingLink) -> app::Result<()> {
    if !is_hex_sha256(&link.token_hash) {
        app::bail!("tokenHash must be a lowercase hex SHA-256");
    }
    if link.title.trim().is_empty() {
        app::bail!("title cannot be empty");
    }
    check_len(&link.title, "title", MAX_TITLE_LEN)?;
    check_len(&link.description, "description", MAX_DESCRIPTION_LEN)?;
    if !(5..=480).contains(&link.duration_minutes) {
        app::bail!("durationMinutes must be between 5 and 480");
    }
    if !(1..=365).contains(&link.horizon_days) {
        app::bail!("horizonDays must be between 1 and 365");
    }
    if !(-14 * 60..=14 * 60).contains(&link.utc_offset_minutes) {
        app::bail!("utcOffsetMinutes must be within ±14 hours");
    }
    if link.weekly_hours.is_empty() {
        app::bail!("weeklyHours cannot be empty");
    }
    if link.weekly_hours.len() > 7 * 8 {
        app::bail!("weeklyHours has too many windows");
    }
    for window in &link.weekly_hours {
        if window.weekday > 6
            || window.end_minute > 1440
            || window.start_minute >= window.end_minute
        {
            app::bail!(
                "weekly window {:?} must have weekday 0-6 and 0 <= start < end <= 1440",
                window
            );
        }
    }
    Ok(())
}

pub fn validate_guest(guest: &GuestDetails) -> app::Result<()> {
    if guest.name.trim().is_empty() {
        app::bail!("name cannot be empty");
    }
    check_len(&guest.name, "name", MAX_GUEST_NAME_LEN)?;
    let email = guest.email.trim();
    if email.is_empty() || !email.contains('@') {
        app::bail!("email must be an email address");
    }
    check_len(email, "email", MAX_GUEST_EMAIL_LEN)?;
    check_len(&guest.note, "note", MAX_GUEST_NOTE_LEN)?;
    Ok(())
}

// ── Slots ───────────────────────────────────────────────────────────────────

/// A half-open busy interval, in Unix milliseconds.
pub type Busy = (i64, i64);

/// The start times `link` offers in `[from_ms, to_ms)`, given the owner's busy
/// intervals and the time `now_ms`.
///
/// A slot is offered when it lies in a weekly window, starts no sooner than the
/// link's minimum notice and no later than its horizon, and overlaps nothing
/// busy. Pure, so the rules are tested without a clock.
pub fn available_slots(
    link: &BookingLinkState,
    busy: &[Busy],
    now_ms: i64,
    from_ms: i64,
    to_ms: i64,
) -> Vec<u64> {
    let duration = link.duration_ms();
    let earliest = from_ms.max(now_ms + i64::from(link.min_notice_minutes) * MINUTE_MS);
    let mut latest = to_ms.min(now_ms + i64::from(link.horizon_days) * DAY_MS);
    if let Some(expires) = link.expires_at_ms {
        latest = latest.min(i64::try_from(expires).unwrap_or(i64::MAX));
    }
    if earliest >= latest {
        return Vec::new();
    }

    let offset = i64::from(link.utc_offset_minutes) * MINUTE_MS;
    // Local days that can hold a slot in range; one extra on each side covers
    // a window that crosses UTC midnight.
    let first_day = (earliest + offset).div_euclid(DAY_MS) - 1;
    let last_day = (latest + offset).div_euclid(DAY_MS) + 1;

    let mut slots = Vec::new();
    for day in first_day..=last_day {
        let weekday = (day + 3).rem_euclid(7) as u8;
        let day_start_utc = day * DAY_MS - offset;
        let mut windows: Vec<&WeeklyWindow> = link
            .weekly_hours
            .iter()
            .filter(|w| w.weekday == weekday)
            .collect();
        windows.sort_by_key(|w| w.start_minute);
        for window in windows {
            let window_end = day_start_utc + i64::from(window.end_minute) * MINUTE_MS;
            let mut start = day_start_utc + i64::from(window.start_minute) * MINUTE_MS;
            while start + duration <= window_end {
                let end = start + duration;
                if start >= earliest
                    && start < latest
                    && !busy.iter().any(|&(b0, b1)| start < b1 && b0 < end)
                {
                    slots.push(start as u64);
                    if slots.len() >= MAX_SLOTS {
                        slots.sort_unstable();
                        slots.dedup();
                        return slots;
                    }
                }
                start += duration;
            }
        }
    }
    slots.sort_unstable();
    slots.dedup();
    slots
}

/// The current time, in Unix milliseconds.
pub fn now_ms() -> u64 {
    env::time_now() / 1_000_000
}

// ── Reading event times ─────────────────────────────────────────────────────

/// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's
/// `days_from_civil`).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The inverse of [`days_from_civil`]: `(year, month, day)`.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn valid_date(year: i64, month: i64, day: i64) -> bool {
    (1..=12).contains(&month) && (1..=31).contains(&day) && (1..=9999).contains(&year)
}

fn parse_clock(text: &str) -> Option<(i64, i64, i64, i64)> {
    // HH:MM[:SS[.fff]]
    let mut parts = text.splitn(3, ':');
    let hour: i64 = parts.next()?.parse().ok()?;
    let minute: i64 = parts.next()?.parse().ok()?;
    let (second, millis) = match parts.next() {
        None => (0, 0),
        Some(rest) => {
            let (sec, frac) = rest.split_once('.').unwrap_or((rest, ""));
            let mut millis = 0;
            for (i, c) in frac.chars().take(3).enumerate() {
                millis += i64::from(c.to_digit(10)?) * [100, 10, 1][i];
            }
            (sec.parse().ok()?, millis)
        }
    };
    ((0..24).contains(&hour) && (0..60).contains(&minute) && (0..61).contains(&second))
        .then_some((hour, minute, second, millis))
}

/// `+HH:MM`, `+HHMM`, `+HH` or `Z`, as minutes east of UTC.
fn parse_offset(text: &str) -> Option<i64> {
    if text == "Z" {
        return Some(0);
    }
    let sign = match text.as_bytes().first()? {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let digits: String = text[1..].chars().filter(|c| *c != ':').collect();
    let (hours, minutes) = match digits.len() {
        2 => (digits.parse::<i64>().ok()?, 0),
        4 => (digits[..2].parse().ok()?, digits[2..].parse().ok()?),
        _ => return None,
    };
    Some(sign * (hours * 60 + minutes))
}

fn to_ms(year: i64, month: i64, day: i64, clock: (i64, i64, i64, i64), offset_min: i64) -> i64 {
    let (hour, minute, second, millis) = clock;
    let local = days_from_civil(year, month, day) * DAY_MS
        + hour * 3_600_000
        + minute * MINUTE_MS
        + second * 1_000
        + millis;
    local - offset_min * MINUTE_MS
}

/// ISO 8601: `YYYY-MM-DD[THH:MM[:SS[.fff]]][Z|±HH:MM]`. No offset reads as UTC.
fn parse_iso(text: &str) -> Option<i64> {
    let (date, rest) = text.split_at_checked(10)?;
    let mut fields = date.split('-');
    let year: i64 = fields.next()?.parse().ok()?;
    let month: i64 = fields.next()?.parse().ok()?;
    let day: i64 = fields.next()?.parse().ok()?;
    if !valid_date(year, month, day) || date.as_bytes()[4] != b'-' {
        return None;
    }
    if rest.is_empty() {
        return Some(to_ms(year, month, day, (0, 0, 0, 0), 0));
    }
    let rest = rest.strip_prefix('T').or_else(|| rest.strip_prefix(' '))?;
    let split = rest.find(['Z', '+', '-']).unwrap_or(rest.len());
    let clock = parse_clock(&rest[..split])?;
    let offset = if split == rest.len() {
        0
    } else {
        parse_offset(&rest[split..])?
    };
    Some(to_ms(year, month, day, clock, offset))
}

/// A browser's `Date.toString()`: `Wed Jul 01 2026 09:00:00 GMT+0200 (…)`.
fn parse_js_date(text: &str) -> Option<i64> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let mut words = text.split_whitespace();
    let _weekday = words.next()?;
    let month_word = words.next()?.get(..3)?;
    let month = MONTHS.iter().position(|m| *m == month_word)? as i64 + 1;
    let day: i64 = words.next()?.parse().ok()?;
    let year: i64 = words.next()?.parse().ok()?;
    let clock = parse_clock(words.next()?)?;
    let offset = parse_offset(words.next()?.strip_prefix("GMT")?)?;
    valid_date(year, month, day).then(|| to_ms(year, month, day, clock, offset))
}

/// An event's stored start or end as Unix milliseconds, or `None` for text in
/// neither format this calendar writes.
pub fn parse_event_time_ms(text: &str) -> Option<i64> {
    let text = text.trim();
    parse_iso(text).or_else(|| parse_js_date(text))
}

/// `ms` as ISO 8601 UTC with milliseconds, the form a browser's
/// `new Date(…)` reads back.
pub fn format_iso_utc(ms: u64) -> String {
    let ms = ms as i64;
    let (year, month, day) = civil_from_days(ms.div_euclid(DAY_MS));
    let in_day = ms.rem_euclid(DAY_MS);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        in_day / 3_600_000,
        in_day / MINUTE_MS % 60,
        in_day / 1_000 % 60,
        in_day % 1_000
    )
}

/// The private event's color, title and description for a booking.
pub fn booking_event_text(
    link: &BookingLinkState,
    guest: &GuestDetails,
) -> (String, String, String) {
    let title = format!("{} with {}", link.title, guest.name.trim());
    let mut description = format!("Booked by {} <{}>", guest.name.trim(), guest.email.trim());
    if !guest.note.trim().is_empty() {
        description.push_str("\n\n");
        description.push_str(guest.note.trim());
    }
    (title, description, BOOKING_COLOR.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-07-06 is a Monday.
    const MONDAY_2026_07_06_UTC: i64 = 1_783_296_000_000;

    fn link(offset_minutes: i32) -> BookingLinkState {
        BookingLinkState {
            grant_id: String::new(),
            title: "Intro call".to_owned(),
            description: String::new(),
            duration_minutes: 30,
            weekly_hours: vec![WeeklyWindow {
                weekday: 0,
                start_minute: 9 * 60,
                end_minute: 11 * 60,
            }],
            utc_offset_minutes: offset_minutes,
            horizon_days: 30,
            min_notice_minutes: 0,
            created_at_ms: 0,
            expires_at_ms: None,
            status: LinkStatus::Open,
            booking: None,
        }
    }

    #[test]
    fn civil_dates_round_trip() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2026, 7, 6) * DAY_MS, MONDAY_2026_07_06_UTC);
        for days in [-1, 0, 59, 365, 10_957, 20_640, 30_000] {
            let (y, m, d) = civil_from_days(days);
            assert_eq!(days_from_civil(y, m, d), days);
        }
    }

    #[test]
    fn both_stored_time_formats_parse_to_the_same_instant() {
        let utc_nine = MONDAY_2026_07_06_UTC + 9 * 3_600_000;
        assert_eq!(parse_event_time_ms("2026-07-06T09:00:00"), Some(utc_nine));
        assert_eq!(
            parse_event_time_ms("2026-07-06T09:00:00.000Z"),
            Some(utc_nine)
        );
        assert_eq!(
            parse_event_time_ms("2026-07-06T11:00:00+02:00"),
            Some(utc_nine)
        );
        assert_eq!(
            parse_event_time_ms("Mon Jul 06 2026 11:00:00 GMT+0200 (Central European Summer Time)"),
            Some(utc_nine)
        );
        assert_eq!(
            parse_event_time_ms("Mon Jul 06 2026 05:00:00 GMT-0400 (Eastern Daylight Time)"),
            Some(utc_nine)
        );
        assert_eq!(parse_event_time_ms("next tuesday"), None);
        assert_eq!(parse_event_time_ms(""), None);
    }

    #[test]
    fn formatting_reads_back() {
        let at = MONDAY_2026_07_06_UTC + 9 * 3_600_000 + 30 * MINUTE_MS;
        assert_eq!(format_iso_utc(at as u64), "2026-07-06T09:30:00.000Z");
        assert_eq!(parse_event_time_ms(&format_iso_utc(at as u64)), Some(at));
    }

    #[test]
    fn slots_follow_the_weekly_window_at_the_owners_offset() {
        let now = MONDAY_2026_07_06_UTC - DAY_MS;
        let week = MONDAY_2026_07_06_UTC + 7 * DAY_MS;

        // UTC: 09:00-11:00 on Monday, four half-hour slots.
        let utc = available_slots(&link(0), &[], now, now, week);
        let nine = MONDAY_2026_07_06_UTC + 9 * 3_600_000;
        assert_eq!(
            utc,
            (0..4)
                .map(|i| (nine + i * 30 * MINUTE_MS) as u64)
                .collect::<Vec<_>>()
        );

        // UTC+2: the same wall-clock window is two hours earlier in UTC.
        let east = available_slots(&link(120), &[], now, now, week);
        assert_eq!(east.first().copied(), Some((nine - 2 * 3_600_000) as u64));
        assert_eq!(east.len(), 4);
    }

    #[test]
    fn busy_time_notice_and_horizon_remove_slots() {
        let nine = MONDAY_2026_07_06_UTC + 9 * 3_600_000;
        let now = MONDAY_2026_07_06_UTC - DAY_MS;
        let week = MONDAY_2026_07_06_UTC + 7 * DAY_MS;

        // A meeting 09:15-09:45 blocks both slots it overlaps.
        let busy = [(nine + 15 * MINUTE_MS, nine + 45 * MINUTE_MS)];
        let slots = available_slots(&link(0), &busy, now, now, week);
        assert_eq!(
            slots,
            vec![
                (nine + 60 * MINUTE_MS) as u64,
                (nine + 90 * MINUTE_MS) as u64
            ]
        );

        // Notice: from 09:40 on Monday, only slots starting after 10:10 remain.
        let mut notice = link(0);
        notice.min_notice_minutes = 30;
        let slots = available_slots(&notice, &[], nine + 40 * MINUTE_MS, nine - DAY_MS, week);
        assert_eq!(slots, vec![(nine + 90 * MINUTE_MS) as u64]);

        // Horizon: a one-day horizon from Sunday 00:00 ends at Monday 00:00,
        // before the window opens.
        let mut short = link(0);
        short.horizon_days = 1;
        assert!(available_slots(&short, &[], now, now, week).is_empty());
    }

    #[test]
    fn slots_are_offered_every_week_in_range() {
        let now = MONDAY_2026_07_06_UTC - DAY_MS;
        let slots = available_slots(&link(0), &[], now, now, now + 21 * DAY_MS);
        assert_eq!(slots.len(), 12);
    }

    #[test]
    fn link_validation_refuses_bad_windows() {
        let mut request = CreateBookingLink {
            token_hash: link_id_of("t"),
            grant_id: String::new(),
            title: "Call".to_owned(),
            description: String::new(),
            duration_minutes: 30,
            weekly_hours: vec![WeeklyWindow {
                weekday: 0,
                start_minute: 600,
                end_minute: 540,
            }],
            utc_offset_minutes: 0,
            horizon_days: 14,
            min_notice_minutes: 0,
            expires_at_ms: None,
        };
        assert!(validate_link(&request).is_err());
        request.weekly_hours[0].end_minute = 660;
        assert!(validate_link(&request).is_ok());
        request.token_hash = "not-a-hash".to_owned();
        assert!(validate_link(&request).is_err());
    }
}
