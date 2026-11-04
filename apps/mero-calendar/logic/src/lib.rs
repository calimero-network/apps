//! Mero Calendar: shared team calendars, private events and booking links, on
//! core's component SDK (`calimero-sdk`).
//!
//! An app instance is one calendar; the organization it lives in (a team) decides
//! who reaches it. Every account that reaches it keeps its own calendar here:
//!
//! - **Shared events**: owned by the account that created them and shared with
//!   named peers. Only the owner edits or deletes one.
//! - **Private events**: an account's own entries, with nobody else in them.
//! - **Booking links**: a link a person with no account books one meeting
//!   through (see [`booking`]).
//! - **Members**: each account's display name, set by that account only.
//!
//! # Who may read and write what
//!
//! v1 held these rules in storage: an `Authored<IndexedMap>` every node checked
//! when it applied a peer's delta, `UserStorage` slots, and `#[app::private]`
//! storage that never left its node. A component app runs on its cluster's
//! leader, which applies every write in one log, so each rule is a check in the
//! method against `env::caller()`, before anything is written. Every owner field
//! is filled from the caller, never from an argument:
//!
//! | v1 | here |
//! |---|---|
//! | `events: Authored<IndexedMap<id, CalendarEventState>>`, indexes `owner`, `peers` | `events: Table<SharedEvent>` (key `id`, index `byOwner`); `eventPeers: UnorderedMap<id, Vec<account>>` (a record holds no list); `invitations: Set<(peer, id)>` (the `peers` index). `updateEvent`/`deleteEvent` refuse anyone but the owner (`Forbidden`) |
//! | `members: UserStorage<Member>` | `members: UnorderedMap<account, Member>`: `setUsername` writes only the caller's row (`PerUser` cannot list its rows, and `getMembers` lists them) |
//! | `#[app::private] PrivateCalendar { events }` | `privateEvents: UnorderedMap<(owner, id), PrivateEventState>`: every method reads and writes only `(caller, ..)` |
//! | `#[app::private] BookingLinks { links }` | `bookingLinks: UnorderedMap<(owner, linkId), BookingLinkState>`: the same |
//!
//! What this changes for privacy, said plainly: v1's private events and booking
//! data never left the owner's node. Here they are rows of the app's state on
//! the cluster, which every node of the cluster holds (sealed, in attested
//! nodes). No method answers another account's private rows, so no member can
//! read them through the app, as v1 promised; but they are no longer
//! node-local, and whoever may upgrade the app (the org's owner, or a holder of
//! `MANAGE_APPLICATION`) could install code that reads them. In exchange, a
//! shared event is now readable only by its owner and its peers: in v1 every
//! member's node held every shared event, and `get_events` was only a filter.

use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};

pub mod booking;

use booking::{BookingLinkState, BookingState, LinkStatus};
pub use booking::{
    BookingLinkView, BookingPage, BookingView, CreateBookingLink, GuestDetails, WeeklyWindow,
};

/// Rows one storage read returns: a page of a table or collection.
const ROWS: u32 = 1_000;
/// The most peers one event names.
pub const MAX_PEERS: usize = 100;
/// The longest account id a peer may be.
pub const MAX_ACCOUNT: usize = 256;
/// The longest display name.
pub const MAX_USERNAME: usize = 50;

// ── Stored records ───────────────────────────────────────────────────────────

/// One shared event. `owner` is the account that created it; no argument
/// names it. Its peers are beside it in `eventPeers` (a record holds no list).
#[derive(Record)]
#[table(key = "id", index(by_owner = ["owner", "id"]))]
pub struct SharedEvent {
    pub id: String,
    pub owner: String,
    pub title: String,
    pub description: String,
    pub start: String,
    pub end: String,
    pub event_type: String,
    pub color: String,
    pub created_at: u64,
    pub updated_at: u64,
}

/// One private event, stored under `(owner, id)`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PrivateEventState {
    pub title: String,
    pub description: String,
    pub start: String,
    pub end: String,
    pub event_type: String,
    pub color: String,
    pub created_at: u64,
    pub updated_at: u64,
}

/// A member's display name, stored under their account.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemberState {
    pub username: String,
    pub joined_at: u64,
    pub username_updated_at: u64,
}

// ── Requests and answers ─────────────────────────────────────────────────────
//
// v1's field names: `event_type` stays snake_case, as v1 sent it.

