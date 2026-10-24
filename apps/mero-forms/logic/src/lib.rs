//! Mero Forms — forms a team designs, the responses they collect, and a hand-off
//! of any response to Mero CRM.
//!
//! A context is one workspace of forms. Its members are the team, plus one
//! account per website form: a "form key" with no node of its own, bound to
//! one form, which writes `submit_response` through a relay by delegated
//! execution (see the README). The team builds forms, reads responses and
//! sends them on to a CRM pipeline from the app.
//!
//! # Who may write what — enforced by every node, not by these methods
//!
//! A receiving node does not run this contract; it checks the delta's
//! signature and the entry's storage stamp, then applies it. The `if`s below
//! only make a refused write fail early. What holds is the tier, picked from
//! `apps/mero-chess/docs/trust-model.md`:
//!
//! * `responses` is a plain `UnorderedMap<id, LwwRegister<Response>>` (the
//!   register only makes the value mergeable), insert-only by this contract:
//!   `submit_response` refuses an id that exists, and nothing else writes it.
//!   Deliberately NOT owned storage (`WriteOnce`/`Authored`): a form key
//!   writes through a relay, and core lets only an attested TEE relay
//!   (`RelayTee`) sign an owned entry on a member's behalf. Owned responses
//!   would make every website response depend on Calimero Cloud's fleet, and
//!   a team's own node could never relay one. The price is that insert-only
//!   binds honest nodes only: a patched MEMBER node could overwrite a
//!   response. Every member node already holds every response, so that is a
//!   member misbehaving inside the boundary, not a way in. `submitted_by` is
//!   the calling account as the node that ran the call saw it; for a form
//!   key that node is the relay.
//! * `forms` is `SharedStorage<UnorderedMap<id, Form>>`, writable by the team
//!   only: each form's title, description, fields, whether it is open, and
//!   where its responses go in Mero CRM.
//! * `triage` is `SharedStorage<UnorderedMap<id, ResponseState>>` with the
//!   same writers: a response archived, or the CRM deal it became.
//! * `settings` is `SharedStorage<UnorderedMap<key, String>>` with the same
//!   writers: the workspace's display name.
//! * `form_keys` is `SharedStorage<UnorderedMap<account, FormKey>>`, writable
//!   by the admins only: which accounts are website form keys, the form each
//!   may submit to, and a label. It is the app's register, not the grant.
//!   What lets a form key write is being a member of the namespace, which the
//!   app adds and removes through the node.
//! * `links` is `SharedStorage<UnorderedMap<id, Link>>`, writable by the team:
//!   the form's public links. A link is a core access grant on a teammate's
//!   node that may call `link_form` and `submit_via_link` and nothing else;
//!   its id here is the SHA-256 of the grant's token, which only the link
//!   carries. Deleting the row stops the link even before the grant is
//!   revoked on that node.
//! * `captcha_seen` is `SharedStorage<UnorderedMap<nonce, expiry>>`, writable
//!   by the team: captcha passes already spent, until they expire.
//! * `roles` is `AccessControl`: the admins (the installer to start with) and
//!   the `team` role. Only admins change it, enforced at merge. Adding or
//!   removing a teammate rotates the writers of `forms`, `triage`,
//!   `settings`, `links` and `captcha_seen`.
//!
//! # Public links
//!
//! A grant call runs as the node that issued the grant, a teammate, so the
//! contract cannot tell a link's visitor from that teammate by the caller.
//! That is why a link has its own methods: `link_form` shows the one form a
//! link is for, and `submit_via_link` takes a response only when that form is
//! public and open, under its hourly cap, and with a captcha pass when the
//! form asks for one. The grant names only those two methods, so a visitor
//! never reaches `submit_response` or anything that reads responses.
//!
//! # Answers
//!
//! A form's fields are typed, and `submit_response` checks every answer
//! against its field: required, the right shape for its kind, one of the
//! options for a choice. A response stores an answer for every field the form
//! had when it was sent, with that field's label at the time, so a response
//! still reads correctly after the form is edited.
//!
//! # Who may READ
//!
//! `list_responses` refuses anyone off the team, but that is a convenience,
//! not the boundary. A context's state replicates to every member NODE, so
//! who can read responses is whoever runs a node in this context. A form key
//! runs no node: a relay executes its one call and hands it nothing back but
//! the new response's id. Keep the context to the team and its form keys.

use std::collections::{BTreeMap, BTreeSet};

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::{app, env, AccountId};
use calimero_storage::collections::{
    AccessControl, LwwRegister, SharedStorage, StoreError, UnorderedMap,
};

#[cfg(test)]
mod tests;

/// The role a team member holds, besides the admins.
const TEAM: &str = "team";

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
const MAX_FORMS: usize = 200;

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

/// Public links.
const LINK_ID_HEX: usize = 64;
const MAX_GRANT_ID: usize = 128;
const DEFAULT_LINK_CAP: u32 = 30;
const MAX_LINK_CAP: u32 = 10_000;
const HOUR_NS: u64 = 3_600 * 1_000_000_000;
/// The longest a captcha pass may be valid for, from when it is spent.
const MAX_PASS_MS: u64 = 10 * 60 * 1_000;
const PASS_NONCE_HEX: usize = 32;

/// The `settings` key the workspace's display name is kept under.
const WORKSPACE_NAME: &str = "name";

/// One field of a form.
#[derive(
    AbiType, Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Field {
    /// Stable, chosen when the field is added: what a website's backend sends
    /// the answer under, e.g. `email`. Lowercase letters, digits, `_` and `-`.
    pub id: String,
    /// One of [`FIELD_KINDS`].
    pub kind: String,
    pub label: String,
    /// A line under the label, or empty.
    pub help: String,
    pub required: bool,
    /// The choices, for `choice` and `checkboxes`; empty for the rest.
    pub options: Vec<String>,
}

/// Where a form's responses go in Mero CRM, and which field fills what.
/// Empty strings mean "not set".
#[derive(
    AbiType,
    Debug,
    Clone,
    Default,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct CrmLink {
    /// The Mero CRM context (pipeline) the deals go to. Empty: no CRM.
    pub context_id: String,
    /// The stage a new deal starts in.
    pub stage_id: String,
    /// Field ids whose answers fill the contact and the deal.
    pub name_field: String,
    pub email_field: String,
    pub phone_field: String,
    pub organization_field: String,
    /// The answer that titles the deal; empty uses the contact's name.
    pub title_field: String,
}

