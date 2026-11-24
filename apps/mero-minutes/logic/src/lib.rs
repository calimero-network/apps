//! Minutes: meeting transcripts and the action items taken from them, on core's
//! component SDK (`calimero-sdk`).
//!
//! An app instance is one workspace of meetings; the organization it lives in
//! decides who reaches it, and everyone who reaches it reads every meeting in
//! it. The browser extension records a call (the meeting tab's audio and the
//! microphone), turns speech into text on the laptop, and sends the text here
//! in batches of segments. Audio never reaches the node.
//!
//! # Who may write what
//!
//! | what | who |
//! |---|---|
//! | start a meeting | any account that reaches the app |
//! | append, edit segments; rename, end, summarize a meeting | the meeting's recorder |
//! | delete a meeting | its recorder or the instance's owner |
//! | add an action item, tick it off, edit it | any account that reaches the app |
//! | remove an action item | its author, the meeting's recorder or the instance's owner |
//!
//! # Segments
//!
//! A segment is one stretch of speech: its offset into the meeting, who spoke
//! (`you` for the microphone, `others` for the meeting tab), and the text. The
//! extension numbers them from 0 and resends a batch it is not sure arrived, so
//! `appendSegments` keeps the first copy of a number and skips the rest.

use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};

/// Rows one storage read returns.
const ROWS: u32 = 1_000;

const MAX_TITLE: usize = 200;
const MAX_URL: usize = 2_000;
const MAX_PLATFORM: usize = 40;
const MAX_MODEL: usize = 100;
const MAX_LANGUAGE: usize = 16;
const MAX_SEGMENT_TEXT: usize = 4_000;
const MAX_SUMMARY: usize = 20_000;
const MAX_ACTION: usize = 500;
const MAX_ASSIGNEE: usize = 100;
/// Segments one `appendSegments` takes.
const MAX_BATCH: usize = 100;
/// Segments one meeting keeps: about eight hours of speech in 3 s stretches.
const MAX_SEGMENTS: u32 = 10_000;
/// Action items one meeting keeps.
const MAX_ACTIONS: u32 = 500;
/// Segments one `transcript` page returns at most.
const MAX_PAGE: u32 = 500;
/// Segments one `deleteMeeting` call removes; the client calls again while some remain.
const DELETE_BATCH: u32 = 1_000;

/// The speakers a segment may name.
pub const SPEAKERS: [&str; 2] = ["you", "others"];

// ── Arguments and stored values ──────────────────────────────────────────────

/// A meeting as it is stored.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingRow {
    pub title: String,
    /// `meet`, `zoom`, `teams` or `other`.
    pub platform: String,
    /// The call's address, as the extension saw it; may be empty.
    pub url: String,
    /// The speech model that wrote the transcript, e.g. `whisper-large-v3-turbo`.
    pub model: String,
    /// The spoken language, a BCP 47 tag such as `en`; empty when detected.
    pub language: String,
    pub recorder: String,
    pub started_at: u64,
    /// 0 while recording.
    pub ended_at: u64,
    /// The recording's length in ms, as the extension measured it.
    pub duration_ms: u32,
    pub summary: String,
    pub segments: u32,
    pub words: u32,
    /// The highest segment number appended plus one: where the next starts.
    pub next_seq: u32,
}

/// One stretch of speech, as the extension sends it.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SegmentInput {
    pub seq: u32,
    /// From the start of the recording, in ms.
    pub start_ms: u32,
    pub end_ms: u32,
    /// `you` or `others`.
    pub speaker: String,
    pub text: String,
}

/// A segment as it is stored.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentRow {
    pub start_ms: u32,
    pub end_ms: u32,
    pub speaker: String,
    pub text: String,
    /// Set when someone corrected the text after it was transcribed.
    pub edited: bool,
}

/// An action item as it is stored.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRow {
    pub meeting_id: String,
    pub text: String,
    /// Who should do it, as free text ("Ana", "design team"); may be empty.
    pub assignee: String,
    pub done: bool,
    /// The segment it was taken from, if any.
    pub source_seq: Option<u32>,
    pub created_by: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct MeetingView {
    pub id: String,
    pub title: String,
    pub platform: String,
    pub url: String,
    pub model: String,
    pub language: String,
    pub recorder: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub started_at: u64,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub ended_at: u64,
    pub duration_ms: u32,
    pub summary: String,
    pub segments: u32,
    pub words: u32,
    pub next_seq: u32,
    pub live: bool,
    pub open_actions: u32,
}