/// A calendar event as the frontend sees it. `private` tells a private entry
/// from a shared one so the UI can render them alike.
#[derive(Clone, Debug, Serialize)]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub description: String,
    pub owner: String,
    pub start: String,
    pub end: String,
    pub event_type: String,
    pub color: String,
    pub peers: Vec<String>,
    pub private: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateCalendarEvent {
    pub title: String,
    pub description: String,
    pub start: String,
    pub end: String,
    pub event_type: String,
    pub color: String,
    #[serde(default)]
    pub peers: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateCalendarEvent {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub start: Option<String>,
    #[serde(default)]
    pub end: Option<String>,
    #[serde(default)]
    pub event_type: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub peers: Option<Vec<String>>,
}

/// A member with a display name. `id` is the account.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub username: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub joined_at: u64,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub username_updated_at: u64,
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(version = 1)]
pub struct CalendarState {
    /// Shared events by id, looked up by owner.
    events: Table<SharedEvent>,
    /// Each shared event's peers, in the order its owner named them. A short
    /// list kept inside the value: at most `MAX_PEERS` (100) accounts, which
    /// `clean_peers` enforces on every write (`createEvent`, `updateEvent`,
    /// `updatePrivateEvent`). Who is invited to what is the `invitations` set.
    event_peers: UnorderedMap<String, Vec<String>>,
    /// `(peer, eventId)` for every peer of every shared event: what an
    /// account is invited to, read by prefix.
    invitations: Set<(String, String)>,
    /// Private events by `(owner, id)`.
    private_events: UnorderedMap<(String, String), PrivateEventState>,
    /// Booking links by `(owner, linkId)`; `linkId` is the token's SHA-256.
    booking_links: UnorderedMap<(String, String), BookingLinkState>,
    /// Display names by account.
    members: UnorderedMap<String, MemberState>,
}

#[app::error]
pub enum Error {
    /// No event (or booking link) `id` that the caller may see. For a booking
    /// link `id` is `"booking link"`, whether it never existed or was deleted.
    NotFound { id: String },
    /// The event is someone else's.
    Forbidden,
    /// An argument v1 refused with this message.
    Invalid { message: String },
    /// A booking link already exists for this token.
    LinkExists,
    /// The link already booked a meeting; reschedule it instead.
    AlreadyBooked,
    /// The link's meeting was cancelled; the link is spent.
    LinkCancelled,
    /// The link has passed its expiry.
    LinkExpired,
    /// The link has no booked meeting to reschedule or cancel.
    NotBooked,
    /// The link does not offer that time (now).
    SlotUnavailable,
}

/// A change other people's screens should pick up. A shared event's events go
/// to its owner and its peers (before and after the change); member events go
/// to everyone the app reaches.
#[app::event]
pub enum Event {
    CalendarEventCreated { id: String },
    CalendarEventEdited { id: String },
    CalendarEventDeleted { id: String },
    MemberJoined { account: String },
    MemberUsernameUpdated { account: String },
}

fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

/// The account the caller acts for: an account, or an API key acting for one
/// (a booking guest). Anyone else is `LoginRequired`.
fn caller() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// Peers as named, de-duplicated, order kept; each a plausible account id.
fn clean_peers(peers: Vec<String>) -> app::Result<Vec<String>> {
    let mut out: Vec<String> = Vec::with_capacity(peers.len());
    for peer in peers {
        let peer = peer.trim().to_owned();
        if peer.is_empty() || peer.len() > MAX_ACCOUNT {
            return Err(invalid(format!(
                "a peer must be an account id of 1 to {MAX_ACCOUNT} bytes"
            )));
        }
        if !out.contains(&peer) {
            out.push(peer);
        }
    }
    if out.len() > MAX_PEERS {
        return Err(invalid(format!(
            "an event can name at most {MAX_PEERS} peers"
        )));
    }
    Ok(out)
}

/// The owner and both peer lists, once each: who hears about a change.
fn audience(owner: &str, before: &[String], after: &[String]) -> Audience {
    let mut accounts = vec![owner.to_owned()];
    for peer in before.iter().chain(after) {
        if !accounts.contains(peer) {
            accounts.push(peer.clone());
        }
    }
    Audience::Accounts(accounts)
}

#[app::logic]
impl CalendarState {
    /// The empty calendar. The node runs it once, when the app is created.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    // ── Members ──────────────────────────────────────────────────────────────

