//! Sylence: meeting transcripts and the action items taken from them, on core's
//! component SDK (`calimero-sdk`).
//!
//! An app instance is one workspace of meetings; the organization it lives in
//! decides who reaches it, and everyone who reaches it reads every meeting in
//! it. The browser extension records a call (the meeting tab's audio and the
//! microphone), turns speech into text on the laptop, and sends the text here
//! in batches of segments. Its audio can be kept too, the same way as an
//! uploaded recording's (`attachAudio`): a blob of the app, sealed with the
//! rest of the workspace.
//!
//! # Uploaded recordings
//!
//! A recording uploaded on the page (platform `upload`) is transcribed in the
//! browser like a call; its voices are told apart there and saved as
//! `others` lines named `Speaker 1`, `Speaker 2`, … The audio itself is one
//! of the app's blobs, and the meeting holds a [`BlobRef`] to it, which keeps
//! the blob for as long as the meeting names it. `setSpeakerName` gives a
//! label a real name for everyone; `setInsights` keeps what the page worked
//! out about each person (tone, emotions, profile, key points).
//!
//! # Who may write what
//!
//! | what | who |
//! |---|---|
//! | start a meeting | any account that reaches the app |
//! | append, edit segments; rename, end, summarize a meeting | the meeting's recorder |
//! | delete a meeting | its recorder or the instance's owner |
//! | attach or remove a meeting's audio | the meeting's recorder |
//! | name a speaker, save the people insights | the meeting's recorder or the instance's owner |
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
/// At most this many hits per search.
const MAX_HITS: u32 = 100;
/// Lines a search reads before it stops and says there may be more.
const SEARCH_SCAN: usize = 50_000;
/// Segments one `deleteMeeting` call removes; the client calls again while some remain.
const DELETE_BATCH: u32 = 1_000;
/// The largest audio blob a meeting may name: a node keeps blobs up to 47.25 MiB.
pub const MAX_AUDIO_BYTES: u64 = 49_545_216;
/// Recordings one account may keep across the workspace (each up to [`MAX_AUDIO_BYTES`]).
pub const MAX_RECORDINGS_PER_ACCOUNT: u32 = 100;
/// The longest recording a meeting may name: the page refuses uploads over 3 h.
const MAX_AUDIO_MS: u32 = 5 * 60 * 60 * 1_000;
/// The content types a recording may have: what browsers play in `<audio>`.
const AUDIO_TYPES: [&str; 12] = [
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/ogg",
    "audio/flac",
    "audio/opus",
    "video/mp4",
    "video/webm",
];
/// Speaker names one meeting keeps.
const MAX_ALIASES: usize = 50;
/// People one insights record describes.
const MAX_PEOPLE: usize = 50;
const MAX_TONE: usize = 40;
const MAX_PROFILE: usize = 1_000;
const MAX_KEY_POINTS: usize = 8;
const MAX_KEY_POINT: usize = 400;
const MAX_EMOTIONS: usize = 8;
const MAX_EMOTION: usize = 40;

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
    /// The transcript was redone after the call (`dropSegments` from 0).
    #[serde(default)]
    pub revised: bool,
    /// The recording, when one was uploaded with the meeting.
    #[serde(default)]
    pub audio: Option<Audio>,
    /// Names given to speaker labels ("Speaker 1" → "Eve").
    #[serde(default)]
    pub aliases: Vec<SpeakerName>,
    /// Everyone who spoke, in the order they first did: who an action item
    /// from this meeting can be given to. Rows written before it have none.
    #[serde(default)]
    pub speakers: Vec<Speaker>,
    /// Everyone in the call was told it is recorded (the extension posted the
    /// notice in the call's chat). Rows written before it say no.
    #[serde(default)]
    pub notified: bool,
}

/// One line's speaker name, as `nameSegments` sets it.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SegmentName {
    pub seq: u32,
    pub name: String,
}

/// Lines one `nameSegments` call may name.
pub const MAX_NAMED: usize = 500;