/// One answer as a website's backend or the app sends it.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AnswerInput {
    pub field_id: String,
    /// One value for most kinds; any number of the options for `checkboxes`.
    pub values: Vec<String>,
}

/// One stored answer: the field as it was when the response was sent.
#[derive(
    AbiType, Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Answer {
    pub field_id: String,
    pub label: String,
    pub kind: String,
    /// Empty when an optional field was left blank.
    pub values: Vec<String>,
}

/// What a respondent sent, exactly. Inserted once, never edited.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Response {
    pub form_id: String,
    /// One per field of the form, in the form's order.
    pub answers: Vec<Answer>,
    /// Where it was sent from, e.g. `/contact/`, or empty.
    pub source: String,
    /// When the node accepted it, in nanoseconds since the Unix epoch.
    pub created_at: u64,
    /// The account that called `submit_response` (hex): which form key, or
    /// which teammate entered it. For a public link, the node that holds the
    /// link's grant.
    pub submitted_by: String,
    /// The public link it came through, or empty.
    pub link: String,
}

/// A form. Every field is a register, so two teammates changing different
/// parts of one form both keep their change; the field list is edited whole.
#[derive(BorshSerialize, BorshDeserialize, AbiType, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Form {
    pub title: LwwRegister<String>,
    pub description: LwwRegister<String>,
    pub fields: LwwRegister<Vec<Field>>,
    /// A closed form refuses new responses.
    pub open: LwwRegister<bool>,
    pub crm: LwwRegister<CrmLink>,
    /// Whether its public links take responses. Off: every link is refused,
    /// and works again when it is turned back on.
    pub public: LwwRegister<bool>,
    /// Responses each public link may send per hour.
    pub link_cap: LwwRegister<u32>,
    /// The captcha verifier's ed25519 public key, hex, or empty for no
    /// captcha. A link's response then needs a pass it signed.
    pub captcha_key: LwwRegister<String>,
    pub created_at: LwwRegister<u64>,
    pub created_by: LwwRegister<String>,
    pub updated_at: LwwRegister<u64>,
}

/// A public link, as the team made it.
#[derive(BorshSerialize, BorshDeserialize, AbiType, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Link {
    pub form_id: LwwRegister<String>,
    pub label: LwwRegister<String>,
    /// The access grant behind it, on `created_by`'s node.
    pub grant_id: LwwRegister<String>,
    pub created_at: LwwRegister<u64>,
    pub created_by: LwwRegister<String>,
}

/// A captcha pass: the verifier's signature over
/// `mero-forms/captcha/v1|<form>|<link>|<nonce>|<expires_ms>`. The nonce is
/// the visitor's, random, and each one is accepted once.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CaptchaPass {
    pub nonce: String,
    /// Milliseconds since the Unix epoch.
    pub expires_ms: u64,
    /// 64 bytes, hex.
    pub signature: String,
}

/// The team's state for one response.
#[derive(BorshSerialize, BorshDeserialize, AbiType, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct ResponseState {
    /// Out of the way, e.g. spam, without being deleted.
    pub archived: LwwRegister<bool>,
    /// The CRM context and deal it became, or empty.
    pub crm_context: LwwRegister<String>,
    pub crm_deal: LwwRegister<String>,
    pub crm_sent_at: LwwRegister<u64>,
    pub crm_sent_by: LwwRegister<String>,
}

/// A website form's key, as the admins registered it.
#[derive(BorshSerialize, BorshDeserialize, AbiType, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct FormKey {
    /// What the admins call it, e.g. "calimero.network contact page".
    pub label: LwwRegister<String>,
    /// The one form it may submit to.
    pub form_id: LwwRegister<String>,
    pub created_at: LwwRegister<u64>,
    pub created_by: LwwRegister<String>,
}

#[app::state(emits = for<'a> Event<'a>)]
pub struct MeroForms {
    responses: UnorderedMap<String, LwwRegister<Response>>,
    forms: SharedStorage<UnorderedMap<String, Form>>,
    triage: SharedStorage<UnorderedMap<String, ResponseState>>,
    settings: SharedStorage<UnorderedMap<String, LwwRegister<String>>>,
    form_keys: SharedStorage<UnorderedMap<String, FormKey>>,
    links: SharedStorage<UnorderedMap<String, Link>>,
    captcha_seen: SharedStorage<UnorderedMap<String, LwwRegister<u64>>>,
    roles: AccessControl,
}

/// Emitted after the write that caused it. Carries ids, never answers.
#[app::event]
pub enum Event<'a> {
    /// A response was submitted.
    Submitted { id: &'a str, form_id: &'a str },
    /// A teammate created or changed a form.
    FormChanged { id: &'a str },
    /// A teammate changed a response's state.
    ResponseChanged { id: &'a str },
}

/// A form in full.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
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
    pub created_at: u64,
    pub created_by: String,
    pub updated_at: u64,
}

/// A form as a public link's visitor sees it: the questions, and nothing the
/// team keeps about it.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LinkFormView {
    pub form_id: String,
    pub title: String,
    pub description: String,
    pub fields: Vec<Field>,
    /// Open and public: a response would be taken.
    pub accepting: bool,
    /// Whether a response needs a captcha pass.
    pub captcha: bool,
}

/// A public link, with what it has sent.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LinkView {
    pub id: String,
    pub form_id: String,
    pub label: String,
    pub grant_id: String,
    pub created_at: u64,
    pub created_by: String,
    pub responses: u32,
    pub last_hour: u32,
    pub last_response_at: u64,
}

/// A form in the list, with what it has collected.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FormSummary {
    pub id: String,
    pub title: String,
    pub description: String,
    pub open: bool,
    pub fields: u32,
    pub responses: u32,
    /// Not archived and not yet sent to the CRM.
    pub new_responses: u32,
    pub last_response_at: u64,
    pub created_at: u64,
}

/// A response as the team sees it.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ResponseView {
    pub id: String,
    pub form_id: String,
    pub answers: Vec<Answer>,
    pub source: String,
    pub created_at: u64,
    pub submitted_by: String,
    pub link: String,
    pub archived: bool,
    pub crm_context: String,
    pub crm_deal: String,
    pub crm_sent_at: u64,
    pub crm_sent_by: String,
}

/// A registered form key, with what it has sent.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FormKeyView {
    pub account: String,
    pub label: String,
    pub form_id: String,
    pub created_at: u64,
    pub created_by: String,
    /// How many responses this account has submitted.
    pub responses: u32,
    /// When it last submitted one, or zero.
    pub last_response_at: u64,
}

