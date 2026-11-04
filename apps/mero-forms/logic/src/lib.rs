//! Mero Forms: forms a team designs, the responses they collect, and a hand-off
//! of any response to Mero CRM, on core's component SDK (`calimero-sdk`).
//!
//! An app instance is one workspace of forms; the organization it lives in
//! decides who reaches it. Inside, the contract keeps its own **team**: the
//! admins (the instance's owner to start with) and the accounts they add. Only
//! the team builds forms and reads responses. Reaching the instance (being in
//! its org) is not being on the team, as joining v1's namespace was not.
//!
//! Responses come in three ways:
//!
//! - **A teammate** (or any account that reaches the app) calls
//!   `submitResponse`.
//! - **A website's form key**: a core API key of an admin's account, limited to
//!   this app and to `submitResponse` and `getForm`, registered here under its
//!   key id (`registerFormKey`). Inside the contract its caller is
//!   `Caller::ApiKey { id, .. }`, so a registered key answers only its one form
//!   and never counts as the admin it acts for.
//! - **A public link**: a core API key of a teammate's account, limited to
//!   this app and to `linkForm` and `submitViaLink`, recorded under the SHA-256
//!   of its token (`createLink`). A link's key opens only its own link.
//!
//! # Who may write what
//!
//! v1 held these rules in storage: `SharedStorage` writer sets every node
//! checked when it applied a peer's delta, and an `AccessControl` for the
//! admins and the `team` role. A component app runs on its cluster's leader,
//! which applies every write in one log, so each rule is a check in the method
//! against `env::caller()`, before anything is written:
//!
//! | v1 | here |
//! |---|---|
//! | `responses: UnorderedMap<id, LwwRegister<Response>>`, insert-only by contract | `responses: UnorderedMap<id, Response>`, insert-only (nothing else writes it); `formResponses: Set<(form, createdAt, id)>` lists a form's newest first |
//! | `forms: SharedStorage<UnorderedMap<id, Form>>` (each part a register) | `forms: UnorderedMap<id, FormRow>`; the team only |
//! | `triage: SharedStorage<UnorderedMap<id, ResponseState>>` | `triage: UnorderedMap<id, ResponseState>`; the team only |
//! | `settings: SharedStorage<UnorderedMap<key, LwwRegister<String>>>` | `settings: UnorderedMap<key, String>`; the team only |
//! | `form_keys: SharedStorage<UnorderedMap<account, FormKey>>` | `formKeys: UnorderedMap<apiKeyId, FormKey>`; the admins only |
//! | `links: SharedStorage<UnorderedMap<sha256(token), Link>>` | `links: UnorderedMap<sha256(token), LinkRow>`, `formLinks: Set<(form, link)>`, `linkKeys: UnorderedMap<apiKeyId, link>`; the team only |
//! | `captcha_seen: SharedStorage<UnorderedMap<nonce, expiry>>` | `captchaSeen: UnorderedMap<nonce, expiry>` + `captchaExpiry: Set<(expiry, nonce)>` to drop spent passes |
//! | `roles: AccessControl` (admins + `team` role) | `admins: Set<account>`, `team: Set<account>` |
//! | counts by scanning every response | stored counts, kept with each write: `formStats`, `linkStats`, `senderStats` |
//!
//! # Captchas
//!
//! A form's `captchaKey` says how a link's response proves its visitor solved
//! Cloudflare Turnstile: empty for no captcha, or an ed25519 public key (hex)
//! whose signature over [`captcha_message`] a pass must carry. The verifier
//! outside the node (`app/api/captcha.ts`) asks Cloudflare and signs; the
//! contract checks the signature itself and spends the pass's nonce once.
//!
//! v1's `turnstile` key had the contract ask Cloudflare through the node
//! (`env::http_request`), with the team's secret sealed to the namespace's TEE
//! (`env::seal_outbound_secret`). The component SDK at `1.0.0-rc.7` has neither
//! outbound HTTP nor sealed secrets, so `setCaptchaKey(form, "turnstile")` and
//! `setCaptchaSecret` are refused (`Unsupported`), and `captchaSettings` says no
//! TEE can keep a secret. The verifier's pass is the captcha until core ships
//! them.
//!
//! # Answers
//!
//! A form's fields are typed, and every response is checked against its form:
//! required, the right shape for its kind, one of the options for a choice. A
//! response stores an answer for every field the form had when it was sent,
//! with that field's label at the time, so it still reads correctly after the
//! form is edited.

use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};

/// Rows one storage read returns: a page of a collection.
const ROWS: u32 = 1_000;

/// The kinds of field a form can ask for.
pub const FIELD_KINDS: [&str; 9] = [
    "text",
    "paragraph",
    "email",
    "phone",
    "number",
    "url",
    "date",
    "choice",
    "checkboxes",
];

/// Form limits.
const MAX_TITLE: usize = 200;
const MAX_DESCRIPTION: usize = 2_000;
const MAX_FIELDS: usize = 50;
const MAX_FIELD_ID: usize = 40;
const MAX_LABEL: usize = 200;
const MAX_HELP: usize = 500;
const MAX_OPTIONS: usize = 50;
const MAX_OPTION: usize = 200;
const MAX_FORMS: u64 = 200;

/// Answer limits, in characters, by kind.
const MAX_TEXT: usize = 500;
const MAX_PARAGRAPH: usize = 10_000;
const MAX_EMAIL: usize = 254;
const MAX_PHONE: usize = 40;
const MAX_NUMBER: usize = 40;
const MAX_URL: usize = 2_000;
const MAX_SOURCE: usize = 300;
const MAX_KEY_LABEL: usize = 100;
const MAX_ID: usize = 100;
/// The longest account (or API key) id the team or the key register holds.
const MAX_ACCOUNT: usize = 256;

/// Public links.
const LINK_ID_HEX: usize = 64;
const MAX_GRANT_ID: usize = 128;
const DEFAULT_LINK_CAP: u32 = 30;
const MAX_LINK_CAP: u32 = 10_000;
/// One hour, in milliseconds: the link cap's window.
const HOUR_MS: u64 = 3_600 * 1_000;
/// The longest a captcha pass may be valid for, from when it is spent.
const MAX_PASS_MS: u64 = 10 * 60 * 1_000;
const PASS_NONCE_HEX: usize = 32;
/// Spent passes dropped per accepted one, so the list never needs a scan.
const PRUNE_PER_PASS: u32 = 50;
/// v1's `captchaKey` for a token the node checks with Cloudflare. Not
/// supported here (see the crate docs, "Captchas").
pub const NODE_VERIFIES_TURNSTILE: &str = "turnstile";

/// The `settings` key the workspace's display name is kept under.
const WORKSPACE_NAME: &str = "name";
/// `settings` rows v1 kept for the team's own Turnstile widget. Never written
/// here; `clearCaptchaSecret` still removes them.
const CAPTCHA_ROWS: [&str; 3] = ["captcha_site_key", "captcha_secret", "captcha_sealed_to"];

// ── Arguments and stored values ──────────────────────────────────────────────