    /// Register or refresh the caller's display name. Idempotent: the first
    /// call joins (`MemberJoined`), later calls rename (`MemberUsernameUpdated`).
    /// A member can only ever name themselves.
    pub fn set_username(&mut self, username: String) -> app::Result<()> {
        let account = caller()?;
        let username = username.trim().to_owned();
        if username.is_empty() {
            return Err(invalid("username cannot be empty"));
        }
        if username.chars().count() > MAX_USERNAME {
            return Err(invalid(format!(
                "username cannot be longer than {MAX_USERNAME} characters"
            )));
        }
        let now = env::time_now();
        let event = match self.members.get(&account)? {
            Some(mut existing) => {
                existing.username = username;
                existing.username_updated_at = now;
                let _old = self.members.insert(&account, &existing)?;
                Event::MemberUsernameUpdated {
                    account: account.clone(),
                }
            }
            None => {
                let member = MemberState {
                    username,
                    joined_at: now,
                    username_updated_at: now,
                };
                let _old = self.members.insert(&account, &member)?;
                Event::MemberJoined {
                    account: account.clone(),
                }
            }
        };
        env::emit(event, Audience::All)?;
        Ok(())
    }

    /// Every member who set a name, in account order (at most 1,000).
    #[app::view]
    pub fn get_members(&self) -> app::Result<Vec<Member>> {
        let _ = caller()?;
        let page = self.members.page(FindOpts::default().limit(ROWS))?;
        Ok(page
            .items
            .into_iter()
            .map(|(id, m)| Member {
                id,
                username: m.username,
                joined_at: m.joined_at,
                username_updated_at: m.username_updated_at,
            })
            .collect())
    }

    // ── Shared events ────────────────────────────────────────────────────────

    /// The shared events the caller owns or is invited to, in id order (at
    /// most 1,000 of each). Nobody else's: this is the access rule now, not
    /// only a filter.
    #[app::view]
    pub fn get_events(&self) -> app::Result<Vec<CalendarEvent>> {
        let me = caller()?;
        self.events_of(&me)
    }

    /// Create an event, routed BY WHETHER ANYONE ELSE IS IN IT: with no peers
    /// it is the caller's private event (`createPrivateEvent`), with peers a
    /// shared one. The contract decides, not the client. Answers the id.
    pub fn create_event(&mut self, event_data: CreateCalendarEvent) -> app::Result<String> {
        let owner = caller()?;
        let peers = clean_peers(event_data.peers.clone())?;
        if peers.is_empty() {
            env::log("no peers: keeping this event private");
            return self.create_private_event(event_data);
        }
        let id = env::unique_id();
        let now = env::time_now();
        self.events.insert(SharedEvent {
            id: id.clone(),
            owner: owner.clone(),
            title: event_data.title,
            description: event_data.description,
            start: event_data.start,
            end: event_data.end,
            event_type: event_data.event_type,
            color: event_data.color,
            created_at: now,
            updated_at: now,
        })?;
        self.set_peers(&id, &[], &peers)?;
        env::emit(
            Event::CalendarEventCreated { id: id.clone() },
            audience(&owner, &[], &peers),
        )?;
        Ok(id)
    }

    /// Update a shared event; only its owner may (`Forbidden` for anyone else,
    /// `NotFound` when there is none). Emptying `peers` does NOT make it
    /// private again: sharing is one-way, as in v1. Removed peers no longer
    /// see it. Answers the id.
    pub fn update_event(
        &mut self,
        event_id: String,
        event_data: UpdateCalendarEvent,
    ) -> app::Result<String> {
        let owner = caller()?;
        self.require_owner(&event_id, &owner)?;
        let before = self.event_peers.get(&event_id)?.unwrap_or_default();
        let after = match event_data.peers.clone() {
            Some(peers) => clean_peers(peers)?,
            None => before.clone(),
        };
        let now = env::time_now();
        let _ = self.events.update(&event_id, |event| {
            if let Some(v) = event_data.title {
                event.title = v;
            }
            if let Some(v) = event_data.description {
                event.description = v;
            }
            if let Some(v) = event_data.start {
                event.start = v;
            }
            if let Some(v) = event_data.end {
                event.end = v;
            }
            if let Some(v) = event_data.event_type {
                event.event_type = v;
            }
            if let Some(v) = event_data.color {
                event.color = v;
            }
            event.updated_at = now;
        })?;
        if after != before {
            self.set_peers(&event_id, &before, &after)?;
        }
        env::emit(
            Event::CalendarEventEdited {
                id: event_id.clone(),
            },
            audience(&owner, &before, &after),
        )?;
        Ok(event_id)
    }