/// One entry of the team.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TeamMember {
    pub account: String,
    pub admin: bool,
}

fn store_err(what: &'static str) -> impl FnOnce(StoreError) -> AppError {
    move |e| AppError::msg(format!("{what}: {e}"))
}

fn check(what: &str, value: &str, max: usize, required: bool) -> app::Result<()> {
    if required && value.trim().is_empty() {
        return Err(AppError::msg(format!("{what} is required")));
    }
    if value.chars().count() > max {
        return Err(AppError::msg(format!(
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

/// Digits, with an optional leading `-` and one `.` between digits. No
/// exponent and no thousands separators, so every node reads it the same way.
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
        return Err(AppError::msg(format!(
            "a form has at most {MAX_FIELDS} fields"
        )));
    }
    let mut seen = BTreeSet::new();
    let mut out = Vec::with_capacity(fields.len());
    for field in fields {
        let id = field.id.trim().to_owned();
        if !is_field_id(&id) {
            return Err(AppError::msg(format!(
                "field id {id:?} must be lowercase letters, digits, _ or -, starting with a letter"
            )));
        }
        if !seen.insert(id.clone()) {
            return Err(AppError::msg(format!("two fields have the id {id:?}")));
        }
        let kind = field.kind.trim().to_owned();
        if !FIELD_KINDS.contains(&kind.as_str()) {
            return Err(AppError::msg(format!(
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
            let mut seen_options = BTreeSet::new();
            for option in field.options {
                let option = option.trim().to_owned();
                check("an option", &option, MAX_OPTION, true)?;
                if seen_options.insert(option.clone()) {
                    options.push(option);
                }
            }
            if options.is_empty() {
                return Err(AppError::msg(format!(
                    "field {label:?} needs at least one option"
                )));
            }
            if options.len() > MAX_OPTIONS {
                return Err(AppError::msg(format!(
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
            return Err(AppError::msg(format!("{label} is required")));
        }
        return Ok(values);
    }
    if field.kind == "checkboxes" {
        let mut seen = BTreeSet::new();
        let mut out = Vec::new();
        for v in values {
            if !field.options.contains(&v) {
                return Err(AppError::msg(format!(
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
        return Err(AppError::msg(format!("{label} takes one answer")));
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
        return Err(AppError::msg(format!("{label} must be {what}")));
    }
    Ok(values)
}

/// An account id from the hex string the app sends.
fn parse_account(field: &str, value: &str) -> app::Result<AccountId> {
    value
        .trim()
        .to_lowercase()
        .parse()
        .map_err(|_| AppError::msg(format!("{field} is not an account id")))
}

fn me() -> AccountId {
    env::account_id().into()
}

fn random_id(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    env::random_bytes(&mut buf);
    hex::encode(buf)
}

#[app::logic]
impl MeroForms {
    /// Creates an empty workspace. The installer is its first admin and, until
    /// teammates are added, the only one who can build forms or read responses.
    #[app::init]
    pub fn init() -> MeroForms {
        let me = me();
        MeroForms {
            responses: UnorderedMap::new(),
            forms: SharedStorage::new(BTreeSet::from([me]), false),
            triage: SharedStorage::new(BTreeSet::from([me]), false),
            settings: SharedStorage::new(BTreeSet::from([me]), false),
            form_keys: SharedStorage::new(BTreeSet::from([me]), false),
            links: SharedStorage::new(BTreeSet::from([me]), false),
            captcha_seen: SharedStorage::new(BTreeSet::from([me]), false),
            roles: AccessControl::new(me),
        }
    }

    // ── Forms ───────────────────────────────────────────────────────────────

    /// Creates a form with no fields, open, and returns its id. Team only.
    pub fn create_form(&mut self, title: String, description: String) -> app::Result<String> {
        self.only_team()?;
        let title = title.trim().to_owned();
        let description = description.trim().to_owned();
        check("title", &title, MAX_TITLE, true)?;
        check("description", &description, MAX_DESCRIPTION, false)?;
        let forms = self.forms.get_mut().map_err(store_err("forms.get_mut"))?;
        if forms.len().map_err(store_err("forms.len"))? >= MAX_FORMS {
            return Err(AppError::msg(format!(
                "a workspace has at most {MAX_FORMS} forms"
            )));
        }
        let id = random_id(8);
        if forms.contains(&id).map_err(store_err("forms.contains"))? {
            return Err(AppError::msg("form id collision; create it again"));
        }
        let now = env::time_now();
        let form = Form {
            title: LwwRegister::new(title),
            description: LwwRegister::new(description),
            fields: LwwRegister::new(Vec::new()),
            open: LwwRegister::new(true),
            crm: LwwRegister::new(CrmLink::default()),
            public: LwwRegister::new(false),
            link_cap: LwwRegister::new(DEFAULT_LINK_CAP),
            captcha_key: LwwRegister::new(String::new()),
            created_at: LwwRegister::new(now),
            created_by: LwwRegister::new(me().to_string()),
            updated_at: LwwRegister::new(now),
        };
        let _previous = forms
            .insert(id.clone(), form)
            .map_err(store_err("forms.insert"))?;
        app::emit!(Event::FormChanged { id: &id });
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
            if *form.title.get() != title {
                form.title.set(title);
            }
            if *form.description.get() != description {
                form.description.set(description);
            }
            if *form.fields.get() != fields {
                form.fields.set(fields);
            }
            Ok(())
        })
    }

    /// Opens or closes a form to new responses. Team only.
    pub fn set_form_open(&mut self, form_id: String, open: bool) -> app::Result<FormView> {
        self.only_team()?;
        self.edit_form(&form_id, |form| {
            form.open.set(open);
            Ok(())
        })
    }

    /// Where the form's responses go in Mero CRM, or `context_id` empty for
    /// nowhere. The mapped fields must be on the form. Team only.
    pub fn set_crm_link(&mut self, form_id: String, link: CrmLink) -> app::Result<FormView> {
        self.only_team()?;
        let link = CrmLink {
            context_id: link.context_id.trim().to_lowercase(),
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
            return Err(AppError::msg(
                "choose the field that holds the contact's name",
            ));
        }
        self.edit_form(&form_id, |form| {
            let ids: BTreeSet<&str> = form.fields.get().iter().map(|f| f.id.as_str()).collect();
            for f in [
                &link.name_field,
                &link.email_field,
                &link.phone_field,
                &link.organization_field,
                &link.title_field,
            ] {
                if !f.is_empty() && !ids.contains(f.as_str()) {
                    return Err(AppError::msg(format!("the form has no field {f:?}")));
                }
            }
            form.crm.set(link);
            Ok(())
        })
    }

    /// Deletes a form that has no responses. A form with responses is closed
    /// instead, so nothing anyone sent disappears. Team only.
    pub fn delete_form(&mut self, form_id: String) -> app::Result<()> {
        self.only_team()?;
        let _ = self.form(&form_id)?;
        for (_, response) in self
            .responses
            .entries()
            .map_err(store_err("responses.entries"))?
        {
            if response.get().form_id == form_id {
                return Err(AppError::msg(
                    "this form has responses; close it instead of deleting it",
                ));
            }
        }
        let links = self.links.get_mut().map_err(store_err("links.get_mut"))?;
        let gone: Vec<String> = links
            .entries()
            .map_err(store_err("links.entries"))?
            .filter(|(_, row)| *row.form_id.get() == form_id)
            .map(|(id, _)| id)
            .collect();
        for id in gone {
            let _removed = links.remove(&id).map_err(store_err("links.remove"))?;
        }
        let _removed = self
            .forms
            .get_mut()
            .map_err(store_err("forms.get_mut"))?
            .remove(&form_id)
            .map_err(store_err("forms.remove"))?;
        app::emit!(Event::FormChanged { id: &form_id });
        Ok(())
    }

    /// One form. Any member, form keys included: a website may read the
    /// questions it is about to answer.
    pub fn get_form(&self, form_id: String) -> app::Result<FormView> {
        let forms = self.forms.get().map_err(store_err("forms.get"))?;
        let form = forms
            .get(&form_id)
            .map_err(store_err("forms.get"))?
            .ok_or_else(|| AppError::msg(format!("no form {form_id}")))?;
        Ok(form_view(form_id, &form))
    }

    /// Every form, newest first, with its response counts. Team only.
    pub fn list_forms(&self) -> app::Result<Vec<FormSummary>> {
        self.only_team()?;
        let triage = self.triage.get().map_err(store_err("triage.get"))?;
        let mut counts: BTreeMap<String, (u32, u32, u64)> = BTreeMap::new();
        for (id, response) in self
            .responses
            .entries()
            .map_err(store_err("responses.entries"))?
        {
            let response = response.get();
            let state = triage.get(&id).map_err(store_err("triage.get"))?;
            let handled = state
                .as_deref()
                .is_some_and(|s| *s.archived.get() || !s.crm_deal.get().is_empty());
            let entry = counts.entry(response.form_id.clone()).or_insert((0, 0, 0));
            entry.0 += 1;
            if !handled {
                entry.1 += 1;
            }
            entry.2 = entry.2.max(response.created_at);
        }
        let forms = self.forms.get().map_err(store_err("forms.get"))?;
        let mut out = Vec::new();
        for (id, form) in forms.entries().map_err(store_err("forms.entries"))? {
            let (responses, new_responses, last_response_at) =
                counts.get(&id).copied().unwrap_or((0, 0, 0));
            out.push(FormSummary {
                title: form.title.get().clone(),
                description: form.description.get().clone(),
                open: *form.open.get(),
                fields: u32::try_from(form.fields.get().len()).unwrap_or(u32::MAX),
                responses,
                new_responses,
                last_response_at,
                created_at: *form.created_at.get(),
                id,
            });
        }
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        Ok(out)
    }

    /// The kinds of field a form can ask for.
    pub fn field_kinds(&self) -> app::Result<Vec<String>> {
        Ok(FIELD_KINDS.iter().map(|k| (*k).to_owned()).collect())
    }

    // ── Responses ───────────────────────────────────────────────────────────

    /// Stores a response to an open form and returns its id. What a website's
    /// backend calls with its form key; a teammate may also enter one.
    ///
    /// Every answer is checked against its field. Answers for fields the form
    /// does not have are refused, so a stale website fails loudly. A form key
    /// may only answer the form it was issued for. Emits `Submitted` with ids
    /// only.
    pub fn submit_response(
        &mut self,
        form_id: String,
        answers: Vec<AnswerInput>,
        source: String,
    ) -> app::Result<String> {
        let caller = me();
        let keys = self.form_keys.get().map_err(store_err("form_keys.get"))?;
        if let Some(key) = keys
            .get(&caller.to_string())
            .map_err(store_err("form_keys.get"))?
        {
            if *key.form_id.get() != form_id {
                return Err(AppError::msg("this form key is for another form"));
            }
        }
        let form = self.form(&form_id)?;
        let source = source.trim().to_owned();
        check("source", &source, MAX_SOURCE, false)?;
        self.store_response(&form_id, &form, answers, source, String::new())
    }

    // ── Public links ────────────────────────────────────────────────────────

    /// Lets the form's public links take responses, or stops them all.
    /// Team only. Links are kept either way.
    pub fn set_form_public(&mut self, form_id: String, public: bool) -> app::Result<FormView> {
        self.only_team()?;
        self.edit_form(&form_id, |form| {
            form.public.set(public);
            Ok(())
        })
    }

    /// How many responses each of the form's links may send per hour. Team only.
    pub fn set_link_cap(&mut self, form_id: String, per_hour: u32) -> app::Result<FormView> {
        self.only_team()?;
        if per_hour == 0 || per_hour > MAX_LINK_CAP {
            return Err(AppError::msg(format!(
                "a link may send between 1 and {MAX_LINK_CAP} responses per hour"
            )));
        }
        self.edit_form(&form_id, |form| {
            form.link_cap.set(per_hour);
            Ok(())
        })
    }

    /// Requires a captcha pass signed by `key` (an ed25519 public key, hex)
    /// on every response through the form's links, or none when `key` is
    /// empty. Team only.
    pub fn set_captcha_key(&mut self, form_id: String, key: String) -> app::Result<FormView> {
        self.only_team()?;
        let key = key.trim().to_lowercase();
        if !key.is_empty() && decode_fixed::<32>(&key).is_none() {
            return Err(AppError::msg("the captcha key must be 32 bytes of hex"));
        }
        self.edit_form(&form_id, |form| {
            form.captcha_key.set(key);
            Ok(())
        })
    }

    /// Records a public link for `form_id`: `link` is the SHA-256 (hex) of
    /// the access grant's token, `grant_id` the grant on the caller's node.
    /// Team only.
    pub fn create_link(
        &mut self,
        form_id: String,
        link: String,
        grant_id: String,
        label: String,
    ) -> app::Result<LinkView> {
        self.only_team()?;
        let link = link.trim().to_lowercase();
        if link.len() != LINK_ID_HEX || decode_fixed::<32>(&link).is_none() {
            return Err(AppError::msg(
                "a link id is the SHA-256 of its token, in hex",
            ));
        }
        let grant_id = grant_id.trim().to_owned();
        check("grant id", &grant_id, MAX_GRANT_ID, true)?;
        let label = label.trim().to_owned();
        check("label", &label, MAX_KEY_LABEL, false)?;
        let _ = self.form(&form_id)?;
        let links = self.links.get_mut().map_err(store_err("links.get_mut"))?;
        if links.contains(&link).map_err(store_err("links.contains"))? {
            return Err(AppError::msg("this link already exists"));
        }
        let row = Link {
            form_id: LwwRegister::new(form_id),
            label: LwwRegister::new(label),
            grant_id: LwwRegister::new(grant_id),
            created_at: LwwRegister::new(env::time_now()),
            created_by: LwwRegister::new(me().to_string()),
        };
        let view = link_view(link.clone(), &row, (0, 0, 0));
        let _previous = links.insert(link, row).map_err(store_err("links.insert"))?;
        Ok(view)
    }

    /// Stops a public link and returns what it was, so the app can revoke its
    /// grant on the node that holds it. Team only.
    pub fn delete_link(&mut self, link: String) -> app::Result<LinkView> {
        self.only_team()?;
        let link = link.trim().to_lowercase();
        let row = self
            .links
            .get_mut()
            .map_err(store_err("links.get_mut"))?
            .remove(&link)
            .map_err(store_err("links.remove"))?
            .ok_or_else(|| AppError::msg("no such link"))?;
        let counts = self.link_counts(&link)?;
        Ok(link_view(link, &row, counts))
    }

    /// The form's public links, newest first, with what each has sent. Team only.
    pub fn list_links(&self, form_id: String) -> app::Result<Vec<LinkView>> {
        self.only_team()?;
        let links = self.links.get().map_err(store_err("links.get"))?;
        let mut views = Vec::new();
        for (id, row) in links.entries().map_err(store_err("links.entries"))? {
            if *row.form_id.get() != form_id {
                continue;
            }
            let counts = self.link_counts(&id)?;
            views.push(link_view(id, &row, counts));
        }
        views.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        Ok(views)
    }

    /// The form a public link is for, as its visitor sees it. One of the two
    /// methods a link's grant names.
    pub fn link_form(&self, link: String) -> app::Result<LinkFormView> {
        let (form_id, _) = self.link(&link)?;
        let form = self.form(&form_id)?;
        Ok(LinkFormView {
            form_id,
            title: form.title.get().clone(),
            description: form.description.get().clone(),
            fields: form.fields.get().clone(),
            accepting: *form.open.get() && *form.public.get(),
            captcha: !form.captcha_key.get().is_empty(),
        })
    }

    /// Stores a response that came through a public link and returns its id.
    /// The other method a link's grant names.
    ///
    /// Refused unless the form is open and public, the link is under its
    /// hourly cap, and, when the form asks for one, `captcha` is a pass the
    /// form's verifier signed for this form and link, unexpired and unused.
    pub fn submit_via_link(
        &mut self,
        link: String,
        answers: Vec<AnswerInput>,
        captcha: Option<CaptchaPass>,
    ) -> app::Result<String> {
        let link = link.trim().to_lowercase();
        let (form_id, label) = self.link(&link)?;
        let form = self.form(&form_id)?;
        if !*form.public.get() {
            return Err(AppError::msg(
                "this form is not taking responses from links",
            ));
        }
        if !*form.open.get() {
            return Err(AppError::msg("this form is closed"));
        }
        let (_, last_hour, _) = self.link_counts(&link)?;
        if last_hour >= *form.link_cap.get() {
            return Err(AppError::msg(
                "this link has taken as many responses as it may this hour; try again later",
            ));
        }
        let key = form.captcha_key.get().clone();
        if !key.is_empty() {
            let pass = captcha.ok_or_else(|| AppError::msg("this form needs a captcha"))?;
            self.spend_pass(&key, &form_id, &link, pass)?;
        }
        let source = if label.is_empty() {
            "public link".to_owned()
        } else {
            format!("public link · {label}")
        };
        self.store_response(&form_id, &form, answers, source, link)
    }
    /// A form's responses, newest first. Team only.
    pub fn list_responses(&self, form_id: String) -> app::Result<Vec<ResponseView>> {
        self.only_team()?;
        let triage = self.triage.get().map_err(store_err("triage.get"))?;
        let mut out = Vec::new();
        for (id, response) in self
            .responses
            .entries()
            .map_err(store_err("responses.entries"))?
        {
            let response = response.get();
            if response.form_id != form_id {
                continue;
            }
            let state = triage.get(&id).map_err(store_err("triage.get"))?;
            out.push(response_view(id, response.clone(), state.as_deref()));
        }
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        Ok(out)
    }

    /// One response. Team only.
    pub fn get_response(&self, id: String) -> app::Result<ResponseView> {
        self.only_team()?;
        let response = self.response(&id)?;
        let triage = self.triage.get().map_err(store_err("triage.get"))?;
        let state = triage.get(&id).map_err(store_err("triage.get"))?;
        Ok(response_view(id, response, state.as_deref()))
    }

    /// Archives a response, or brings it back. Team only.
    pub fn set_archived(&mut self, id: String, archived: bool) -> app::Result<ResponseView> {
        self.only_team()?;
        self.edit_state(id, |state| {
            state.archived.set(archived);
            Ok(())
        })
    }

    /// Records the CRM deal a response became, after the app created it in
    /// that CRM context. Team only. Refuses a response this node already
    /// knows was sent; two teammates sending the same response at the same
    /// moment from two nodes can still both create a deal, and the later
    /// record wins here.
    pub fn record_crm_deal(
        &mut self,
        id: String,
        crm_context: String,
        crm_deal: String,
    ) -> app::Result<ResponseView> {
        self.only_team()?;
        let crm_context = crm_context.trim().to_lowercase();
        let crm_deal = crm_deal.trim().to_owned();
        check("CRM context", &crm_context, MAX_ID, true)?;
        check("CRM deal", &crm_deal, MAX_ID, true)?;
        let now = env::time_now();
        let by = me().to_string();
        self.edit_state(id, |state| {
            if !state.crm_deal.get().is_empty() {
                return Err(AppError::msg("this response was already sent to the CRM"));
            }
            state.crm_context.set(crm_context);
            state.crm_deal.set(crm_deal);
            state.crm_sent_at.set(now);
            state.crm_sent_by.set(by);
            Ok(())
        })
    }

    // ── Team ────────────────────────────────────────────────────────────────

    /// The team: the admins and the `team` role. Team only.
    pub fn list_team(&self) -> app::Result<Vec<TeamMember>> {
        self.only_team()?;
        let admins = self.roles.admins();
        let mut members: BTreeMap<String, bool> =
            admins.iter().map(|a| (a.to_string(), true)).collect();
        for account in self
            .roles
            .members_of(TEAM)
            .map_err(store_err("roles.members_of"))?
        {
            let _ = members.entry(account.to_string()).or_insert(false);
        }
        Ok(members
            .into_iter()
            .map(|(account, admin)| TeamMember { account, admin })
            .collect())
    }

    /// Adds `who` to the team. Admin only, enforced at merge.
    pub fn add_team_member(&mut self, who: String) -> app::Result<()> {
        self.only_admin()?;
        let who = parse_account("who", &who)?;
        let keys = self.form_keys.get().map_err(store_err("form_keys.get"))?;
        if keys
            .contains(&who.to_string())
            .map_err(store_err("form_keys.contains"))?
        {
            return Err(AppError::msg("a form key cannot join the team"));
        }
        self.roles
            .grant(TEAM, who)
            .map_err(store_err("roles.grant"))?;
        self.sync_team_writers()
    }

    /// Removes `who` from the team. Admin only, enforced at merge.
    pub fn remove_team_member(&mut self, who: String) -> app::Result<()> {
        self.only_admin()?;
        let who = parse_account("who", &who)?;
        self.roles
            .revoke(TEAM, &who)
            .map_err(store_err("roles.revoke"))?;
        self.sync_team_writers()
    }

    /// The workspace's display name, or empty. Anyone in the context may read it.
    pub fn workspace_name(&self) -> app::Result<String> {
        let settings = self.settings.get().map_err(store_err("settings.get"))?;
        Ok(settings
            .get(WORKSPACE_NAME)
            .map_err(store_err("settings.get"))?
            .map(|v| v.get().clone())
            .unwrap_or_default())
    }

    /// Names the workspace. Team only.
    pub fn set_workspace_name(&mut self, name: String) -> app::Result<()> {
        self.only_team()?;
        let name = name.trim().to_owned();
        check("name", &name, MAX_TITLE, false)?;
        let _previous = self
            .settings
            .get_mut()
            .map_err(store_err("settings.get_mut"))?
            .insert(WORKSPACE_NAME.to_owned(), LwwRegister::new(name))
            .map_err(store_err("settings.insert"))?;
        Ok(())
    }

    // ── Form keys ───────────────────────────────────────────────────────────

    /// Records `account` as a website form key for `form_id`, called `label`.
    /// Admin only.
    ///
    /// The app calls this after it has made the account a member of the
    /// namespace; the register is what binds it to one form and labels it.
    pub fn register_form_key(
        &mut self,
        account: String,
        form_id: String,
        label: String,
    ) -> app::Result<()> {
        self.only_admin()?;
        let account = parse_account("account", &account)?;
        let label = label.trim().to_owned();
        check("label", &label, MAX_KEY_LABEL, true)?;
        if self.is_team(&account)? {
            return Err(AppError::msg("a teammate cannot be a form key"));
        }
        let _ = self.form(&form_id)?;
        let key = FormKey {
            label: LwwRegister::new(label),
            form_id: LwwRegister::new(form_id),
            created_at: LwwRegister::new(env::time_now()),
            created_by: LwwRegister::new(me().to_string()),
        };
        let _previous = self
            .form_keys
            .get_mut()
            .map_err(store_err("form_keys.get_mut"))?
            .insert(account.to_string(), key)
            .map_err(store_err("form_keys.insert"))?;
        Ok(())
    }

    /// Drops `account` from the register. Admin only. Removing its membership
    /// is what actually stops it writing; the app does both.
    pub fn forget_form_key(&mut self, account: String) -> app::Result<()> {
        self.only_admin()?;
        let account = parse_account("account", &account)?;
        let _removed = self
            .form_keys
            .get_mut()
            .map_err(store_err("form_keys.get_mut"))?
            .remove(&account.to_string())
            .map_err(store_err("form_keys.remove"))?;
        Ok(())
    }

    /// The registered form keys, newest first, with what each has sent. Admin
    /// only.
    pub fn list_form_keys(&self) -> app::Result<Vec<FormKeyView>> {
        self.only_admin()?;
        let mut sent: BTreeMap<String, (u32, u64)> = BTreeMap::new();
        for (_, response) in self
            .responses
            .entries()
            .map_err(store_err("responses.entries"))?
        {
            let response = response.get();
            let entry = sent.entry(response.submitted_by.clone()).or_insert((0, 0));
            entry.0 += 1;
            entry.1 = entry.1.max(response.created_at);
        }
        let keys = self.form_keys.get().map_err(store_err("form_keys.get"))?;
        let mut views = Vec::new();
        for (account, key) in keys.entries().map_err(store_err("form_keys.entries"))? {
            let (responses, last_response_at) = sent.get(&account).copied().unwrap_or((0, 0));
            views.push(FormKeyView {
                label: key.label.get().clone(),
                form_id: key.form_id.get().clone(),
                created_at: *key.created_at.get(),
                created_by: key.created_by.get().clone(),
                responses,
                last_response_at,
                account,
            });
        }
        views.sort_by_key(|v| std::cmp::Reverse(v.created_at));
        Ok(views)
    }

    // ── Identity ────────────────────────────────────────────────────────────

    /// Whether the caller is on the team.
    pub fn am_i_team(&self) -> app::Result<bool> {
        self.is_team(&me())
    }

    /// Whether the caller is an admin.
    pub fn am_i_admin(&self) -> app::Result<bool> {
        Ok(self.roles.is_admin(&me()))
    }

    /// The caller's account, as hex.
    pub fn my_account(&self) -> app::Result<String> {
        Ok(me().to_string())
    }
}

fn form_view(id: String, form: &Form) -> FormView {
    FormView {
        id,
        title: form.title.get().clone(),
        description: form.description.get().clone(),
        fields: form.fields.get().clone(),
        open: *form.open.get(),
        crm: form.crm.get().clone(),
        public: *form.public.get(),
        link_cap: *form.link_cap.get(),
        captcha_key: form.captcha_key.get().clone(),
        created_at: *form.created_at.get(),
        created_by: form.created_by.get().clone(),
        updated_at: *form.updated_at.get(),
    }
}

fn link_view(
    id: String,
    row: &Link,
    (responses, last_hour, last_response_at): (u32, u32, u64),
) -> LinkView {
    LinkView {
        id,
        form_id: row.form_id.get().clone(),
        label: row.label.get().clone(),
        grant_id: row.grant_id.get().clone(),
        created_at: *row.created_at.get(),
        created_by: row.created_by.get().clone(),
        responses,
        last_hour,
        last_response_at,
    }
}

/// What a captcha pass signs. The verifier builds the same string.
pub fn captcha_message(form_id: &str, link: &str, nonce: &str, expires_ms: u64) -> String {
    format!("mero-forms/captcha/v1|{form_id}|{link}|{nonce}|{expires_ms}")
}

fn decode_fixed<const N: usize>(value: &str) -> Option<[u8; N]> {
    hex::decode(value).ok()?.try_into().ok()
}

#[cfg(target_arch = "wasm32")]
fn verify_signature(signature: &[u8; 64], public_key: &[u8; 32], message: &[u8]) -> bool {
    env::ed25519_verify(signature, public_key, message)
}

/// The test host has no ed25519; tests decide the verdict (see tests.rs).
#[cfg(not(target_arch = "wasm32"))]
fn verify_signature(signature: &[u8; 64], public_key: &[u8; 32], message: &[u8]) -> bool {
    tests_support::verify(signature, public_key, message)
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) mod tests_support {
    use std::cell::RefCell;

    type Verifier = fn(&[u8; 64], &[u8; 32], &[u8]) -> bool;

    thread_local! {
        static VERIFIER: RefCell<Option<Verifier>> = const { RefCell::new(None) };
    }

    /// Which signatures the test host accepts. Unset, it accepts none.
    #[cfg(test)]
    pub(crate) fn set_verifier(verifier: Verifier) {
        VERIFIER.with(|v| *v.borrow_mut() = Some(verifier));
    }

    pub(crate) fn verify(signature: &[u8; 64], public_key: &[u8; 32], message: &[u8]) -> bool {
        VERIFIER.with(|v| {
            v.borrow()
                .is_some_and(|f| f(signature, public_key, message))
        })
    }
}

fn response_view(id: String, r: Response, s: Option<&ResponseState>) -> ResponseView {
    ResponseView {
        id,
        form_id: r.form_id,
        answers: r.answers,
        source: r.source,
        created_at: r.created_at,
        submitted_by: r.submitted_by,
        link: r.link,
        archived: s.is_some_and(|s| *s.archived.get()),
        crm_context: s.map(|s| s.crm_context.get().clone()).unwrap_or_default(),
        crm_deal: s.map(|s| s.crm_deal.get().clone()).unwrap_or_default(),
        crm_sent_at: s.map(|s| *s.crm_sent_at.get()).unwrap_or(0),
        crm_sent_by: s.map(|s| s.crm_sent_by.get().clone()).unwrap_or_default(),
    }
}

impl Form {
    /// A copy that keeps each register's own clock, so setting one part does
    /// not stamp the others as new.
    fn clone_registers(&self) -> Form {
        Form {
            title: self.title.clone(),
            description: self.description.clone(),
            fields: self.fields.clone(),
            open: self.open.clone(),
            crm: self.crm.clone(),
            public: self.public.clone(),
            link_cap: self.link_cap.clone(),
            captcha_key: self.captcha_key.clone(),
            created_at: self.created_at.clone(),
            created_by: self.created_by.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

impl ResponseState {
    fn fresh() -> ResponseState {
        ResponseState {
            archived: LwwRegister::new(false),
            crm_context: LwwRegister::new(String::new()),
            crm_deal: LwwRegister::new(String::new()),
            crm_sent_at: LwwRegister::new(0),
            crm_sent_by: LwwRegister::new(String::new()),
        }
    }

    fn clone_registers(&self) -> ResponseState {
        ResponseState {
            archived: self.archived.clone(),
            crm_context: self.crm_context.clone(),
            crm_deal: self.crm_deal.clone(),
            crm_sent_at: self.crm_sent_at.clone(),
            crm_sent_by: self.crm_sent_by.clone(),
        }
    }
}

impl MeroForms {
    /// Checks every answer against the form and stores the response.
    fn store_response(
        &mut self,
        form_id: &str,
        form: &Form,
        answers: Vec<AnswerInput>,
        source: String,
        link: String,
    ) -> app::Result<String> {
        if !*form.open.get() {
            return Err(AppError::msg("this form is closed"));
        }
        let mut given: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for answer in answers {
            let id = answer.field_id.trim().to_owned();
            if given.insert(id.clone(), answer.values).is_some() {
                return Err(AppError::msg(format!("field {id:?} was answered twice")));
            }
        }
        let fields = form.fields.get();
        if fields.is_empty() {
            return Err(AppError::msg("this form has no fields yet"));
        }
        let mut stored = Vec::with_capacity(fields.len());
        for field in fields {
            let values = check_answer(field, given.remove(&field.id).unwrap_or_default())?;
            stored.push(Answer {
                field_id: field.id.clone(),
                label: field.label.clone(),
                kind: field.kind.clone(),
                values,
            });
        }
        if let Some(unknown) = given.keys().next() {
            return Err(AppError::msg(format!("the form has no field {unknown:?}")));
        }

        let id = random_id(16);
        if self
            .responses
            .contains(&id)
            .map_err(store_err("responses.contains"))?
        {
            return Err(AppError::msg("response id collision; submit again"));
        }
        let response = Response {
            form_id: form_id.to_owned(),
            answers: stored,
            source,
            created_at: env::time_now(),
            submitted_by: me().to_string(),
            link,
        };
        self.responses
            .insert(id.clone(), LwwRegister::new(response))
            .map_err(store_err("responses.insert"))?;
        app::emit!(Event::Submitted { id: &id, form_id });
        Ok(id)
    }

    /// The form a link is for, and its label.
    fn link(&self, link: &str) -> app::Result<(String, String)> {
        let links = self.links.get().map_err(store_err("links.get"))?;
        let row = links
            .get(&link.trim().to_lowercase())
            .map_err(store_err("links.get"))?
            .ok_or_else(|| AppError::msg("this link no longer works"))?;
        Ok((row.form_id.get().clone(), row.label.get().clone()))
    }

    /// A link's responses: in all, in the last hour, and the latest one's time.
    fn link_counts(&self, link: &str) -> app::Result<(u32, u32, u64)> {
        let since = env::time_now().saturating_sub(HOUR_NS);
        let (mut all, mut hour, mut last) = (0u32, 0u32, 0u64);
        for (_, response) in self
            .responses
            .entries()
            .map_err(store_err("responses.entries"))?
        {
            let response = response.get();
            if response.link != link {
                continue;
            }
            all += 1;
            if response.created_at >= since {
                hour += 1;
            }
            last = last.max(response.created_at);
        }
        Ok((all, hour, last))
    }

    /// Checks a captcha pass and records its nonce as spent, dropping spent
    /// nonces that have expired.
    fn spend_pass(
        &mut self,
        key: &str,
        form_id: &str,
        link: &str,
        pass: CaptchaPass,
    ) -> app::Result<()> {
        let nonce = pass.nonce.trim().to_lowercase();
        if nonce.len() != PASS_NONCE_HEX || hex::decode(&nonce).is_err() {
            return Err(AppError::msg("the captcha pass is malformed"));
        }
        let now_ms = env::time_now() / 1_000_000;
        if pass.expires_ms < now_ms {
            return Err(AppError::msg("the captcha has expired; solve it again"));
        }
        if pass.expires_ms > now_ms + MAX_PASS_MS {
            return Err(AppError::msg("the captcha pass is valid for too long"));
        }
        let (Some(signature), Some(public_key)) = (
            decode_fixed::<64>(pass.signature.trim()),
            decode_fixed::<32>(key),
        ) else {
            return Err(AppError::msg("the captcha pass is malformed"));
        };
        let message = captcha_message(form_id, link, &nonce, pass.expires_ms);
        if !verify_signature(&signature, &public_key, message.as_bytes()) {
            return Err(AppError::msg("the captcha pass is not valid for this form"));
        }
        let seen = self
            .captcha_seen
            .get_mut()
            .map_err(store_err("captcha_seen.get_mut"))?;
        if seen
            .contains(&nonce)
            .map_err(store_err("captcha_seen.contains"))?
        {
            return Err(AppError::msg(
                "this captcha was already used; solve it again",
            ));
        }
        let expired: Vec<String> = seen
            .entries()
            .map_err(store_err("captcha_seen.entries"))?
            .filter(|(_, expiry)| *expiry.get() < now_ms)
            .map(|(n, _)| n)
            .collect();
        for n in expired {
            let _removed = seen.remove(&n).map_err(store_err("captcha_seen.remove"))?;
        }
        let _previous = seen
            .insert(nonce, LwwRegister::new(pass.expires_ms))
            .map_err(store_err("captcha_seen.insert"))?;
        Ok(())
    }

    fn is_team(&self, who: &AccountId) -> app::Result<bool> {
        Ok(self.roles.is_admin(who)
            || self
                .roles
                .has_role(TEAM, who)
                .map_err(store_err("roles.has_role"))?)
    }

    fn only_team(&self) -> app::Result<()> {
        if !self.is_team(&me())? {
            return Err(AppError::msg("only the team may do this"));
        }
        Ok(())
    }

    fn only_admin(&self) -> app::Result<()> {
        if !self.roles.is_admin(&me()) {
            return Err(AppError::msg("only an admin may do this"));
        }
        Ok(())
    }

    /// `forms`, `triage` and `settings` are writable by exactly the admins and
    /// the `team` role.
    fn sync_team_writers(&mut self) -> app::Result<()> {
        let mut writers = self.roles.admins();
        writers.extend(
            self.roles
                .members_of(TEAM)
                .map_err(store_err("roles.members_of"))?,
        );
        self.forms
            .rotate_writers(writers.clone())
            .map_err(store_err("forms.rotate_writers"))?;
        self.triage
            .rotate_writers(writers.clone())
            .map_err(store_err("triage.rotate_writers"))?;
        self.settings
            .rotate_writers(writers.clone())
            .map_err(store_err("settings.rotate_writers"))?;
        self.links
            .rotate_writers(writers.clone())
            .map_err(store_err("links.rotate_writers"))?;
        self.captcha_seen
            .rotate_writers(writers)
            .map_err(store_err("captcha_seen.rotate_writers"))?;
        Ok(())
    }

    fn form(&self, id: &str) -> app::Result<Form> {
        let forms = self.forms.get().map_err(store_err("forms.get"))?;
        let form = forms
            .get(id)
            .map_err(store_err("forms.get"))?
            .ok_or_else(|| AppError::msg(format!("no form {id}")))?;
        Ok(form.clone_registers())
    }

    fn edit_form(
        &mut self,
        id: &str,
        change: impl FnOnce(&mut Form) -> app::Result<()>,
    ) -> app::Result<FormView> {
        let mut form = self.form(id)?;
        change(&mut form)?;
        form.updated_at.set(env::time_now());
        let view = form_view(id.to_owned(), &form);
        let _previous = self
            .forms
            .get_mut()
            .map_err(store_err("forms.get_mut"))?
            .insert(id.to_owned(), form)
            .map_err(store_err("forms.insert"))?;
        app::emit!(Event::FormChanged { id });
        Ok(view)
    }

    fn response(&self, id: &str) -> app::Result<Response> {
        self.responses
            .get(id)
            .map_err(store_err("responses.get"))?
            .map(|r| r.get().clone())
            .ok_or_else(|| AppError::msg(format!("no response {id}")))
    }

    fn edit_state(
        &mut self,
        id: String,
        change: impl FnOnce(&mut ResponseState) -> app::Result<()>,
    ) -> app::Result<ResponseView> {
        let response = self.response(&id)?;
        let triage = self.triage.get_mut().map_err(store_err("triage.get_mut"))?;
        let mut state = match triage.get(&id).map_err(store_err("triage.get"))? {
            Some(existing) => existing.clone_registers(),
            None => ResponseState::fresh(),
        };
        change(&mut state)?;
        let view = response_view(id.clone(), response, Some(&state));
        let _previous = triage
            .insert(id.clone(), state)
            .map_err(store_err("triage.insert"))?;
        app::emit!(Event::ResponseChanged { id: &id });
        Ok(view)
    }
}