/// One field of a form.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Field {
    /// Stable, chosen when the field is added: what a website's backend sends
    /// the answer under, e.g. `email`. Lowercase letters, digits, `_` and `-`.
    pub id: String,
    /// One of [`FIELD_KINDS`].
    pub kind: String,
    pub label: String,
    /// A line under the label, or empty.
    #[serde(default)]
    pub help: String,
    #[serde(default)]
    pub required: bool,
    /// The choices, for `choice` and `checkboxes`; empty for the rest.
    #[serde(default)]
    pub options: Vec<String>,
}

/// Where a form's responses go in Mero CRM, and which field fills what.
/// Empty strings mean "not set".
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CrmLink {
    /// The Mero CRM app instance (pipeline) the deals go to. Empty: no CRM.
    #[serde(default)]
    pub context_id: String,
    /// The stage a new deal starts in.
    #[serde(default)]
    pub stage_id: String,
    /// Field ids whose answers fill the contact and the deal.
    #[serde(default)]
    pub name_field: String,
    #[serde(default)]
    pub email_field: String,
    #[serde(default)]
    pub phone_field: String,
    #[serde(default)]
    pub organization_field: String,
    /// The answer that titles the deal; empty uses the contact's name.
    #[serde(default)]
    pub title_field: String,
}

/// One answer as a website's backend or the app sends it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnswerInput {
    pub field_id: String,
    /// One value for most kinds; any number of the options for `checkboxes`.
    #[serde(default)]
    pub values: Vec<String>,
}

/// One stored answer: the field as it was when the response was sent.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub field_id: String,
    pub label: String,
    pub kind: String,
    /// Empty when an optional field was left blank.
    pub values: Vec<String>,
}

/// A captcha pass: the verifier's signature over
/// `mero-forms/captcha/v1|<form>|<link>|<nonce>|<expiresMs>`. The nonce is the
/// visitor's, random, and each one is accepted once.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptchaPass {
    pub nonce: String,
    /// Milliseconds since the Unix epoch, as a decimal string.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub expires_ms: u64,
    /// 64 bytes, hex.
    pub signature: String,
}

/// What a respondent sent, exactly. Inserted once, never edited. At most
/// `MAX_FIELDS` answers, one per field of the form.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Response {
    pub form_id: String,
    pub answers: Vec<Answer>,
    /// Where it was sent from, e.g. `/contact/`, or empty.
    pub source: String,
    /// When the leader accepted it, in milliseconds since the Unix epoch.
    pub created_at: u64,
    /// Who sent it: the account, or a form key's id.
    pub submitted_by: String,
    /// The public link it came through, or empty.
    pub link: String,
}

/// A form. The field list is a short list kept inside the value: at most
/// `MAX_FIELDS` fields of at most `MAX_OPTIONS` options each, enforced by
/// `clean_fields` on every write.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FormRow {
    pub title: String,
    pub description: String,
    pub fields: Vec<Field>,
    /// A closed form refuses new responses.
    pub open: bool,
    pub crm: CrmLink,
    /// Whether its public links take responses.
    pub public: bool,
    /// Responses each public link may send per clock hour.
    pub link_cap: u32,
    /// Empty for no captcha, or the verifier's ed25519 public key (hex).
    pub captcha_key: String,
    pub created_at: u64,
    pub created_by: String,
    pub updated_at: u64,
}

/// A public link, as the team made it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LinkRow {
    pub form_id: String,
    pub label: String,
    /// The API key behind it, of `created_by`'s account.
    pub grant_id: String,
    pub created_at: u64,
    pub created_by: String,
}

/// The team's state for one response.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ResponseState {
    pub archived: bool,
    pub crm_context: String,
    pub crm_deal: String,
    pub crm_sent_at: u64,
    pub crm_sent_by: String,
}

/// A website form's key, as the admins registered it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FormKey {
    pub label: String,
    /// The one form it may submit to.
    pub form_id: String,
    pub created_at: u64,
    pub created_by: String,
}

/// A form's response counts, kept with every write that changes them.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct FormStats {
    pub responses: u32,
    /// Not archived and not yet sent to the CRM.
    pub new_responses: u32,
    pub last_response_at: u64,
}

/// What one link or sender has sent.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SendStats {
    pub responses: u32,
    pub last_response_at: u64,
    /// The clock hour (`time / HOUR_MS`) `hour_count` counts.
    pub hour: u64,
    pub hour_count: u32,
}

// ── Answers ──────────────────────────────────────────────────────────────────

/// A form in full.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub fields: Vec<Field>,
    pub open: bool,
    pub crm: CrmLink,
    pub public: bool,
    pub link_cap: u32,
    pub captcha_key: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    pub created_by: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub updated_at: u64,
}

/// A form as a public link's visitor sees it: the questions, and nothing the
/// team keeps about it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkFormView {
    pub form_id: String,
    pub title: String,
    pub description: String,
    pub fields: Vec<Field>,
    /// Open and public: a response would be taken.
    pub accepting: bool,
    /// Whether a response needs a captcha.
    pub captcha: bool,
    /// v1: the node checks the Turnstile token itself. Always false here.
    pub captcha_by_node: bool,
    /// v1: the team's own Turnstile site key. Always empty here.
    pub captcha_site_key: String,
}

/// The team's own Turnstile setup, as the settings page shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptchaSettings {
    pub site_key: String,
    pub secret_set: bool,
    /// Whether a TEE could keep a secret: never, on this runtime.
    pub tee_available: bool,
    pub needs_resealing: bool,
}

/// A public link, with what it has sent.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkView {
    pub id: String,
    pub form_id: String,
    pub label: String,
    pub grant_id: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    pub created_by: String,
    pub responses: u32,
    /// Responses in the current clock hour, what the cap counts.
    pub last_hour: u32,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub last_response_at: u64,
}

/// A form in the list, with what it has collected.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormSummary {
    pub id: String,
    pub title: String,
    pub description: String,
    pub open: bool,
    pub fields: u32,
    pub responses: u32,
    pub new_responses: u32,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub last_response_at: u64,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
}

/// A response as the team sees it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseView {
    pub id: String,
    pub form_id: String,
    pub answers: Vec<Answer>,
    pub source: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    pub submitted_by: String,
    pub link: String,
    pub archived: bool,
    pub crm_context: String,
    pub crm_deal: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub crm_sent_at: u64,
    pub crm_sent_by: String,
}

/// A registered form key, with what it has sent.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormKeyView {
    /// The API key's id.
    pub account: String,
    pub label: String,
    pub form_id: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    pub created_by: String,
    pub responses: u32,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub last_response_at: u64,
}