    /// Delete a shared event; only its owner may. Answers the id.
    pub fn delete_event(&mut self, event_id: String) -> app::Result<String> {
        let owner = caller()?;
        self.require_owner(&event_id, &owner)?;
        let before = self.event_peers.get(&event_id)?.unwrap_or_default();
        let _ = self.events.remove(&event_id)?;
        self.set_peers(&event_id, &before, &[])?;
        let _ = self.event_peers.remove(&event_id)?;
        env::emit(
            Event::CalendarEventDeleted {
                id: event_id.clone(),
            },
            audience(&owner, &before, &[]),
        )?;
        Ok(event_id)
    }

    // ── Private events ───────────────────────────────────────────────────────

    /// A private event of the caller's; `peers` on the request is ignored.
    /// No event is emitted: nobody else is in it. Answers the id.
    pub fn create_private_event(&mut self, event_data: CreateCalendarEvent) -> app::Result<String> {
        let owner = caller()?;
        let id = env::unique_id();
        let now = env::time_now();
        let event = PrivateEventState {
            title: event_data.title,
            description: event_data.description,
            start: event_data.start,
            end: event_data.end,
            event_type: event_data.event_type,
            color: event_data.color,
            created_at: now,
            updated_at: now,
        };
        let _ = self.private_events.insert(&(owner, id.clone()), &event)?;
        Ok(id)
    }

    /// The caller's private events, in id order (at most 1,000).
    #[app::view]
    pub fn get_private_events(&self) -> app::Result<Vec<CalendarEvent>> {
        let owner = caller()?;
        self.private_of(&owner)
    }

    /// Update one of the caller's private events, and PROMOTE it to a shared
    /// event (same id) when the update names its first peers. Answers the id.
    pub fn update_private_event(
        &mut self,
        event_id: String,
        event_data: UpdateCalendarEvent,
    ) -> app::Result<String> {
        let owner = caller()?;
        let key = (owner.clone(), event_id.clone());
        let Some(mut event) = self.private_events.get(&key)? else {
            return Err(Error::NotFound { id: event_id }.into());
        };
        let peers = clean_peers(event_data.peers.clone().unwrap_or_default())?;
        let now = env::time_now();
        if let Some(v) = event_data.title {
            event.title = v;
        }
        if let Some(v) = event_data.description {
            event.description = v;
        }
        if let Some(v) = event_data.start {
            event.start = v;
        }
        if let Some(v) = event_data.end {
            event.end = v;
        }
        if let Some(v) = event_data.event_type {
            event.event_type = v;
        }
        if let Some(v) = event_data.color {
            event.color = v;
        }
        event.updated_at = now;

        if peers.is_empty() {
            let _ = self.private_events.insert(&key, &event)?;
            return Ok(event_id);
        }

        // Promote: out of the private rows, into the shared table, same id,
        // so the frontend's handle on it stays valid.
        let _ = self.private_events.remove(&key)?;
        self.events.insert(SharedEvent {
            id: event_id.clone(),
            owner: owner.clone(),
            title: event.title,
            description: event.description,
            start: event.start,
            end: event.end,
            event_type: event.event_type,
            color: event.color,
            created_at: event.created_at,
            updated_at: now,
        })?;
        self.set_peers(&event_id, &[], &peers)?;
        env::log("promoted a private event to a shared one");
        env::emit(
            Event::CalendarEventCreated {
                id: event_id.clone(),
            },
            audience(&owner, &[], &peers),
        )?;
        Ok(event_id)
    }

    /// Delete one of the caller's private events. Answers the id.
    pub fn delete_private_event(&mut self, event_id: String) -> app::Result<String> {
        let owner = caller()?;
        if self
            .private_events
            .remove(&(owner, event_id.clone()))?
            .is_none()
        {
            return Err(Error::NotFound { id: event_id }.into());
        }
        Ok(event_id)
    }

    // ── Booking links (owner) ────────────────────────────────────────────────