/// Someone who spoke in a meeting: `you` or `others`, and the name the call or
/// the upload gave them ("Eve", "Speaker 2"); empty when there was none.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct Speaker {
    pub speaker: String,
    pub name: String,
}

/// A meeting's recording: one of the app's blobs.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct Audio {
    /// The blob; in JSON its id, 64 lowercase hex digits.
    pub blob: BlobRef,
    /// The content type the browser plays it as, e.g. `audio/mpeg`.
    pub mime: String,
    /// Bytes, as the node recorded the upload.
    pub size: u32,
    /// The recording's length in ms, as the page decoded it.
    pub duration_ms: u32,
}

/// A name for a speaker label.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpeakerName {
    /// The label the lines carry: their `name`, or `you` / `others` when they have none.
    pub label: String,
    pub name: String,
}

/// One emotion's share of a person's lines, in thousandths.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmotionShare {
    pub label: String,
    pub share: u32,
}

/// What the page worked out about one person in the meeting.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonInsight {
    /// The speaker label, as in [`SpeakerName::label`].
    pub label: String,
    /// One word or two: `enthusiastic`, `neutral`, `concerned`, …
    pub tone: String,
    /// A sentence or two on how they came across.
    pub profile: String,
    /// The strongest emotions, largest first.
    pub emotions: Vec<EmotionShare>,
    /// What they said that mattered.
    pub key_points: Vec<String>,
}

/// The people insights, as the page sends them.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InsightsInput {
    /// The models that produced them, e.g. `go-emotions + qwen2.5-1.5b`.
    pub model: String,
    pub people: Vec<PersonInsight>,
}

/// The people insights as stored and read.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub model: String,
    pub people: Vec<PersonInsight>,
    pub updated_by: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub updated_at: u64,
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
    /// Who spoke, as the call page showed it ("Eve"); empty when unknown.
    #[serde(default)]
    pub name: String,
    pub text: String,
}

/// A segment as it is stored.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentRow {
    pub start_ms: u32,
    pub end_ms: u32,
    pub speaker: String,
    /// Rows written before speaker names have none.
    #[serde(default)]
    pub name: String,
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
    /// Who should do it, as free text ("Eve", "design team"); may be empty.
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
    /// The transcript was redone from the recording after the call.
    pub revised: bool,
    pub live: bool,
    pub open_actions: u32,
    /// The uploaded recording, if any.
    pub audio: Option<Audio>,
    pub speaker_names: Vec<SpeakerName>,
    /// Everyone who spoke, in the order they first did.
    pub speakers: Vec<Speaker>,
    /// The call was told it is recorded, in its own chat.
    pub notified: bool,
}

#[derive(Clone, Debug, Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct SegmentView {
    pub seq: u32,
    pub start_ms: u32,
    pub end_ms: u32,
    pub speaker: String,
    /// Who spoke, from the call page; empty when unknown.
    pub name: String,
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

/// A place where a search matched: a meeting's title (`seq` empty) or one of its lines.
#[derive(Clone, Debug, Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub meeting_id: String,
    pub title: String,
    pub platform: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub started_at: u64,
    /// The matching line, or `None` when the title matched.
    pub seq: Option<u32>,
    pub start_ms: Option<u32>,
    pub speaker: Option<String>,
    /// The line's speaker name, when the call page showed one.
    pub name: Option<String>,
    pub text: Option<String>,
}

#[derive(Clone, Debug, Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// The search stopped at its limit or its scan budget: there may be more.
    pub more: bool,
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