/// One entry of the team.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    pub account: String,
    pub admin: bool,
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(version = 1)]
pub struct MeroForms {
    /// Forms by id (at most `MAX_FORMS`).
    forms: UnorderedMap<String, FormRow>,
    /// Response counts by form id.
    form_stats: UnorderedMap<String, FormStats>,
    /// Responses by id: inserted once, never written again.
    responses: UnorderedMap<String, Response>,
    /// `(formId, createdAt, responseId)`: a form's responses in time order.
    form_responses: Set<(String, u64, String)>,
    /// The team's state for a response, by response id.
    triage: UnorderedMap<String, ResponseState>,
    /// The workspace's name (and v1's captcha rows, never written here).
    settings: UnorderedMap<String, String>,
    /// Website form keys by API key id.
    form_keys: UnorderedMap<String, FormKey>,
    /// What each sender (account or form key) has sent.
    sender_stats: UnorderedMap<String, SendStats>,
    /// Public links by the SHA-256 (hex) of their API key.
    links: UnorderedMap<String, LinkRow>,
    /// `(formId, linkId)`: a form's links.
    form_links: Set<(String, String)>,
    /// A link's id by its API key's id, so a link's key is never the team.
    link_keys: UnorderedMap<String, String>,
    /// What each link has sent.
    link_stats: UnorderedMap<String, SendStats>,
    /// Captcha passes already spent, by nonce, until they expire (ms).
    captcha_seen: UnorderedMap<String, u64>,
    /// `(expiresMs, nonce)`: spent passes in expiry order, to drop old ones.
    captcha_expiry: Set<(u64, String)>,
    /// The admins: the instance's owner, from `init`.
    admins: Set<String>,
    /// The rest of the team, added by an admin.
    team: Set<String>,
}

/// Every refusal carries v1's message, so the app shows what it showed before.
#[app::error]
pub enum Error {
    /// An argument v1 refused with this message.
    Invalid { message: String },
    /// No such form, response or link.
    NotFound { message: String },
    /// The caller may not do this: "only the team may do this".
    Forbidden { message: String },
    /// The state refuses it now: a closed form, a paused link, the hourly cap,
    /// a captcha, a response already sent.
    Refused { message: String },
    /// v1 did this with a host feature the component SDK lacks.
    Unsupported { message: String },
}