    /// A booking link for the API key whose SHA-256 is `link.tokenHash`. The
    /// owner's client created the key first; the key itself never reaches the
    /// contract from the owner.
    pub fn create_booking_link(&mut self, link: CreateBookingLink) -> app::Result<BookingLinkView> {
        let owner = caller()?;
        booking::validate_link(&link).map_err(invalid)?;
        let key = (owner, link.token_hash.clone());
        if self.booking_links.contains(&key)? {
            return Err(Error::LinkExists.into());
        }
        let state = BookingLinkState {
            grant_id: link.grant_id,
            title: link.title.trim().to_owned(),
            description: link.description,
            duration_minutes: link.duration_minutes,
            weekly_hours: link.weekly_hours,
            utc_offset_minutes: link.utc_offset_minutes,
            horizon_days: link.horizon_days,
            min_notice_minutes: link.min_notice_minutes,
            created_at_ms: env::time_now(),
            expires_at_ms: link.expires_at_ms,
            status: LinkStatus::Open,
            booking: None,
        };
        let view = state.owner_view(link.token_hash);
        let _ = self.booking_links.insert(&key, &state)?;
        Ok(view)
    }

    /// The caller's booking links, newest first (at most 1,000).
    #[app::view]
    pub fn list_booking_links(&self) -> app::Result<Vec<BookingLinkView>> {
        let owner = caller()?;
        let page = self
            .booking_links
            .prefix(&[KeyPart::Str(owner)], FindOpts::default().limit(ROWS))?;
        let mut views: Vec<BookingLinkView> = page
            .items
            .into_iter()
            .map(|((_, id), link)| link.owner_view(id))
            .collect();
        views.sort_by_key(|view| core::cmp::Reverse(view.created_at_ms));
        Ok(views)
    }

    /// Delete one of the caller's links. A meeting it booked stays in the
    /// calendar. The client revokes the link's API key too. Answers the id.
    pub fn delete_booking_link(&mut self, link_id: String) -> app::Result<String> {
        let owner = caller()?;
        if self
            .booking_links
            .remove(&(owner, link_id.clone()))?
            .is_none()
        {
            return Err(Error::NotFound { id: link_id }.into());
        }
        Ok(link_id)
    }

    // ── Booking links (guest, by token) ──────────────────────────────────────

    /// What the link behind `token` offers, and its booking if it has one.
    #[app::view]
    pub fn get_booking_page(&self, token: String) -> app::Result<BookingPage> {
        let owner = caller()?;
        let (_, link) = self.link_for(&owner, &token)?;
        let owner_name = self.members.get(&owner)?.map(|m| m.username);
        Ok(link.guest_page(owner_name))
    }

    /// The start times, in Unix milliseconds (decimal strings), the link behind
    /// `token` offers in `[fromMs, toMs)`.
    ///
    /// The window is clamped, never refused: it starts no earlier than now and
    /// spans at most `MAX_SLOT_RANGE_DAYS`. A view's clock is the time of the
    /// app's last write, so "now" here can lag; pass your own now as `fromMs`.
    /// `bookSlot` checks the slot again at the time of booking.
    #[app::view]
    pub fn get_available_slots(
        &self,
        token: String,
        from_ms: u64,
        to_ms: u64,
    ) -> app::Result<Vec<String>> {
        let owner = caller()?;
        let (_, link) = self.link_for(&owner, &token)?;
        let now = env::time_now();
        Self::require_live(&link, now)?;
        if link.status == LinkStatus::Cancelled {
            return Ok(Vec::new());
        }
        let (from, to) = Self::slot_range(from_ms, to_ms, now);
        let busy = self.busy_intervals(&owner, None)?;
        Ok(booking::available_slots(&link, &busy, now as i64, from, to)
            .into_iter()
            .map(|ms| ms.to_string())
            .collect())
    }