#[derive(Clone, Debug, Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct SegmentView {
    pub seq: u32,
    pub start_ms: u32,
    pub end_ms: u32,
    pub speaker: String,
    pub text: String,
    pub edited: bool,
}

#[derive(Clone, Debug, Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPage {
    pub segments: Vec<SegmentView>,
    /// The `fromSeq` of the next page, or `None` at the end.
    pub next: Option<u32>,
}

#[derive(Clone, Debug, Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct ActionView {
    pub id: String,
    pub meeting_id: String,
    pub text: String,
    pub assignee: String,
    pub done: bool,
    pub source_seq: Option<u32>,
    pub created_by: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct AppendResult {
    /// Segments stored by this call.
    pub added: u32,
    /// Segments skipped because their number was already stored.
    pub skipped: u32,
    pub next_seq: u32,
}

#[derive(Clone, Debug, Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    /// Segments still to remove; call `deleteMeeting` again until 0.
    pub remaining: u32,
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(version = 1)]
pub struct Minutes {
    /// Meetings by id.
    meetings: UnorderedMap<String, MeetingRow>,
    /// `(startedAt, meetingId)`: meetings in time order.
    by_time: Set<(u64, String)>,
    /// Segments by `(meetingId, seq)`.
    segments: UnorderedMap<(String, u32), SegmentRow>,
    /// Action items by id.
    actions: UnorderedMap<String, ActionRow>,
    /// `(meetingId, createdAt, actionId)`: a meeting's action items in order.
    meeting_actions: Set<(String, u64, String)>,
    /// `(meetingId, actionId)` of the items not yet done.
    open_actions: Set<(String, String)>,
    /// Meetings being deleted: hidden, their segments removed in batches.
    deleting: Set<String>,
}

#[app::error]
pub enum Error {
    /// An argument is out of shape.
    Invalid { message: String },
    /// No such meeting, segment or action item.
    NotFound { message: String },
    /// The caller may not do this.
    Forbidden { message: String },
    /// The state refuses it now: a meeting full, a recording ended.
    Refused { message: String },
}

/// Emitted after the write that caused it. Carries ids, never text.
#[app::event]
pub enum Event {
    /// A meeting was started, renamed, ended, summarized or deleted.
    MeetingChanged { id: String },
    /// Segments `from..to` were stored or edited.
    TranscriptChanged {
        meeting_id: String,
        from: u32,
        to: u32,
    },
    /// An action item was added, changed or removed.
    ActionChanged { id: String, meeting_id: String },
}

fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

fn not_found(message: impl Into<String>) -> AppError {
    Error::NotFound {
        message: message.into(),
    }
    .into()
}

fn forbidden(message: impl Into<String>) -> AppError {
    Error::Forbidden {
        message: message.into(),
    }
    .into()
}

fn refused(message: impl Into<String>) -> AppError {
    Error::Refused {
        message: message.into(),
    }
    .into()
}

/// The calling account. API keys act for their account; nobody else writes.
fn me() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) | Caller::Visitor { .. } => {
            Err(AppError::login_required())
        }
    }
}

/// `value` trimmed, at most `max` characters, not empty when `required`.
fn clean(field: &str, value: &str, max: usize, required: bool) -> app::Result<String> {
    let value = value.trim();
    if required && value.is_empty() {
        return Err(invalid(format!("{field} is required")));
    }
    if value.chars().count() > max {
        return Err(invalid(format!("{field} is longer than {max} characters")));
    }
    Ok(value.to_owned())
}

fn random_id() -> String {
    hex::encode(env::random_bytes(8))
}

fn word_count(text: &str) -> u32 {
    text.split_whitespace().count() as u32
}

fn clean_platform(platform: &str) -> app::Result<String> {
    let platform = clean("platform", platform, MAX_PLATFORM, false)?.to_lowercase();
    Ok(match platform.as_str() {
        "meet" | "zoom" | "teams" => platform,
        _ => "other".to_owned(),
    })
}

fn clean_url(url: &str) -> app::Result<String> {
    let url = clean("url", url, MAX_URL, false)?;
    if !url.is_empty() && !url.starts_with("https://") {
        return Err(invalid("url must start with https://"));
    }
    Ok(url)
}