/// Emitted after the write that caused it. Carries ids, never answers.
#[app::event]
pub enum Event {
    /// A response was submitted.
    Submitted { id: String, form_id: String },
    /// A teammate created or changed a form.
    FormChanged { id: String },
    /// A teammate changed a response's state.
    ResponseChanged { id: String },
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

fn unsupported(message: impl Into<String>) -> AppError {
    Error::Unsupported {
        message: message.into(),
    }
    .into()
}

/// Who called: an account, or an API key acting for one.
#[derive(Clone, Debug)]
enum Who {
    Account(String),
    Key { id: String, account: String },
}

impl Who {
    fn account(&self) -> &str {
        match self {
            Who::Account(a) | Who::Key { account: a, .. } => a,
        }
    }
}

fn who() -> app::Result<Who> {
    match env::caller() {
        Caller::Account(account) => Ok(Who::Account(account)),
        Caller::ApiKey { key_id, account } => Ok(Who::Key {
            id: key_id,
            account,
        }),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

fn check(what: &str, value: &str, max: usize, required: bool) -> app::Result<()> {
    if required && value.trim().is_empty() {
        return Err(invalid(format!("{what} is required")));
    }
    if value.chars().count() > max {
        return Err(invalid(format!(
            "{what} is too long (at most {max} characters)"
        )));
    }
    Ok(())
}

/// A deliberately loose shape check: one `@`, something before it, a dot in
/// the domain, and no whitespace. Delivery is the real test.
pub fn looks_like_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !email.chars().any(char::is_whitespace)
}

/// Digits, with an optional leading `-` and one `.` between digits.
pub fn looks_like_number(value: &str) -> bool {
    let digits = value.strip_prefix('-').unwrap_or(value);
    let mut parts = digits.splitn(2, '.');
    let whole = parts.next().unwrap_or("");
    let frac = parts.next();
    let all_digits = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    all_digits(whole) && frac.is_none_or(all_digits)
}

/// Digits and the usual punctuation, with at least four digits.
pub fn looks_like_phone(value: &str) -> bool {
    value
        .chars()
        .all(|c| c.is_ascii_digit() || " +-().".contains(c))
        && value.chars().filter(char::is_ascii_digit).count() >= 4
}

/// An `http(s)://` address with something after the scheme and no whitespace.
pub fn looks_like_url(value: &str) -> bool {
    let rest = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"));
    rest.is_some_and(|r| !r.is_empty()) && !value.chars().any(char::is_whitespace)
}

/// `YYYY-MM-DD` with a month 1–12 and a day the month can have.
pub fn looks_like_date(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let num = |s: &str| s.parse::<u32>().ok();
    let (Some(y), Some(m), Some(d)) = (num(&value[0..4]), num(&value[5..7]), num(&value[8..10]))
    else {
        return false;
    };
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&d)
}

/// A field id: 1–40 of lowercase ASCII letters, digits, `_` and `-`,
/// starting with a letter.
pub fn is_field_id(id: &str) -> bool {
    id.len() <= MAX_FIELD_ID
        && id.chars().next().is_some_and(|c| c.is_ascii_lowercase())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// The fields as a form may hold them: trimmed, unique ids, known kinds,
/// options only where they mean something.
fn clean_fields(fields: Vec<Field>) -> app::Result<Vec<Field>> {
    if fields.len() > MAX_FIELDS {
        return Err(invalid(format!("a form has at most {MAX_FIELDS} fields")));
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::with_capacity(fields.len());
    for field in fields {
        let id = field.id.trim().to_owned();
        if !is_field_id(&id) {
            return Err(invalid(format!(
                "field id {id:?} must be lowercase letters, digits, _ or -, starting with a letter"
            )));
        }
        if !seen.insert(id.clone()) {
            return Err(invalid(format!("two fields have the id {id:?}")));
        }
        let kind = field.kind.trim().to_owned();
        if !FIELD_KINDS.contains(&kind.as_str()) {
            return Err(invalid(format!(
                "field {id:?} has an unknown kind {kind:?}; one of {}",
                FIELD_KINDS.join(", ")
            )));
        }
        let label = field.label.trim().to_owned();
        check("a field's label", &label, MAX_LABEL, true)?;
        let help = field.help.trim().to_owned();
        check("a field's help", &help, MAX_HELP, false)?;
        let takes_options = kind == "choice" || kind == "checkboxes";
        let mut options = Vec::new();
        if takes_options {
            let mut seen_options = std::collections::BTreeSet::new();
            for option in field.options {
                let option = option.trim().to_owned();
                check("an option", &option, MAX_OPTION, true)?;
                if seen_options.insert(option.clone()) {
                    options.push(option);
                }
            }
            if options.is_empty() {
                return Err(invalid(format!(
                    "field {label:?} needs at least one option"
                )));
            }
            if options.len() > MAX_OPTIONS {
                return Err(invalid(format!(
                    "field {label:?} has more than {MAX_OPTIONS} options"
                )));
            }
        }
        out.push(Field {
            id,
            kind,
            label,
            help,
            required: field.required,
            options,
        });
    }
    Ok(out)
}

/// The answer a field holds once checked: trimmed, the right shape, and
/// present if the field is required.
fn check_answer(field: &Field, values: Vec<String>) -> app::Result<Vec<String>> {
    let values: Vec<String> = values
        .into_iter()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
        .collect();
    let label = &field.label;
    if values.is_empty() {
        if field.required {
            return Err(invalid(format!("{label} is required")));
        }
        return Ok(values);
    }
    if field.kind == "checkboxes" {
        let mut seen = std::collections::BTreeSet::new();
        let mut out = Vec::new();
        for v in values {
            if !field.options.contains(&v) {
                return Err(invalid(format!(
                    "{v:?} is not one of the options for {label}"
                )));
            }
            if seen.insert(v.clone()) {
                out.push(v);
            }
        }
        // In the form's order, whatever order they were ticked in.
        out.sort_by_key(|v| field.options.iter().position(|o| o == v));
        return Ok(out);
    }
    if values.len() > 1 {
        return Err(invalid(format!("{label} takes one answer")));
    }
    let v = &values[0];
    let (max, ok) = match field.kind.as_str() {
        "text" => (MAX_TEXT, true),
        "paragraph" => (MAX_PARAGRAPH, true),
        "email" => (MAX_EMAIL, looks_like_email(v)),
        "phone" => (MAX_PHONE, looks_like_phone(v)),
        "number" => (MAX_NUMBER, looks_like_number(v)),
        "url" => (MAX_URL, looks_like_url(v)),
        "date" => (10, looks_like_date(v)),
        "choice" => (MAX_OPTION, field.options.contains(v)),
        _ => (0, false),
    };
    check(label, v, max, false)?;
    if !ok {
        let what = match field.kind.as_str() {
            "email" => "an email address",
            "phone" => "a phone number",
            "number" => "a number",
            "url" => "a web address starting with https://",
            "date" => "a date as YYYY-MM-DD",
            "choice" => "one of the options",
            _ => "a valid answer",
        };
        return Err(invalid(format!("{label} must be {what}")));
    }
    Ok(values)
}

/// An account (or API key) id as the app sends it: trimmed, 1–256 bytes.
fn clean_account(field: &str, value: &str) -> app::Result<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_ACCOUNT {
        return Err(invalid(format!("{field} is not an account id")));
    }
    Ok(value.to_owned())
}

/// `bytes` random bytes from the host (seeded per logged run), as hex.
fn random_id(bytes: usize) -> String {
    hex::encode(env::random_bytes(bytes))
}

/// What a captcha pass signs. The verifier builds the same string.
pub fn captcha_message(form_id: &str, link: &str, nonce: &str, expires_ms: u64) -> String {
    format!("mero-forms/captcha/v1|{form_id}|{link}|{nonce}|{expires_ms}")
}

fn decode_fixed<const N: usize>(value: &str) -> Option<[u8; N]> {
    hex::decode(value).ok()?.try_into().ok()
}

fn verify_signature(signature: &[u8; 64], public_key: &[u8; 32], message: &[u8]) -> bool {
    let Ok(key) = ed25519_dalek::VerifyingKey::from_bytes(public_key) else {
        return false;
    };
    let signature = ed25519_dalek::Signature::from_bytes(signature);
    key.verify_strict(message, &signature).is_ok()
}

fn form_view(id: String, form: &FormRow) -> FormView {
    FormView {
        id,
        title: form.title.clone(),
        description: form.description.clone(),
        fields: form.fields.clone(),
        open: form.open,
        crm: form.crm.clone(),
        public: form.public,
        link_cap: form.link_cap,
        captcha_key: form.captcha_key.clone(),
        created_at: form.created_at,
        created_by: form.created_by.clone(),
        updated_at: form.updated_at,
    }
}

fn response_view(id: String, r: Response, s: Option<ResponseState>) -> ResponseView {
    let s = s.unwrap_or_default();
    ResponseView {
        id,
        form_id: r.form_id,
        answers: r.answers,
        source: r.source,
        created_at: r.created_at,
        submitted_by: r.submitted_by,
        link: r.link,
        archived: s.archived,
        crm_context: s.crm_context,
        crm_deal: s.crm_deal,
        crm_sent_at: s.crm_sent_at,
        crm_sent_by: s.crm_sent_by,
    }
}

/// A response the team still has to look at: not archived, not in the CRM.
fn is_new(s: &ResponseState) -> bool {
    !s.archived && s.crm_deal.is_empty()
}

impl SendStats {
    /// Responses in the clock hour `now` falls in.
    fn in_hour(&self, now: u64) -> u32 {
        if self.hour == now / HOUR_MS {
            self.hour_count
        } else {
            0
        }
    }

    fn count(&mut self, at: u64) {
        self.responses = self.responses.saturating_add(1);
        self.last_response_at = self.last_response_at.max(at);
        let hour = at / HOUR_MS;
        if self.hour == hour {
            self.hour_count = self.hour_count.saturating_add(1);
        } else {
            self.hour = hour;
            self.hour_count = 1;
        }
    }
}

#[app::logic]
impl MeroForms {
    /// Creates an empty workspace. The instance's owner is its first admin
    /// and, until teammates are added, the only one who can build forms or read
    /// responses.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        let mut state = Self::load();
        let _ = state.admins.insert(&env::app_owner())?;
        Ok(state)
    }

    // ── Forms ────────────────────────────────────────────────────────────────

    /// Creates a form with no fields, open, and returns its id. Team only.
    pub fn create_form(&mut self, title: String, description: String) -> app::Result<String> {
        let me = self.only_team()?;
        let title = title.trim().to_owned();
        let description = description.trim().to_owned();
        check("title", &title, MAX_TITLE, true)?;
        check("description", &description, MAX_DESCRIPTION, false)?;
        if self.forms.len()? >= MAX_FORMS {
            return Err(refused(format!(
                "a workspace has at most {MAX_FORMS} forms"
            )));
        }
        let id = random_id(8);
        if self.forms.contains(&id)? {
            return Err(refused("form id collision; create it again"));
        }
        let now = env::time_now();
        let form = FormRow {
            title,
            description,
            fields: Vec::new(),
            open: true,
            crm: CrmLink::default(),
            public: false,
            link_cap: DEFAULT_LINK_CAP,
            captcha_key: String::new(),
            created_at: now,
            created_by: me,
            updated_at: now,
        };
        let _ = self.forms.insert(&id, &form)?;
        env::emit(Event::FormChanged { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Replaces a form's title, description and fields. Team only.
    ///
    /// Responses already sent keep the fields as they were; a removed field
    /// stays readable on them.
    pub fn update_form(
        &mut self,
        form_id: String,
        title: String,
        description: String,
        fields: Vec<Field>,
    ) -> app::Result<FormView> {
        self.only_team()?;
        let title = title.trim().to_owned();
        let description = description.trim().to_owned();
        check("title", &title, MAX_TITLE, true)?;
        check("description", &description, MAX_DESCRIPTION, false)?;
        let fields = clean_fields(fields)?;
        self.edit_form(&form_id, |form| {
            form.title = title;
            form.description = description;
            form.fields = fields;
            Ok(())
        })
    }

    /// Opens or closes a form to new responses. Team only.
    pub fn set_form_open(&mut self, form_id: String, open: bool) -> app::Result<FormView> {
        self.only_team()?;
        self.edit_form(&form_id, |form| {
            form.open = open;
            Ok(())
        })
    }

    /// Where the form's responses go in Mero CRM, or `contextId` empty for
    /// nowhere. The mapped fields must be on the form. Team only.
    pub fn set_crm_link(&mut self, form_id: String, link: CrmLink) -> app::Result<FormView> {
        self.only_team()?;
        let link = CrmLink {
            context_id: link.context_id.trim().to_owned(),
            stage_id: link.stage_id.trim().to_owned(),
            name_field: link.name_field.trim().to_owned(),
            email_field: link.email_field.trim().to_owned(),
            phone_field: link.phone_field.trim().to_owned(),
            organization_field: link.organization_field.trim().to_owned(),
            title_field: link.title_field.trim().to_owned(),
        };
        check("CRM context", &link.context_id, MAX_ID, false)?;
        check(
            "CRM stage",
            &link.stage_id,
            MAX_ID,
            !link.context_id.is_empty(),
        )?;
        if !link.context_id.is_empty() && link.name_field.is_empty() {
            return Err(invalid("choose the field that holds the contact's name"));
        }
        self.edit_form(&form_id, |form| {
            for f in [
                &link.name_field,
                &link.email_field,
                &link.phone_field,
                &link.organization_field,
                &link.title_field,
            ] {
                if !f.is_empty() && !form.fields.iter().any(|field| &field.id == f) {
                    return Err(invalid(format!("the form has no field {f:?}")));
                }
            }
            form.crm = link;
            Ok(())
        })
    }

    /// Deletes a form that has no responses, with its public links. A form
    /// with responses is closed instead, so nothing anyone sent disappears.
    /// Team only.
    pub fn delete_form(&mut self, form_id: String) -> app::Result<()> {
        self.only_team()?;
        let _ = self.form(&form_id)?;
        if self.stats(&form_id)?.responses > 0 {
            return Err(refused(
                "this form has responses; close it instead of deleting it",
            ));
        }
        let page = self.form_links.prefix(
            &[KeyPart::Str(form_id.clone())],
            FindOpts::default().limit(ROWS),
        )?;
        for (form, link) in page.items {
            let _ = self.form_links.remove(&(form, link.clone()))?;
            if let Some(row) = self.links.remove(&link)? {
                let _ = self.link_keys.remove(&row.grant_id)?;
            }
            let _ = self.link_stats.remove(&link)?;
        }
        let _ = self.forms.remove(&form_id)?;
        let _ = self.form_stats.remove(&form_id)?;
        env::emit(Event::FormChanged { id: form_id }, Audience::All)?;
        Ok(())
    }

    /// One form. Any account that reaches the app, and a website's form key:
    /// a website may read the questions it is about to answer.
    #[app::view]
    pub fn get_form(&self, form_id: String) -> app::Result<FormView> {
        let caller = who()?;
        if let Who::Key { id, .. } = &caller {
            if self.link_keys.contains(id)? {
                return Err(forbidden("a public link reads its form with linkForm"));
            }
        }
        let form = self.form(&form_id)?;
        Ok(form_view(form_id, &form))
    }

    /// Every form, newest first, with its response counts. Team only.
    #[app::view]
    pub fn list_forms(&self) -> app::Result<Vec<FormSummary>> {
        self.only_team()?;
        let page = self.forms.page(FindOpts::default().limit(ROWS))?;
        let mut out = Vec::with_capacity(page.items.len());
        for (id, form) in page.items {
            let stats = self.stats(&id)?;
            out.push(FormSummary {
                title: form.title,
                description: form.description,
                open: form.open,
                fields: u32::try_from(form.fields.len()).unwrap_or(u32::MAX),
                responses: stats.responses,
                new_responses: stats.new_responses,
                last_response_at: stats.last_response_at,
                created_at: form.created_at,
                id,
            });
        }
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        Ok(out)
    }

    /// The kinds of field a form can ask for.
    #[app::view]
    pub fn field_kinds(&self) -> app::Result<Vec<String>> {
        Ok(FIELD_KINDS.iter().map(|k| (*k).to_owned()).collect())
    }

    // ── Responses ────────────────────────────────────────────────────────────

    /// Stores a response to an open form and returns its id. What a website's
    /// form key calls; a teammate may also enter one.
    ///
    /// Every answer is checked against its field. Answers for fields the form
    /// does not have are refused, so a stale website fails loudly. A form key
    /// may only answer the form it was registered for. Emits `Submitted` with
    /// ids only.
    pub fn submit_response(
        &mut self,
        form_id: String,
        answers: Vec<AnswerInput>,
        source: String,
    ) -> app::Result<String> {
        let sender = match who()? {
            Who::Account(account) => account,
            Who::Key { id, account } => {
                if let Some(key) = self.form_keys.get(&id)? {
                    if key.form_id != form_id {
                        return Err(forbidden("this form key is for another form"));
                    }
                    id
                } else if self.link_keys.contains(&id)? {
                    return Err(forbidden("a public link answers with submitViaLink"));
                } else {
                    account
                }
            }
        };
        let form = self.form(&form_id)?;
        let source = source.trim().to_owned();
        check("source", &source, MAX_SOURCE, false)?;
        self.store_response(&form_id, &form, answers, source, String::new(), sender)
    }

    /// A form's responses, newest first (at most 1,000). Team only.
    #[app::view]
    pub fn list_responses(&self, form_id: String) -> app::Result<Vec<ResponseView>> {
        self.only_team()?;
        let page = self.form_responses.prefix(
            &[KeyPart::Str(form_id)],
            FindOpts::default().limit(ROWS).reverse(),
        )?;
        let mut out = Vec::with_capacity(page.items.len());
        for (_, _, id) in page.items {
            if let Some(response) = self.responses.get(&id)? {
                let state = self.triage.get(&id)?;
                out.push(response_view(id, response, state));
            }
        }
        Ok(out)
    }

    /// One response. Team only.
    #[app::view]
    pub fn get_response(&self, id: String) -> app::Result<ResponseView> {
        self.only_team()?;
        let response = self.response(&id)?;
        let state = self.triage.get(&id)?;
        Ok(response_view(id, response, state))
    }

    /// Archives a response, or brings it back. Team only.
    pub fn set_archived(&mut self, id: String, archived: bool) -> app::Result<ResponseView> {
        self.only_team()?;
        self.edit_state(id, |state| {
            state.archived = archived;
            Ok(())
        })
    }

    /// Records the CRM deal a response became, after the app created it in
    /// that CRM instance. Team only. Refuses a response already sent: the log
    /// orders two teammates' records, so the second is refused.
    pub fn record_crm_deal(
        &mut self,
        id: String,
        crm_context: String,
        crm_deal: String,
    ) -> app::Result<ResponseView> {
        let me = self.only_team()?;
        let crm_context = crm_context.trim().to_owned();
        let crm_deal = crm_deal.trim().to_owned();
        check("CRM context", &crm_context, MAX_ID, true)?;
        check("CRM deal", &crm_deal, MAX_ID, true)?;
        let now = env::time_now();
        self.edit_state(id, |state| {
            if !state.crm_deal.is_empty() {
                return Err(refused("this response was already sent to the CRM"));
            }
            state.crm_context = crm_context;
            state.crm_deal = crm_deal;
            state.crm_sent_at = now;
            state.crm_sent_by = me;
            Ok(())
        })
    }

    // ── Public links ─────────────────────────────────────────────────────────

    /// Lets the form's public links take responses, or stops them all.
    /// Team only. Links are kept either way.
    pub fn set_form_public(&mut self, form_id: String, public: bool) -> app::Result<FormView> {
        self.only_team()?;
        self.edit_form(&form_id, |form| {
            form.public = public;
            Ok(())
        })
    }

    /// How many responses each of the form's links may send per hour. Team only.
    pub fn set_link_cap(&mut self, form_id: String, per_hour: u32) -> app::Result<FormView> {
        self.only_team()?;
        if per_hour == 0 || per_hour > MAX_LINK_CAP {
            return Err(invalid(format!(
                "a link may send between 1 and {MAX_LINK_CAP} responses per hour"
            )));
        }
        self.edit_form(&form_id, |form| {
            form.link_cap = per_hour;
            Ok(())
        })
    }

    /// Requires a captcha on every response through the form's links: a pass
    /// signed by `key` (an ed25519 public key, hex). Empty requires none.
    /// `turnstile` (the node checks the token) is `Unsupported` on this
    /// runtime. Team only.
    pub fn set_captcha_key(&mut self, form_id: String, key: String) -> app::Result<FormView> {
        self.only_team()?;
        let key = key.trim().to_lowercase();
        if key == NODE_VERIFIES_TURNSTILE {
            return Err(unsupported(
                "checking a captcha through the node needs outbound requests from the app, \
                 which this Calimero release does not have yet: use the verifier's key",
            ));
        }
        if !key.is_empty() && decode_fixed::<32>(&key).is_none() {
            return Err(invalid(
                "the captcha key must be 32 bytes of hex, or \"turnstile\"",
            ));
        }
        self.edit_form(&form_id, |form| {
            form.captcha_key = key;
            Ok(())
        })
    }

    /// Records a public link for `formId`: `link` is the SHA-256 (hex) of the
    /// API key's token, `grantId` the key's id. Team only.
    pub fn create_link(
        &mut self,
        form_id: String,
        link: String,
        grant_id: String,
        label: String,
    ) -> app::Result<LinkView> {
        let me = self.only_team()?;
        let link = link.trim().to_lowercase();
        if link.len() != LINK_ID_HEX || decode_fixed::<32>(&link).is_none() {
            return Err(invalid("a link id is the SHA-256 of its token, in hex"));
        }
        let grant_id = grant_id.trim().to_owned();
        check("grant id", &grant_id, MAX_GRANT_ID, true)?;
        let label = label.trim().to_owned();
        check("label", &label, MAX_KEY_LABEL, false)?;
        let _ = self.form(&form_id)?;
        if self.links.contains(&link)? {
            return Err(refused("this link already exists"));
        }
        if self.link_keys.contains(&grant_id)? || self.form_keys.contains(&grant_id)? {
            return Err(refused("this key is already in use"));
        }
        let row = LinkRow {
            form_id: form_id.clone(),
            label,
            grant_id: grant_id.clone(),
            created_at: env::time_now(),
            created_by: me,
        };
        let _ = self.links.insert(&link, &row)?;
        let _ = self.form_links.insert(&(form_id, link.clone()))?;
        let _ = self.link_keys.insert(&grant_id, &link)?;
        Ok(link_view(
            link,
            &row,
            &SendStats::default(),
            env::time_now(),
        ))
    }

    /// Stops a public link and returns what it was, so the app can revoke its
    /// API key. Team only.
    pub fn delete_link(&mut self, link: String) -> app::Result<LinkView> {
        self.only_team()?;
        let link = link.trim().to_lowercase();
        let row = self
            .links
            .remove(&link)?
            .ok_or_else(|| not_found("no such link"))?;
        let _ = self
            .form_links
            .remove(&(row.form_id.clone(), link.clone()))?;
        let _ = self.link_keys.remove(&row.grant_id)?;
        let stats = self.link_stats.remove(&link)?.unwrap_or_default();
        Ok(link_view(link, &row, &stats, env::time_now()))
    }

    /// The form's public links, newest first, with what each has sent (at most
    /// 1,000). Team only.
    #[app::view]
    pub fn list_links(&self, form_id: String) -> app::Result<Vec<LinkView>> {
        self.only_team()?;
        let page = self
            .form_links
            .prefix(&[KeyPart::Str(form_id)], FindOpts::default().limit(ROWS))?;
        let now = env::time_now();
        let mut views = Vec::with_capacity(page.items.len());
        for (_, id) in page.items {
            if let Some(row) = self.links.get(&id)? {
                let stats = self.link_stats.get(&id)?.unwrap_or_default();
                views.push(link_view(id, &row, &stats, now));
            }
        }
        views.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        Ok(views)
    }

    /// The form a public link is for, as its visitor sees it. One of the two
    /// methods a link's API key names.
    #[app::view]
    pub fn link_form(&self, link: String) -> app::Result<LinkFormView> {
        let (form_id, _) = self.link(&link)?;
        let form = self.form(&form_id)?;
        Ok(LinkFormView {
            form_id,
            title: form.title,
            description: form.description,
            fields: form.fields,
            accepting: form.open && form.public,
            captcha: !form.captcha_key.is_empty(),
            captcha_by_node: false,
            captcha_site_key: String::new(),
        })
    }

    /// Stores a response that came through a public link and returns its id.
    /// The other method a link's API key names.
    ///
    /// Refused unless the form is open and public, the link is under its
    /// hourly cap, and, when the form asks for a captcha, `captcha` is a pass
    /// the form's verifier signed for this form and link, unexpired and
    /// unused. `captchaToken` was v1's Turnstile token for a node-checked
    /// form; it is ignored.
    pub fn submit_via_link(
        &mut self,
        link: String,
        answers: Vec<AnswerInput>,
        captcha: Option<CaptchaPass>,
        captcha_token: Option<String>,
    ) -> app::Result<String> {
        let _ = captcha_token;
        let link = link.trim().to_lowercase();
        let (form_id, label) = self.link(&link)?;
        let form = self.form(&form_id)?;
        if !form.public {
            return Err(refused("this form is not taking responses from links"));
        }
        if !form.open {
            return Err(refused("this form is closed"));
        }
        let now = env::time_now();
        let stats = self.link_stats.get(&link)?.unwrap_or_default();
        if stats.in_hour(now) >= form.link_cap {
            return Err(refused(
                "this link has taken as many responses as it may this hour; try again later",
            ));
        }
        if !form.captcha_key.is_empty() {
            let pass = captcha.ok_or_else(|| refused("this form needs a captcha"))?;
            self.spend_pass(&form.captcha_key, &form_id, &link, pass)?;
        }
        let source = if label.is_empty() {
            "public link".to_owned()
        } else {
            format!("public link · {label}")
        };
        let sender = who()?.account().to_owned();
        self.store_response(&form_id, &form, answers, source, link, sender)
    }

    // ── Team ─────────────────────────────────────────────────────────────────

    /// The team: the admins and the accounts they added (at most 1,000 of
    /// each), in account order. Team only.
    #[app::view]
    pub fn list_team(&self) -> app::Result<Vec<TeamMember>> {
        self.only_team()?;
        let admins = self.admins.page(FindOpts::default().limit(ROWS))?.items;
        let team = self.team.page(FindOpts::default().limit(ROWS))?.items;
        let mut out: Vec<TeamMember> = admins
            .iter()
            .map(|a| TeamMember {
                account: a.clone(),
                admin: true,
            })
            .collect();
        for account in team {
            if !admins.contains(&account) {
                out.push(TeamMember {
                    account,
                    admin: false,
                });
            }
        }
        out.sort_by(|a, b| a.account.cmp(&b.account));
        Ok(out)
    }

    /// Adds `who` to the team. Admin only.
    pub fn add_team_member(&mut self, who: String) -> app::Result<()> {
        self.only_admin()?;
        let who = clean_account("who", &who)?;
        if self.form_keys.contains(&who)? || self.link_keys.contains(&who)? {
            return Err(refused("a form key cannot join the team"));
        }
        let _ = self.team.insert(&who)?;
        Ok(())
    }

    /// Removes `who` from the team. Admin only. An admin stays an admin.
    pub fn remove_team_member(&mut self, who: String) -> app::Result<()> {
        self.only_admin()?;
        let who = clean_account("who", &who)?;
        let _ = self.team.remove(&who)?;
        Ok(())
    }

    // ── Captcha secret ───────────────────────────────────────────────────────

    /// v1 stored the team's own Turnstile keys, the secret sealed to the
    /// namespace's TEE. The component SDK cannot seal a secret or send it, so
    /// this is refused (`Unsupported`), as v1 refused it without a TEE. Admin
    /// only.
    pub fn set_captcha_secret(
        &mut self,
        site_key: String,
        secret: String,
    ) -> app::Result<CaptchaSettings> {
        self.only_admin()?;
        let _ = (site_key, secret);
        Err(unsupported(
            "only a TEE can keep a captcha secret, and this Calimero release cannot hand one \
             to an app yet: use the verifier's captcha",
        ))
    }

    /// Removes the team's Turnstile keys, if any. Admin only.
    pub fn clear_captcha_secret(&mut self) -> app::Result<CaptchaSettings> {
        self.only_admin()?;
        for name in CAPTCHA_ROWS {
            let _ = self.settings.remove(&name.to_owned())?;
        }
        self.captcha_settings()
    }

    /// The team's Turnstile setup. Team only. No TEE can keep a secret here.
    #[app::view]
    pub fn captcha_settings(&self) -> app::Result<CaptchaSettings> {
        self.only_team()?;
        Ok(CaptchaSettings {
            site_key: self.setting(CAPTCHA_ROWS[0])?,
            secret_set: false,
            tee_available: false,
            needs_resealing: false,
        })
    }

    // ── Workspace name ───────────────────────────────────────────────────────

    /// The workspace's display name, or empty. Anyone who reaches the app.
    #[app::view]
    pub fn workspace_name(&self) -> app::Result<String> {
        self.setting(WORKSPACE_NAME)
    }

    /// Names the workspace. Team only.
    pub fn set_workspace_name(&mut self, name: String) -> app::Result<()> {
        self.only_team()?;
        let name = name.trim().to_owned();
        check("name", &name, MAX_TITLE, false)?;
        let _ = self.settings.insert(&WORKSPACE_NAME.to_owned(), &name)?;
        Ok(())
    }

    // ── Form keys ────────────────────────────────────────────────────────────

    /// Records `account` (an API key's id) as a website form key for
    /// `formId`, called `label`. Admin only.
    ///
    /// The app calls this right after creating the key, limited to this app
    /// and to `submitResponse` and `getForm`; the register is what binds it
    /// to one form, labels it and keeps it off the team.
    pub fn register_form_key(
        &mut self,
        account: String,
        form_id: String,
        label: String,
    ) -> app::Result<()> {
        let me = self.only_admin()?;
        let account = clean_account("account", &account)?;
        let label = label.trim().to_owned();
        check("label", &label, MAX_KEY_LABEL, true)?;
        if self.is_team(&account)? {
            return Err(refused("a teammate cannot be a form key"));
        }
        if self.link_keys.contains(&account)? {
            return Err(refused("this key is already in use"));
        }
        let _ = self.form(&form_id)?;
        let key = FormKey {
            label,
            form_id,
            created_at: env::time_now(),
            created_by: me,
        };
        let _ = self.form_keys.insert(&account, &key)?;
        Ok(())
    }

    /// Drops `account` from the register. Admin only. Revoking the API key is
    /// what stops it calling; the app does both.
    pub fn forget_form_key(&mut self, account: String) -> app::Result<()> {
        self.only_admin()?;
        let account = clean_account("account", &account)?;
        let _ = self.form_keys.remove(&account)?;
        Ok(())
    }

    /// The registered form keys, newest first, with what each has sent (at
    /// most 1,000). Admin only.
    #[app::view]
    pub fn list_form_keys(&self) -> app::Result<Vec<FormKeyView>> {
        self.only_admin()?;
        let page = self.form_keys.page(FindOpts::default().limit(ROWS))?;
        let mut views = Vec::with_capacity(page.items.len());
        for (account, key) in page.items {
            let sent = self.sender_stats.get(&account)?.unwrap_or_default();
            views.push(FormKeyView {
                label: key.label,
                form_id: key.form_id,
                created_at: key.created_at,
                created_by: key.created_by,
                responses: sent.responses,
                last_response_at: sent.last_response_at,
                account,
            });
        }
        views.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then(b.account.cmp(&a.account))
        });
        Ok(views)
    }

    // ── Identity ─────────────────────────────────────────────────────────────

    /// Whether the caller is on the team.
    #[app::view]
    pub fn am_i_team(&self) -> app::Result<bool> {
        let caller = who()?;
        if self.is_key(&caller)? {
            return Ok(false);
        }
        self.is_team(caller.account())
    }

    /// Whether the caller is an admin.
    #[app::view]
    pub fn am_i_admin(&self) -> app::Result<bool> {
        let caller = who()?;
        if self.is_key(&caller)? {
            return Ok(false);
        }
        Ok(self.admins.contains(&caller.account().to_owned())?)
    }

    /// The caller's account (for an API key, the account it acts for).
    #[app::view]
    pub fn my_account(&self) -> app::Result<String> {
        Ok(who()?.account().to_owned())
    }
}

fn link_view(id: String, row: &LinkRow, stats: &SendStats, now: u64) -> LinkView {
    LinkView {
        id,
        form_id: row.form_id.clone(),
        label: row.label.clone(),
        grant_id: row.grant_id.clone(),
        created_at: row.created_at,
        created_by: row.created_by.clone(),
        responses: stats.responses,
        last_hour: stats.in_hour(now),
        last_response_at: stats.last_response_at,
    }
}

impl MeroForms {
    /// Whether the caller is a registered form key or a public link's key:
    /// such a key never acts as the account it belongs to.
    fn is_key(&self, caller: &Who) -> app::Result<bool> {
        Ok(match caller {
            Who::Account(_) => false,
            Who::Key { id, .. } => self.form_keys.contains(id)? || self.link_keys.contains(id)?,
        })
    }

    fn is_team(&self, account: &str) -> app::Result<bool> {
        let account = account.to_owned();
        Ok(self.admins.contains(&account)? || self.team.contains(&account)?)
    }

    /// The caller's account, when it is on the team.
    fn only_team(&self) -> app::Result<String> {
        let caller = who()?;
        if self.is_key(&caller)? || !self.is_team(caller.account())? {
            return Err(forbidden("only the team may do this"));
        }
        Ok(caller.account().to_owned())
    }

    /// The caller's account, when it is an admin.
    fn only_admin(&self) -> app::Result<String> {
        let caller = who()?;
        if self.is_key(&caller)? || !self.admins.contains(&caller.account().to_owned())? {
            return Err(forbidden("only an admin may do this"));
        }
        Ok(caller.account().to_owned())
    }

    fn setting(&self, name: &str) -> app::Result<String> {
        Ok(self.settings.get(&name.to_owned())?.unwrap_or_default())
    }

    fn stats(&self, form_id: &str) -> app::Result<FormStats> {
        Ok(self
            .form_stats
            .get(&form_id.to_owned())?
            .unwrap_or_default())
    }

    fn form(&self, id: &str) -> app::Result<FormRow> {
        self.forms
            .get(&id.to_owned())?
            .ok_or_else(|| not_found(format!("no form {id}")))
    }

    fn edit_form(
        &mut self,
        id: &str,
        change: impl FnOnce(&mut FormRow) -> app::Result<()>,
    ) -> app::Result<FormView> {
        let mut form = self.form(id)?;
        change(&mut form)?;
        form.updated_at = env::time_now();
        let _ = self.forms.insert(&id.to_owned(), &form)?;
        env::emit(Event::FormChanged { id: id.to_owned() }, Audience::All)?;
        Ok(form_view(id.to_owned(), &form))
    }

    fn response(&self, id: &str) -> app::Result<Response> {
        self.responses
            .get(&id.to_owned())?
            .ok_or_else(|| not_found(format!("no response {id}")))
    }

    fn edit_state(
        &mut self,
        id: String,
        change: impl FnOnce(&mut ResponseState) -> app::Result<()>,
    ) -> app::Result<ResponseView> {
        let response = self.response(&id)?;
        let mut state = self.triage.get(&id)?.unwrap_or_default();
        let was_new = is_new(&state);
        change(&mut state)?;
        let now_new = is_new(&state);
        if was_new != now_new {
            let mut stats = self.stats(&response.form_id)?;
            stats.new_responses = if now_new {
                stats.new_responses.saturating_add(1)
            } else {
                stats.new_responses.saturating_sub(1)
            };
            let _ = self.form_stats.insert(&response.form_id, &stats)?;
        }
        let _ = self.triage.insert(&id, &state)?;
        env::emit(Event::ResponseChanged { id: id.clone() }, Audience::All)?;
        Ok(response_view(id, response, Some(state)))
    }

    /// The form a link is for, and its label. A public link's API key opens
    /// only its own link.
    fn link(&self, link: &str) -> app::Result<(String, String)> {
        let link = link.trim().to_lowercase();
        let row = self
            .links
            .get(&link)?
            .ok_or_else(|| refused("this link no longer works"))?;
        if let Who::Key { id, .. } = who()? {
            if self.form_keys.contains(&id)?
                || (self.link_keys.contains(&id)? && row.grant_id != id)
            {
                return Err(refused("this link no longer works"));
            }
        }
        Ok((row.form_id, row.label))
    }

    /// Checks every answer against the form and stores the response.
    fn store_response(
        &mut self,
        form_id: &str,
        form: &FormRow,
        answers: Vec<AnswerInput>,
        source: String,
        link: String,
        sender: String,
    ) -> app::Result<String> {
        if !form.open {
            return Err(refused("this form is closed"));
        }
        let mut given: std::collections::BTreeMap<String, Vec<String>> = Default::default();
        for answer in answers {
            let id = answer.field_id.trim().to_owned();
            if given.insert(id.clone(), answer.values).is_some() {
                return Err(invalid(format!("field {id:?} was answered twice")));
            }
        }
        if form.fields.is_empty() {
            return Err(refused("this form has no fields yet"));
        }
        let mut stored = Vec::with_capacity(form.fields.len());
        for field in &form.fields {
            let values = check_answer(field, given.remove(&field.id).unwrap_or_default())?;
            stored.push(Answer {
                field_id: field.id.clone(),
                label: field.label.clone(),
                kind: field.kind.clone(),
                values,
            });
        }
        if let Some(unknown) = given.keys().next() {
            return Err(invalid(format!("the form has no field {unknown:?}")));
        }

        let id = random_id(16);
        if self.responses.contains(&id)? {
            return Err(refused("response id collision; submit again"));
        }
        let now = env::time_now();
        let response = Response {
            form_id: form_id.to_owned(),
            answers: stored,
            source,
            created_at: now,
            submitted_by: sender.clone(),
            link: link.clone(),
        };
        let _ = self.responses.insert(&id, &response)?;
        let _ = self
            .form_responses
            .insert(&(form_id.to_owned(), now, id.clone()))?;

        let mut stats = self.stats(form_id)?;
        stats.responses = stats.responses.saturating_add(1);
        stats.new_responses = stats.new_responses.saturating_add(1);
        stats.last_response_at = stats.last_response_at.max(now);
        let _ = self.form_stats.insert(&form_id.to_owned(), &stats)?;

        let mut sent = self.sender_stats.get(&sender)?.unwrap_or_default();
        sent.count(now);
        let _ = self.sender_stats.insert(&sender, &sent)?;
        if !link.is_empty() {
            let mut sent = self.link_stats.get(&link)?.unwrap_or_default();
            sent.count(now);
            let _ = self.link_stats.insert(&link, &sent)?;
        }

        env::emit(
            Event::Submitted {
                id: id.clone(),
                form_id: form_id.to_owned(),
            },
            Audience::All,
        )?;
        Ok(id)
    }

    /// Checks a captcha pass and records its nonce as spent, dropping a few
    /// spent nonces that have expired.
    fn spend_pass(
        &mut self,
        key: &str,
        form_id: &str,
        link: &str,
        pass: CaptchaPass,
    ) -> app::Result<()> {
        let nonce = pass.nonce.trim().to_lowercase();
        if nonce.len() != PASS_NONCE_HEX || hex::decode(&nonce).is_err() {
            return Err(refused("the captcha pass is malformed"));
        }
        let now_ms = env::time_now();
        if pass.expires_ms < now_ms {
            return Err(refused("the captcha has expired; solve it again"));
        }
        if pass.expires_ms > now_ms + MAX_PASS_MS {
            return Err(refused("the captcha pass is valid for too long"));
        }
        let (Some(signature), Some(public_key)) = (
            decode_fixed::<64>(pass.signature.trim()),
            decode_fixed::<32>(key),
        ) else {
            return Err(refused("the captcha pass is malformed"));
        };
        let message = captcha_message(form_id, link, &nonce, pass.expires_ms);
        if !verify_signature(&signature, &public_key, message.as_bytes()) {
            return Err(refused("the captcha pass is not valid for this form"));
        }
        if self.captcha_seen.contains(&nonce)? {
            return Err(refused("this captcha was already used; solve it again"));
        }
        let expired = self.captcha_expiry.page(
            FindOpts::default()
                .limit(PRUNE_PER_PASS)
                .to(vec![KeyPart::Int(i128::from(now_ms))]),
        )?;
        for (expiry, old) in expired.items {
            let _ = self.captcha_expiry.remove(&(expiry, old.clone()))?;
            let _ = self.captcha_seen.remove(&old)?;
        }
        let _ = self.captcha_seen.insert(&nonce, &pass.expires_ms)?;
        let _ = self.captcha_expiry.insert(&(pass.expires_ms, nonce))?;
        Ok(())
    }
}