    /// Book the slot starting at `startMs`. A link books once: after this it
    /// can only reschedule or cancel. The meeting goes into the owner's
    /// calendar as a private event.
    pub fn book_slot(
        &mut self,
        token: String,
        start_ms: u64,
        guest: GuestDetails,
    ) -> app::Result<BookingView> {
        let owner = caller()?;
        booking::validate_guest(&guest).map_err(invalid)?;
        let (key, mut link) = self.link_for(&owner, &token)?;
        let now = env::time_now();
        Self::require_live(&link, now)?;
        match link.status {
            LinkStatus::Open => {}
            LinkStatus::Booked => return Err(Error::AlreadyBooked.into()),
            LinkStatus::Cancelled => return Err(Error::LinkCancelled.into()),
        }
        self.require_offered(&owner, &link, start_ms, now, None)?;

        let end_ms = start_ms + u64::from(link.duration_minutes) * 60_000;
        let (title, description, color) = booking::booking_event_text(&link, &guest);
        let event_id = self.create_private_event(CreateCalendarEvent {
            title,
            description,
            start: booking::format_iso_utc(start_ms),
            end: booking::format_iso_utc(end_ms),
            event_type: "event".to_owned(),
            color,
            peers: Vec::new(),
        })?;
        let state = BookingState {
            event_id,
            start_ms,
            end_ms,
            guest_name: guest.name.trim().to_owned(),
            guest_email: guest.email.trim().to_owned(),
            guest_note: guest.note.trim().to_owned(),
            booked_at_ms: now,
            rescheduled_count: 0,
        };
        let view = state.view();
        link.status = LinkStatus::Booked;
        link.booking = Some(state);
        let _ = self.booking_links.insert(&key, &link)?;
        env::log("a booking link booked a meeting");
        Ok(view)
    }

    /// Move the link's meeting to the slot starting at `startMs`.
    pub fn reschedule_booking(&mut self, token: String, start_ms: u64) -> app::Result<BookingView> {
        let owner = caller()?;
        let (key, mut link) = self.link_for(&owner, &token)?;
        let now = env::time_now();
        Self::require_live(&link, now)?;
        let Some(mut state) = link
            .booking
            .clone()
            .filter(|_| link.status == LinkStatus::Booked)
        else {
            return Err(Error::NotBooked.into());
        };
        self.require_offered(&owner, &link, start_ms, now, Some(&state.event_id))?;

        state.start_ms = start_ms;
        state.end_ms = start_ms + u64::from(link.duration_minutes) * 60_000;
        state.rescheduled_count += 1;
        // The owner may have deleted the meeting by hand; the booking still moves.
        let event_key = (owner, state.event_id.clone());
        if let Some(mut event) = self.private_events.get(&event_key)? {
            event.start = booking::format_iso_utc(state.start_ms);
            event.end = booking::format_iso_utc(state.end_ms);
            event.updated_at = now;
            let _ = self.private_events.insert(&event_key, &event)?;
        }
        let view = state.view();
        link.booking = Some(state);
        let _ = self.booking_links.insert(&key, &link)?;
        Ok(view)
    }

    /// Cancel the link's meeting. The link is spent afterwards.
    pub fn cancel_booking(&mut self, token: String) -> app::Result<()> {
        let owner = caller()?;
        let (key, mut link) = self.link_for(&owner, &token)?;
        let Some(state) = link
            .booking
            .as_ref()
            .filter(|_| link.status == LinkStatus::Booked)
        else {
            return Err(Error::NotBooked.into());
        };
        // The owner may already have deleted the event by hand; the
        // cancellation still stands.
        let _ = self
            .private_events
            .remove(&(owner, state.event_id.clone()))?;
        link.status = LinkStatus::Cancelled;
        let _ = self.booking_links.insert(&key, &link)?;
        Ok(())
    }
}

// ── Helpers (not methods) ────────────────────────────────────────────────────

impl CalendarState {
    /// `NotFound` when there is no shared event `id`, `Forbidden` when it is
    /// someone else's.
    fn require_owner(&self, id: &str, caller: &str) -> app::Result<()> {
        match self.events.get(id)? {
            None => Err(Error::NotFound { id: id.to_owned() }.into()),
            Some(event) if event.owner != caller => Err(Error::Forbidden.into()),
            Some(_) => Ok(()),
        }
    }

    /// Replace an event's peers: the ordered list and the invitation rows.
    fn set_peers(&mut self, id: &str, before: &[String], after: &[String]) -> app::Result<()> {
        for peer in before {
            if !after.contains(peer) {
                let _ = self.invitations.remove(&(peer.clone(), id.to_owned()))?;
            }
        }
        for peer in after {
            let _ = self.invitations.insert(&(peer.clone(), id.to_owned()))?;
        }
        let _ = self.event_peers.insert(&id.to_owned(), &after.to_vec())?;
        Ok(())
    }

    fn shared_view(&self, event: SharedEvent) -> app::Result<CalendarEvent> {
        let peers = self.event_peers.get(&event.id)?.unwrap_or_default();
        Ok(CalendarEvent {
            id: event.id,
            title: event.title,
            description: event.description,
            owner: event.owner,
            start: event.start,
            end: event.end,
            event_type: event.event_type,
            color: event.color,
            peers,
            private: false,
        })
    }