#[derive(Clone, Debug, Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct DropResult {
    pub removed: u32,
    /// Segments before `beforeSeq` still to remove; call again until 0.
    pub remaining: u32,
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(version = 1)]
pub struct Sylence {
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
    /// People insights by meeting id.
    insights: UnorderedMap<String, Insights>,
    /// `(recorder, meetingId)` of every meeting that keeps a recording.
    recorded: Set<(String, String)>,
    /// The meeting each recording blob belongs to: one blob, one meeting.
    audio_owner: UnorderedMap<String, String>,
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
    /// A meeting's people insights were saved or cleared.
    InsightsChanged { meeting_id: String },
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
        "meet" | "zoom" | "teams" | "upload" => platform,
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
        name: row.name,
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
impl Sylence {
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
            revised: false,
            audio: None,
            aliases: Vec::new(),
            speakers: Vec::new(),
            notified: false,
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
            let name = clean("speaker name", &s.name, MAX_ASSIGNEE, false)?;
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
            let who = Speaker {
                speaker: s.speaker.clone(),
                name: name.clone(),
            };
            if row.speakers.len() < MAX_ALIASES && !row.speakers.contains(&who) {
                row.speakers.push(who);
            }
            let _ = self.segments.insert(
                &key,
                &SegmentRow {
                    start_ms: s.start_ms,
                    end_ms: s.end_ms,
                    speaker: s.speaker,
                    name,
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

    /// Removes the segments numbered `fromSeq` up to (not including)
    /// `beforeSeq`, at most 1,000 a call. The extension appends a transcript
    /// redone after the call from `nextSeq` on, then drops the live one
    /// (`fromSeq` 0), which marks the meeting `revised`; if the upload fails
    /// halfway it drops what it sent instead. The recorder only.
    pub fn drop_segments(
        &mut self,
        meeting_id: String,
        from_seq: u32,
        before_seq: u32,
    ) -> app::Result<DropResult> {
        let mut row = self.recorders(&meeting_id)?;
        let range = || {
            FindOpts::default()
                .limit(DELETE_BATCH)
                .from(vec![KeyPart::Int(i128::from(from_seq))])
        };
        let page = self
            .segments
            .prefix(&[KeyPart::Str(meeting_id.clone())], range())?;
        let mut removed = 0u32;
        let (mut low, mut high) = (u32::MAX, 0u32);
        for ((_, seq), segment) in page.items {
            if seq >= before_seq {
                break;
            }
            let _ = self.segments.remove(&(meeting_id.clone(), seq))?;
            row.segments = row.segments.saturating_sub(1);
            row.words = row.words.saturating_sub(word_count(&segment.text));
            low = low.min(seq);
            high = high.max(seq);
            removed += 1;
        }
        let remaining = self
            .segments
            .prefix(&[KeyPart::Str(meeting_id.clone())], range())?
            .items
            .into_iter()
            .take_while(|((_, seq), _)| *seq < before_seq)
            .count() as u32;
        if from_seq == 0 && removed > 0 {
            row.revised = true;
            // Insights describe the transcript that was replaced.
            if self.insights.remove(&meeting_id)?.is_some() {
                env::emit(
                    Event::InsightsChanged {
                        meeting_id: meeting_id.clone(),
                    },
                    Audience::All,
                )?;
            }
        }
        let _ = self.meetings.insert(&meeting_id, &row)?;
        if removed > 0 {
            env::emit(
                Event::TranscriptChanged {
                    meeting_id,
                    from: low,
                    to: high + 1,
                },
                Audience::All,
            )?;
        }
        Ok(DropResult { removed, remaining })
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

    /// Notes that everyone in the call was told it is recorded: the extension
    /// posted the notice in the call's chat. The recorder only.
    pub fn mark_notified(&mut self, meeting_id: String) -> app::Result<MeetingView> {
        let mut row = self.recorders(&meeting_id)?;
        if !row.notified {
            row.notified = true;
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
            let _ = self.insights.remove(&meeting_id)?;
            let _ = self
                .recorded
                .remove(&(row.recorder.clone(), meeting_id.clone()))?;
            if let Some(audio) = &row.audio {
                let _ = self.audio_owner.remove(&audio.blob.id())?;
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

    // ── Audio, speaker names and insights ────────────────────────────────────

    /// Gives the meeting its recording: blob `blob`, which the caller uploaded
    /// to the app first. Replaces any earlier one (whose blob the node then
    /// collects). The recorder only.
    pub fn attach_audio(
        &mut self,
        meeting_id: String,
        blob: BlobRef,
        mime: String,
        duration_ms: u32,
    ) -> app::Result<MeetingView> {
        // Any meeting: an uploaded recording, or a call recorded by the extension.
        let mut row = self.recorders(&meeting_id)?;
        let mime = mime.trim().to_lowercase();
        if !AUDIO_TYPES.contains(&mime.as_str()) {
            return Err(invalid(format!(
                "mime must be one of {}",
                AUDIO_TYPES.join(", ")
            )));
        }
        if duration_ms == 0 || duration_ms > MAX_AUDIO_MS {
            return Err(invalid("durationMs must be between 1 ms and 5 hours"));
        }
        let Some(info) = blob.info() else {
            return Err(not_found("the app holds no such blob; upload it first"));
        };
        if info.size == 0 || info.size > MAX_AUDIO_BYTES {
            return Err(invalid(format!(
                "a recording is at most {MAX_AUDIO_BYTES} bytes"
            )));
        }
        // The type the node serves the blob as must be the one played.
        let stored = info
            .mime
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_lowercase();
        if stored != mime {
            return Err(invalid(format!(
                "the blob was uploaded as {stored:?}, not {mime:?}"
            )));
        }
        // A recording belongs to one meeting: removing it there must remove it.
        let blob_id = blob.id();
        if let Some(owner) = self.audio_owner.get(&blob_id)? {
            if owner != meeting_id {
                return Err(refused("that recording belongs to another meeting"));
            }
        }
        let key = (row.recorder.clone(), meeting_id.clone());
        if !self.recorded.contains(&key)? {
            if self.recordings_of(&row.recorder)? >= MAX_RECORDINGS_PER_ACCOUNT {
                return Err(refused(format!(
                    "an account keeps at most {MAX_RECORDINGS_PER_ACCOUNT} recordings; remove one first"
                )));
            }
            let _ = self.recorded.insert(&key)?;
        }
        if let Some(old) = &row.audio {
            let _ = self.audio_owner.remove(&old.blob.id())?;
        }
        let _ = self.audio_owner.insert(&blob_id, &meeting_id)?;
        row.audio = Some(Audio {
            blob,
            mime,
            size: info.size as u32,
            duration_ms,
        });
        row.duration_ms = row.duration_ms.max(duration_ms);
        let _ = self.meetings.insert(&meeting_id, &row)?;
        env::emit(
            Event::MeetingChanged {
                id: meeting_id.clone(),
            },
            Audience::All,
        )?;
        self.view_of(meeting_id, row)
    }

    /// Removes the meeting's recording; the transcript stays. The recorder only.
    pub fn remove_audio(&mut self, meeting_id: String) -> app::Result<MeetingView> {
        let mut row = self.recorders(&meeting_id)?;
        if let Some(old) = row.audio.take() {
            let _ = self.audio_owner.remove(&old.blob.id())?;
            let _ = self
                .recorded
                .remove(&(row.recorder.clone(), meeting_id.clone()))?;
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

    /// Names speaker `label` ("Speaker 1") as `name` ("Eve") in this meeting;
    /// an empty name removes it. The recorder or the instance's owner.
    pub fn set_speaker_name(
        &mut self,
        meeting_id: String,
        label: String,
        name: String,
    ) -> app::Result<MeetingView> {
        let mut row = self.editors(&meeting_id)?;
        let label = clean("label", &label, MAX_ASSIGNEE, true)?;
        let name = clean("name", &name, MAX_ASSIGNEE, false)?;
        row.aliases.retain(|a| a.label != label);
        if !name.is_empty() && name != label {
            if row.aliases.len() >= MAX_ALIASES {
                return Err(refused(format!(
                    "a meeting keeps at most {MAX_ALIASES} speaker names"
                )));
            }
            row.aliases.push(SpeakerName { label, name });
        }
        let _ = self.meetings.insert(&meeting_id, &row)?;
        env::emit(
            Event::MeetingChanged {
                id: meeting_id.clone(),
            },
            Audience::All,
        )?;
        self.view_of(meeting_id, row)
    }

    /// Names the speakers of lines already saved, as the page works them out
    /// from the recording ("Voice 1", "Voice 2" for a call whose page showed no
    /// names). At most 500 lines a call; a line that is not there, or already
    /// has that name, is skipped. Answers how many lines changed. The recorder
    /// or the instance's owner.
    pub fn name_segments(
        &mut self,
        meeting_id: String,
        names: Vec<SegmentName>,
    ) -> app::Result<u32> {
        let mut row = self.editors(&meeting_id)?;
        if names.len() > MAX_NAMED {
            return Err(invalid(format!("name at most {MAX_NAMED} lines at a time")));
        }
        let (mut low, mut high, mut changed) = (u32::MAX, 0u32, 0u32);
        for n in names {
            let name = clean("speaker name", &n.name, MAX_ASSIGNEE, false)?;
            let key = (meeting_id.clone(), n.seq);
            let Some(mut segment) = self.segments.get(&key)? else {
                continue;
            };
            if segment.name == name {
                continue;
            }
            segment.name = name.clone();
            let who = Speaker {
                speaker: segment.speaker.clone(),
                name,
            };
            let _ = self.segments.insert(&key, &segment)?;
            if row.speakers.len() < MAX_ALIASES && !row.speakers.contains(&who) {
                row.speakers.push(who);
            }
            changed += 1;
            low = low.min(n.seq);
            high = high.max(n.seq);
        }
        if changed > 0 {
            let _ = self.meetings.insert(&meeting_id, &row)?;
            env::emit(
                Event::TranscriptChanged {
                    meeting_id: meeting_id.clone(),
                    from: low,
                    to: high + 1,
                },
                Audience::All,
            )?;
            env::emit(Event::MeetingChanged { id: meeting_id }, Audience::All)?;
        }
        Ok(changed)
    }

    /// Saves what the page worked out about each person, replacing what was
    /// there. No people clears them. The recorder or the instance's owner.
    pub fn set_insights(
        &mut self,
        meeting_id: String,
        insights: InsightsInput,
    ) -> app::Result<Option<Insights>> {
        let caller = me()?;
        let _ = self.editors(&meeting_id)?;
        let model = clean("model", &insights.model, MAX_MODEL, false)?;
        if insights.people.len() > MAX_PEOPLE {
            return Err(invalid(format!("at most {MAX_PEOPLE} people")));
        }
        let mut people = Vec::with_capacity(insights.people.len());
        for p in insights.people {
            if p.key_points.len() > MAX_KEY_POINTS {
                return Err(invalid(format!(
                    "at most {MAX_KEY_POINTS} key points a person"
                )));
            }
            if p.emotions.len() > MAX_EMOTIONS {
                return Err(invalid(format!("at most {MAX_EMOTIONS} emotions a person")));
            }
            let mut emotions = Vec::with_capacity(p.emotions.len());
            for e in p.emotions {
                if e.share > 1_000 {
                    return Err(invalid(
                        "an emotion's share is in thousandths, at most 1000",
                    ));
                }
                emotions.push(EmotionShare {
                    label: clean("emotion", &e.label, MAX_EMOTION, true)?,
                    share: e.share,
                });
            }
            let mut key_points = Vec::with_capacity(p.key_points.len());
            for k in p.key_points {
                let k = clean("key point", &k, MAX_KEY_POINT, false)?;
                if !k.is_empty() {
                    key_points.push(k);
                }
            }
            people.push(PersonInsight {
                label: clean("label", &p.label, MAX_ASSIGNEE, true)?,
                tone: clean("tone", &p.tone, MAX_TONE, false)?,
                profile: clean("profile", &p.profile, MAX_PROFILE, false)?,
                emotions,
                key_points,
            });
        }
        let saved = if people.is_empty() {
            let _ = self.insights.remove(&meeting_id)?;
            None
        } else {
            let row = Insights {
                model,
                people,
                updated_by: caller,
                updated_at: env::time_now(),
            };
            let _ = self.insights.insert(&meeting_id, &row)?;
            Some(row)
        };
        env::emit(Event::InsightsChanged { meeting_id }, Audience::All)?;
        Ok(saved)
    }

    /// How many more recordings the caller may keep (see [`MAX_RECORDINGS_PER_ACCOUNT`]).
    #[app::view]
    pub fn recordings_left(&self) -> app::Result<u32> {
        let caller = me()?;
        Ok(MAX_RECORDINGS_PER_ACCOUNT.saturating_sub(self.recordings_of(&caller)?))
    }

    /// A meeting's people insights, if any were saved.
    #[app::view]
    pub fn insights(&self, meeting_id: String) -> app::Result<Option<Insights>> {
        let _ = me()?;
        let _ = self.meeting(&meeting_id)?;
        Ok(self.insights.get(&meeting_id)?)
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

    /// Meetings whose title, and lines whose text, contain every word of
    /// `query` (any case), newest meeting first and lines in order; at most
    /// `limit` hits (1–100).
    #[app::view]
    pub fn search(&self, query: String, limit: u32) -> app::Result<SearchResult> {
        let _ = me()?;
        let words: Vec<String> = query
            .to_lowercase()
            .split_whitespace()
            .map(str::to_owned)
            .collect();
        if words.is_empty() {
            return Ok(SearchResult {
                hits: Vec::new(),
                more: false,
            });
        }
        let limit = limit.clamp(1, MAX_HITS) as usize;
        let matches = |text: &str| {
            let text = text.to_lowercase();
            words.iter().all(|w| text.contains(w.as_str()))
        };
        let mut hits = Vec::new();
        let mut scanned = 0usize;
        let meetings = self
            .by_time
            .page(FindOpts::default().limit(ROWS).reverse())?;
        for (_, id) in meetings.items {
            let Some(row) = self.meetings.get(&id)? else {
                continue;
            };
            let hit = |seq: Option<u32>, line: Option<&SegmentRow>| SearchHit {
                meeting_id: id.clone(),
                title: row.title.clone(),
                platform: row.platform.clone(),
                started_at: row.started_at,
                seq,
                start_ms: line.map(|l| l.start_ms),
                speaker: line.map(|l| l.speaker.clone()),
                name: line.map(|l| l.name.clone()),
                text: line.map(|l| l.text.clone()),
            };
            if matches(&row.title) {
                hits.push(hit(None, None));
                if hits.len() >= limit {
                    return Ok(SearchResult { hits, more: true });
                }
            }
            let mut from = 0u32;
            loop {
                let page = self.segments.prefix(
                    &[KeyPart::Str(id.clone())],
                    FindOpts::default()
                        .limit(MAX_PAGE)
                        .from(vec![KeyPart::Int(i128::from(from))]),
                )?;
                let count = page.items.len();
                for ((_, seq), line) in page.items {
                    scanned += 1;
                    from = seq.saturating_add(1);
                    if matches(&line.text) {
                        hits.push(hit(Some(seq), Some(&line)));
                        if hits.len() >= limit {
                            return Ok(SearchResult { hits, more: true });
                        }
                    }
                    if scanned >= SEARCH_SCAN {
                        return Ok(SearchResult { hits, more: true });
                    }
                }
                if count < MAX_PAGE as usize || from == u32::MAX {
                    break;
                }
            }
        }
        Ok(SearchResult { hits, more: false })
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

impl Sylence {
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

    /// Recordings `account` keeps, counted up to the cap plus one.
    fn recordings_of(&self, account: &str) -> app::Result<u32> {
        Ok(self
            .recorded
            .prefix(
                &[KeyPart::Str(account.to_owned())],
                FindOpts::default().limit(MAX_RECORDINGS_PER_ACCOUNT + 1),
            )?
            .items
            .len() as u32)
    }

    /// The meeting, if the caller recorded it or owns the instance.
    fn editors(&self, id: &str) -> app::Result<MeetingRow> {
        let caller = me()?;
        let row = self.meeting(id)?;
        if row.recorder != caller && env::app_owner() != caller {
            return Err(forbidden(
                "only the meeting's recorder or the workspace's owner may change this",
            ));
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
            revised: row.revised,
            open_actions: open,
            audio: row.audio,
            speaker_names: row.aliases,
            speakers: row.speakers,
            notified: row.notified,
        })
    }
}