fn segment_view(seq: u32, row: SegmentRow) -> SegmentView {
    SegmentView {
        seq,
        start_ms: row.start_ms,
        end_ms: row.end_ms,
        speaker: row.speaker,
        text: row.text,
        edited: row.edited,
    }
}

fn action_view(id: String, row: ActionRow) -> ActionView {
    ActionView {
        id,
        meeting_id: row.meeting_id,
        text: row.text,
        assignee: row.assignee,
        done: row.done,
        source_seq: row.source_seq,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

#[app::logic]
impl Minutes {
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    // ── Meetings ─────────────────────────────────────────────────────────────

    /// Starts recording a meeting and returns its id. The caller is its recorder.
    pub fn start_meeting(
        &mut self,
        title: String,
        platform: String,
        url: String,
        model: String,
        language: String,
    ) -> app::Result<String> {
        let recorder = me()?;
        let title = clean("title", &title, MAX_TITLE, true)?;
        let platform = clean_platform(&platform)?;
        let url = clean_url(&url)?;
        let model = clean("model", &model, MAX_MODEL, false)?;
        let language = clean("language", &language, MAX_LANGUAGE, false)?;
        let id = random_id();
        if self.meetings.contains(&id)? {
            return Err(refused("meeting id collision; start it again"));
        }
        let now = env::time_now();
        let row = MeetingRow {
            title,
            platform,
            url,
            model,
            language,
            recorder,
            started_at: now,
            ended_at: 0,
            duration_ms: 0,
            summary: String::new(),
            segments: 0,
            words: 0,
            next_seq: 0,
        };
        let _ = self.meetings.insert(&id, &row)?;
        let _ = self.by_time.insert(&(now, id.clone()))?;
        env::emit(Event::MeetingChanged { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Stores a batch of segments. Numbers already stored are skipped, so a
    /// batch can be resent safely. The recorder only.
    pub fn append_segments(
        &mut self,
        meeting_id: String,
        segments: Vec<SegmentInput>,
    ) -> app::Result<AppendResult> {
        let mut row = self.recorders(&meeting_id)?;
        if segments.len() > MAX_BATCH {
            return Err(invalid(format!(
                "send at most {MAX_BATCH} segments at a time"
            )));
        }
        let mut added = 0u32;
        let mut skipped = 0u32;
        let (mut low, mut high) = (u32::MAX, 0u32);
        for s in segments {
            if !SPEAKERS.contains(&s.speaker.as_str()) {
                return Err(invalid("speaker must be \"you\" or \"others\""));
            }
            if s.seq == u32::MAX {
                return Err(invalid("segment number out of range"));
            }
            if s.end_ms < s.start_ms {
                return Err(invalid("a segment cannot end before it starts"));
            }
            let body = clean("segment text", &s.text, MAX_SEGMENT_TEXT, false)?;
            let key = (meeting_id.clone(), s.seq);
            if body.is_empty() || self.segments.contains(&key)? {
                skipped += 1;
                continue;
            }
            if row.segments >= MAX_SEGMENTS {
                return Err(refused(format!(
                    "a meeting keeps at most {MAX_SEGMENTS} segments; start a new one"
                )));
            }
            row.words += word_count(&body);
            row.segments += 1;
            row.next_seq = row.next_seq.max(s.seq + 1);
            row.duration_ms = row.duration_ms.max(s.end_ms);
            low = low.min(s.seq);
            high = high.max(s.seq);
            let _ = self.segments.insert(
                &key,
                &SegmentRow {
                    start_ms: s.start_ms,
                    end_ms: s.end_ms,
                    speaker: s.speaker,
                    text: body,
                    edited: false,
                },
            )?;
            added += 1;
        }
        let next_seq = row.next_seq;
        if added > 0 {
            let _ = self.meetings.insert(&meeting_id, &row)?;
            env::emit(
                Event::TranscriptChanged {
                    meeting_id,
                    from: low,
                    to: high + 1,
                },
                Audience::All,
            )?;
        }
        Ok(AppendResult {
            added,
            skipped,
            next_seq,
        })
    }

    /// Corrects one segment's text. The recorder only.
    pub fn edit_segment(
        &mut self,
        meeting_id: String,
        seq: u32,
        text: String,
    ) -> app::Result<SegmentView> {
        let mut row = self.recorders(&meeting_id)?;
        let body = clean("segment text", &text, MAX_SEGMENT_TEXT, true)?;
        let key = (meeting_id.clone(), seq);
        let Some(mut segment) = self.segments.get(&key)? else {
            return Err(not_found("no such segment"));
        };
        row.words = row
            .words
            .saturating_sub(word_count(&segment.text))
            .saturating_add(word_count(&body));
        segment.text = body;
        segment.edited = true;
        let _ = self.segments.insert(&key, &segment)?;
        let _ = self.meetings.insert(&meeting_id, &row)?;
        env::emit(
            Event::TranscriptChanged {
                meeting_id,
                from: seq,
                to: seq + 1,
            },
            Audience::All,
        )?;
        Ok(segment_view(seq, segment))
    }

    /// Ends the recording. `durationMs` is the length the extension measured.
    /// Ending an ended meeting changes nothing. The recorder only.
    pub fn end_meeting(
        &mut self,
        meeting_id: String,
        duration_ms: u32,
    ) -> app::Result<MeetingView> {
        let mut row = self.recorders(&meeting_id)?;
        if row.ended_at == 0 {
            row.ended_at = env::time_now();
            row.duration_ms = row.duration_ms.max(duration_ms);
            let _ = self.meetings.insert(&meeting_id, &row)?;
            env::emit(
                Event::MeetingChanged {
                    id: meeting_id.clone(),
                },
                Audience::All,
            )?;
        }
        self.view_of(meeting_id, row)
    }

    /// Renames a meeting. The recorder only.
    pub fn rename_meeting(
        &mut self,
        meeting_id: String,
        title: String,
    ) -> app::Result<MeetingView> {
        let mut row = self.recorders(&meeting_id)?;
        row.title = clean("title", &title, MAX_TITLE, true)?;
        let _ = self.meetings.insert(&meeting_id, &row)?;
        env::emit(
            Event::MeetingChanged {
                id: meeting_id.clone(),
            },
            Audience::All,
        )?;
        self.view_of(meeting_id, row)
    }

    /// Replaces a meeting's summary (free text, may be empty). The recorder only.
    pub fn set_summary(&mut self, meeting_id: String, summary: String) -> app::Result<MeetingView> {
        let mut row = self.recorders(&meeting_id)?;
        row.summary = clean("summary", &summary, MAX_SUMMARY, false)?;
        let _ = self.meetings.insert(&meeting_id, &row)?;
        env::emit(
            Event::MeetingChanged {
                id: meeting_id.clone(),
            },
            Audience::All,
        )?;
        self.view_of(meeting_id, row)
    }

    /// Deletes a meeting, its action items and up to 1,000 of its segments,
    /// and returns how many segments remain. The meeting is gone from every
    /// list at once; call again until `remaining` is 0. Its recorder or the
    /// instance's owner.
    pub fn delete_meeting(&mut self, meeting_id: String) -> app::Result<DeleteResult> {
        let caller = me()?;
        if let Some(row) = self.meetings.get(&meeting_id)? {
            if row.recorder != caller && env::app_owner() != caller {
                return Err(forbidden(
                    "only the meeting's recorder or the workspace's owner may delete it",
                ));
            }
            let _ = self.meetings.remove(&meeting_id)?;
            let _ = self.by_time.remove(&(row.started_at, meeting_id.clone()))?;
            let actions = self.meeting_actions.prefix(
                &[KeyPart::Str(meeting_id.clone())],
                FindOpts::default().limit(ROWS),
            )?;
            for key in actions.items {
                let _ = self.actions.remove(&key.2)?;
                let _ = self
                    .open_actions
                    .remove(&(meeting_id.clone(), key.2.clone()))?;
                let _ = self.meeting_actions.remove(&key)?;
            }
            let _ = self.deleting.insert(&meeting_id)?;
            env::emit(
                Event::MeetingChanged {
                    id: meeting_id.clone(),
                },
                Audience::All,
            )?;
        } else if !self.deleting.contains(&meeting_id)? {
            return Err(not_found("no such meeting"));
        }
        let page = self.segments.prefix(
            &[KeyPart::Str(meeting_id.clone())],
            FindOpts::default().limit(DELETE_BATCH),
        )?;
        for (key, _) in page.items {
            let _ = self.segments.remove(&key)?;
        }
        let left = self
            .segments
            .prefix(
                &[KeyPart::Str(meeting_id.clone())],
                FindOpts::default().limit(ROWS),
            )?
            .items
            .len() as u32;
        if left == 0 {
            let _ = self.deleting.remove(&meeting_id)?;
        }
        Ok(DeleteResult { remaining: left })
    }

    /// One meeting.
    #[app::view]
    pub fn get_meeting(&self, meeting_id: String) -> app::Result<MeetingView> {
        let _ = me()?;
        let row = self.meeting(&meeting_id)?;
        self.view_of(meeting_id, row)
    }

    /// Every meeting, newest first.
    #[app::view]
    pub fn list_meetings(&self) -> app::Result<Vec<MeetingView>> {
        let _ = me()?;
        let page = self
            .by_time
            .page(FindOpts::default().limit(ROWS).reverse())?;
        let mut out = Vec::with_capacity(page.items.len());
        for (_, id) in page.items {
            if let Some(row) = self.meetings.get(&id)? {
                out.push(self.view_of(id, row)?);
            }
        }
        Ok(out)
    }

    /// Segments from number `fromSeq` on, in order, at most `limit` (1–500).
    #[app::view]
    pub fn transcript(
        &self,
        meeting_id: String,
        from_seq: u32,
        limit: u32,
    ) -> app::Result<TranscriptPage> {
        let _ = me()?;
        let _ = self.meeting(&meeting_id)?;
        let limit = limit.clamp(1, MAX_PAGE);
        let page = self.segments.prefix(
            &[KeyPart::Str(meeting_id)],
            FindOpts::default()
                .limit(limit + 1)
                .from(vec![KeyPart::Int(i128::from(from_seq))]),
        )?;
        let mut segments: Vec<SegmentView> = page
            .items
            .into_iter()
            .map(|((_, seq), row)| segment_view(seq, row))
            .collect();
        let next = if segments.len() > limit as usize {
            segments.pop().map(|s| s.seq)
        } else {
            None
        };
        Ok(TranscriptPage { segments, next })
    }

    /// The calling account.
    #[app::view]
    pub fn my_account(&self) -> app::Result<String> {
        me()
    }

    // ── Action items ─────────────────────────────────────────────────────────

    /// Adds an action item to a meeting and returns its id. Anyone who reaches the app.
    pub fn add_action(
        &mut self,
        meeting_id: String,
        text: String,
        assignee: String,
        source_seq: Option<u32>,
    ) -> app::Result<String> {
        let author = me()?;
        let _ = self.meeting(&meeting_id)?;
        let body = clean("action item", &text, MAX_ACTION, true)?;
        let assignee = clean("assignee", &assignee, MAX_ASSIGNEE, false)?;
        if let Some(seq) = source_seq {
            if !self.segments.contains(&(meeting_id.clone(), seq))? {
                return Err(not_found("no such segment"));
            }
        }
        let count = self
            .meeting_actions
            .prefix(
                &[KeyPart::Str(meeting_id.clone())],
                FindOpts::default().limit(ROWS),
            )?
            .items
            .len() as u32;
        if count >= MAX_ACTIONS {
            return Err(refused(format!(
                "a meeting keeps at most {MAX_ACTIONS} action items"
            )));
        }
        let id = random_id();
        if self.actions.contains(&id)? {
            return Err(refused("action id collision; add it again"));
        }
        let now = env::time_now();
        let row = ActionRow {
            meeting_id: meeting_id.clone(),
            text: body,
            assignee,
            done: false,
            source_seq,
            created_by: author,
            created_at: now,
            updated_at: now,
        };
        let _ = self.actions.insert(&id, &row)?;
        let _ = self
            .meeting_actions
            .insert(&(meeting_id.clone(), now, id.clone()))?;
        let _ = self
            .open_actions
            .insert(&(meeting_id.clone(), id.clone()))?;
        env::emit(
            Event::ActionChanged {
                id: id.clone(),
                meeting_id,
            },
            Audience::All,
        )?;
        Ok(id)
    }

    /// Ticks an action item off, or back on. Anyone who reaches the app.
    pub fn set_action_done(&mut self, action_id: String, done: bool) -> app::Result<ActionView> {
        let _ = me()?;
        let mut row = self.action(&action_id)?;
        if row.done != done {
            row.done = done;
            row.updated_at = env::time_now();
            let key = (row.meeting_id.clone(), action_id.clone());
            if done {
                let _ = self.open_actions.remove(&key)?;
            } else {
                let _ = self.open_actions.insert(&key)?;
            }
            self.save_action(&action_id, &row)?;
        }
        Ok(action_view(action_id, row))
    }

    /// Rewrites an action item and who it is for. Anyone who reaches the app.
    pub fn edit_action(
        &mut self,
        action_id: String,
        text: String,
        assignee: String,
    ) -> app::Result<ActionView> {
        let _ = me()?;
        let mut row = self.action(&action_id)?;
        row.text = clean("action item", &text, MAX_ACTION, true)?;
        row.assignee = clean("assignee", &assignee, MAX_ASSIGNEE, false)?;
        row.updated_at = env::time_now();
        self.save_action(&action_id, &row)?;
        Ok(action_view(action_id, row))
    }

    /// Removes an action item. Its author, the meeting's recorder or the
    /// instance's owner.
    pub fn remove_action(&mut self, action_id: String) -> app::Result<()> {
        let caller = me()?;
        let row = self.action(&action_id)?;
        let recorder = self
            .meetings
            .get(&row.meeting_id)?
            .map(|m| m.recorder)
            .unwrap_or_default();
        if row.created_by != caller && recorder != caller && env::app_owner() != caller {
            return Err(forbidden(
                "only its author, the meeting's recorder or the workspace's owner may remove it",
            ));
        }
        let _ = self.actions.remove(&action_id)?;
        let _ = self.meeting_actions.remove(&(
            row.meeting_id.clone(),
            row.created_at,
            action_id.clone(),
        ))?;
        let _ = self
            .open_actions
            .remove(&(row.meeting_id.clone(), action_id.clone()))?;
        env::emit(
            Event::ActionChanged {
                id: action_id,
                meeting_id: row.meeting_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// A meeting's action items, oldest first.
    #[app::view]
    pub fn list_actions(&self, meeting_id: String) -> app::Result<Vec<ActionView>> {
        let _ = me()?;
        let _ = self.meeting(&meeting_id)?;
        let page = self
            .meeting_actions
            .prefix(&[KeyPart::Str(meeting_id)], FindOpts::default().limit(ROWS))?;
        let mut out = Vec::with_capacity(page.items.len());
        for (_, _, id) in page.items {
            if let Some(row) = self.actions.get(&id)? {
                out.push(action_view(id, row));
            }
        }
        Ok(out)
    }

    /// Every action item not yet done, across meetings, newest meeting first.
    #[app::view]
    pub fn open_actions(&self) -> app::Result<Vec<ActionView>> {
        let _ = me()?;
        let page = self.open_actions.page(FindOpts::default().limit(ROWS))?;
        let mut out = Vec::with_capacity(page.items.len());
        for (_, id) in page.items {
            if let Some(row) = self.actions.get(&id)? {
                out.push(action_view(id, row));
            }
        }
        out.sort_by_key(|a| std::cmp::Reverse(a.created_at));
        Ok(out)
    }
}

impl Minutes {
    fn meeting(&self, id: &str) -> app::Result<MeetingRow> {
        self.meetings
            .get(&id.to_owned())?
            .ok_or_else(|| not_found("no such meeting"))
    }

    /// The meeting, if the caller recorded it.
    fn recorders(&self, id: &str) -> app::Result<MeetingRow> {
        let caller = me()?;
        let row = self.meeting(id)?;
        if row.recorder != caller {
            return Err(forbidden("only the meeting's recorder may change it"));
        }
        Ok(row)
    }

    fn action(&self, id: &str) -> app::Result<ActionRow> {
        self.actions
            .get(&id.to_owned())?
            .ok_or_else(|| not_found("no such action item"))
    }

    fn save_action(&mut self, id: &str, row: &ActionRow) -> app::Result<()> {
        let _ = self.actions.insert(&id.to_owned(), row)?;
        env::emit(
            Event::ActionChanged {
                id: id.to_owned(),
                meeting_id: row.meeting_id.clone(),
            },
            Audience::All,
        )?;
        Ok(())
    }

    fn view_of(&self, id: String, row: MeetingRow) -> app::Result<MeetingView> {
        let open = self
            .open_actions
            .prefix(&[KeyPart::Str(id.clone())], FindOpts::default().limit(ROWS))?
            .items
            .len() as u32;
        Ok(MeetingView {
            id,
            live: row.ended_at == 0,
            title: row.title,
            platform: row.platform,
            url: row.url,
            model: row.model,
            language: row.language,
            recorder: row.recorder,
            started_at: row.started_at,
            ended_at: row.ended_at,
            duration_ms: row.duration_ms,
            summary: row.summary,
            segments: row.segments,
            words: row.words,
            next_seq: row.next_seq,
            open_actions: open,
        })
    }
}