    /// The shared events `account` owns or is invited to, by id.
    fn events_of(&self, account: &str) -> app::Result<Vec<CalendarEvent>> {
        let mut found = std::collections::BTreeMap::new();
        let owned = self.events.find(
            "byOwner",
            &[KeyPart::Str(account.to_owned())],
            FindOpts::default().limit(ROWS),
        )?;
        for event in owned.items {
            let _ = found.insert(event.id.clone(), event);
        }
        let invited = self.invitations.prefix(
            &[KeyPart::Str(account.to_owned())],
            FindOpts::default().limit(ROWS),
        )?;
        for (_, id) in invited.items {
            if found.contains_key(&id) {
                continue;
            }
            if let Some(event) = self.events.get(&id)? {
                let _ = found.insert(id, event);
            }
        }
        found.into_values().map(|e| self.shared_view(e)).collect()
    }

    fn private_of(&self, owner: &str) -> app::Result<Vec<CalendarEvent>> {
        let page = self.private_events.prefix(
            &[KeyPart::Str(owner.to_owned())],
            FindOpts::default().limit(ROWS),
        )?;
        Ok(page
            .items
            .into_iter()
            .map(|((owner, id), event)| CalendarEvent {
                id,
                title: event.title,
                description: event.description,
                owner,
                start: event.start,
                end: event.end,
                event_type: event.event_type,
                color: event.color,
                peers: Vec::new(),
                private: true,
            })
            .collect())
    }

    /// `owner`'s link that `token` opens, with its key. One answer whether it
    /// never existed or was deleted, so a guess learns nothing.
    fn link_for(
        &self,
        owner: &str,
        token: &str,
    ) -> app::Result<((String, String), BookingLinkState)> {
        let key = (owner.to_owned(), booking::link_id_of(token));
        match self.booking_links.get(&key)? {
            Some(link) => Ok((key, link)),
            None => Err(Error::NotFound {
                id: "booking link".to_owned(),
            }
            .into()),
        }
    }

    fn require_live(link: &BookingLinkState, now_ms: u64) -> app::Result<()> {
        if link.expired(now_ms) {
            return Err(Error::LinkExpired.into());
        }
        Ok(())
    }

    /// `[from_ms, to_ms)` clamped to start no earlier than `now_ms` and to span
    /// at most `MAX_SLOT_RANGE_DAYS`. An empty window offers nothing.
    fn slot_range(from_ms: u64, to_ms: u64, now_ms: u64) -> (i64, i64) {
        let clamp = |ms: u64| i64::try_from(ms).unwrap_or(i64::MAX);
        let from = clamp(from_ms).max(clamp(now_ms));
        let to =
            clamp(to_ms).min(from.saturating_add(booking::MAX_SLOT_RANGE_DAYS * booking::DAY_MS));
        (from, to)
    }

    /// `SlotUnavailable` unless the link offers `start_ms` right now.
    /// `own_event` is the meeting being moved, which must not block its own
    /// new slot.
    fn require_offered(
        &self,
        owner: &str,
        link: &BookingLinkState,
        start_ms: u64,
        now_ms: u64,
        own_event: Option<&str>,
    ) -> app::Result<()> {
        let Ok(start) = i64::try_from(start_ms) else {
            return Err(invalid("time out of range"));
        };
        let busy = self.busy_intervals(owner, own_event)?;
        let offered = booking::available_slots(
            link,
            &busy,
            now_ms as i64,
            start - booking::DAY_MS,
            start + booking::DAY_MS,
        );
        if offered.binary_search(&start_ms).is_err() {
            return Err(Error::SlotUnavailable.into());
        }
        Ok(())
    }

    /// Everything on `owner`'s calendar, as busy intervals: their private
    /// events and the shared events they own or are invited to. An event whose
    /// stored times this contract cannot read blocks nothing.
    fn busy_intervals(
        &self,
        owner: &str,
        except_event: Option<&str>,
    ) -> app::Result<Vec<booking::Busy>> {
        let mut events = self.events_of(owner)?;
        events.extend(self.private_of(owner)?);
        Ok(events
            .into_iter()
            .filter(|event| Some(event.id.as_str()) != except_event)
            .filter_map(|event| {
                let start = booking::parse_event_time_ms(&event.start)?;
                let end = booking::parse_event_time_ms(&event.end)?;
                (start < end).then_some((start, end))
            })
            .collect())
    }
}
