//! MeroSign: document signing, on core's component SDK (`calimero-app-sdk`).
//!
//! One component, two kinds of app instance, as in v1 (one contract, two kinds
//! of context):
//!
//! - **a personal library** (`setup(isPrivate: true, …)`): the account's saved
//!   signature images and the agreements it bookmarked. Only the app's owner
//!   reads or writes it.
//! - **an agreement** (`setup(isPrivate: false, name)`), created in a workspace
//!   (an organization): its participants and their permission levels, the
//!   documents to sign, each participant's consent and each signature.
//!
//! v1 took the kind and name as `init` arguments; the runtime runs `init` with
//! none, so the creator calls `setup` once, right after creating the instance.
//!
//! # One log, plain data
//!
//! The app runs on its cluster's leader, which applies every write in one
//! replicated log. v1's CRDT plumbing (LWW merge rules, the tie-break on the
//! borsh encoding, per-owner keys and the "lowest holder" pick, the fork rule
//! for two signers racing on one version) has nothing left to decide:
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `Frozen<bool>` / `Frozen<String>` `is_private`, `context_name` | `config: Cell<Config>`, written once by `setup` |
//! | `Frozen<UserId>` `owner` | the app's owner (`env::app_owner()`) |
//! | `UnorderedMap<String, SignatureRecord>` (random 53-bit ids) | `signatures: UnorderedMap<u64, SignatureRecord>`, ids from `nextSignatureId: Counter` |
//! | `UnorderedMap<String, ContextMetadata>` + `identity_mappings` | `joinedContexts: UnorderedMap<String, ContextMetadata>`; one account is the same identity in every app, so there is no mapping |
//! | `AccessControl` (admin tier, `signer`/`viewer`/`removed` roles) + `UserStorage` self-registrations | `participants: Table<Participant>` (a `perLevel` count) + `removed: Set<String>` |
//! | `ModeratedOnce<UnorderedMap<String, StoredDocument>>` | `documents: UnorderedMap<String, StoredDocument>` (written once) + `progress: UnorderedMap<String, Progress>` |
//! | `StoredDocument.chunks: Option<Vec<DocumentChunk>>` | `chunks: UnorderedMap<(document, n), DocumentChunk>` |
//! | `WriteOnce<SortedMap<"doc/signer/nonce", SignedVersion>>` | `documentSignatures: UnorderedMap<(document, signer), SignedVersion>`: one row per signature |
//! | `UserStorage<Consents>` | `consents: UnorderedMap<(document, account), u64>` |
//! | blob ids (`[u8; 32]`) + `blob_announce_to_context` | `BlobRef`: the host keeps a blob while state refers to it |
//!
//! # Who may do what
//!
//! v1 enforced its write rules in storage, so a member running a modified node
//! could not write around the methods. Every write here goes through a method,
//! so each rule is a check against `env::caller()` before anything is written:
//!
//! | rule | methods | refused with |
//! |---|---|---|
//! | the app's owner, once | `setup` | `Forbidden`, `AlreadySetUp` |
//! | the app's owner, personal library only | `createSignature`, `deleteSignature`, `listSignatures`, `joinSharedContext`, `leaveSharedContext`, `listJoinedContexts` | `Forbidden`, `WrongContext` |
//! | Admin | `addParticipant`, `removeParticipant`, `setParticipantPermission`, `deleteDocument` | `Forbidden` |
//! | Sign or Admin | `uploadDocument`, `signDocument` (+ a passkey confirmation) | `Forbidden` |
//! | any participant | `listDocuments`, `getDocumentSignatures`, `documentDownload`, `searchDocumentByEmbedding`, `setConsent` | `Forbidden` |
//! | not removed by an admin | `registerSelfAsParticipant` | `Forbidden` |
//!
//! The signer of a signature, the uploader of a document, the giver of a
//! consent and the registrant of a participation are the caller's account,
//! written by the method: nobody can write one in someone else's name, which is
//! what v1's owner stamps and `UserStorage` slots guaranteed.
//!
//! Everything a client sees differently from v1 is listed in
//! `apps/mero-sign/README.md`, "What changed in the port".

use calimero_app_sdk::prelude::*;
use serde::{Deserialize, Serialize};

/// The most rows one page answers.
const PAGE: u32 = 1000;
/// A page's size when the caller names none.
const DEFAULT_PAGE: u32 = 100;

/// The most participants an agreement holds (admins included). Bounds every
/// per-call read of the participants and the signer list a document keeps.
pub const MAX_PARTICIPANTS: u64 = 256;
/// The most search chunks one document carries.
pub const MAX_CHUNKS: usize = 200;
/// The most dimensions an embedding has (the browser's model gives 512).
pub const MAX_EMBEDDING_DIM: usize = 2048;
/// The most bytes of extracted text one document keeps.
pub const MAX_TEXT_BYTES: usize = 64 * 1024;
/// The longest name (a document's, a signature's, an agreement's), in bytes.
pub const MAX_NAME_BYTES: usize = 512;
/// The longest account or app id this app stores, in bytes: they are parts of
/// storage keys, which the node caps at 1 KiB.
pub const MAX_ID_BYTES: usize = 256;
/// How long a download grant lasts, in seconds.
pub const GRANT_TTL_SECS: u32 = 3600;

pub const LEVEL_ADMIN: &str = "Admin";
pub const LEVEL_SIGN: &str = "Sign";
pub const LEVEL_READ: &str = "Read";

fn rank(level: &str) -> u8 {
    match level {
        LEVEL_ADMIN => 2,
        LEVEL_SIGN => 1,
        _ => 0,
    }
}

// ── stored values ────────────────────────────────────────────────────────────

/// What `setup` fixed: the instance's kind and name. Never rewritten.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub is_private: bool,
    pub context_name: String,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub created_at: u64,
}

/// A saved signature image in the personal library: the image is the blob.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureRecord {
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub id: u64,
    pub name: String,
    pub blob_id: BlobRef,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub size: u64,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub created_at: u64,
}

/// An agreement bookmarked in the personal library.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMetadata {
    /// The agreement's app id.
    pub context_id: String,
    pub context_name: String,
    /// v1's `ParticipantRole`; always `Unknown` when bookmarked, as in v1.
    pub role: String,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub joined_at: u64,
}

/// A participant of an agreement and their level: `Admin`, `Sign` or `Read`.
#[derive(Record)]
#[table(key = "account", count(per_level = ["level"]))]
pub struct Participant {
    pub account: String,
    pub level: String,
    pub joined_at: u64,
    /// Registered themselves (`registerSelfAsParticipant`), rather than added
    /// by an admin.
    pub self_registered: bool,
}

/// A chunk of a document's text with its embedding, for
/// `searchDocumentByEmbedding`. Positions are character offsets (`u32`, so
/// plain JSON numbers, as in v1).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChunk {
    pub text: String,
    pub embedding: Vec<f32>,
    pub start_position: u32,
    pub end_position: u32,
}

/// A document as uploaded. Written once: nobody, the uploader included,
/// changes it afterwards; only an admin removes it. Signatures are recorded
/// beside it (`documentSignatures`), never by rewriting this.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredDocument {
    pub name: String,
    /// The SHA-256 of the uploaded PDF, 64 lowercase hex: the blob's id.
    pub hash: String,
    pub pdf_blob: BlobRef,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub size: u64,
    pub uploaded_by: String,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub uploaded_at: u64,
    /// Who must sign it: every participant holding `Sign` or `Admin` when it
    /// was uploaded. At most [`MAX_PARTICIPANTS`] (the participants' bound),
    /// fixed with the document, so completion is a fact about the past.
    pub required_signers: Vec<String>,
    /// At most [`MAX_EMBEDDING_DIM`] values.
    pub embeddings: Option<Vec<f32>>,
    /// At most [`MAX_TEXT_BYTES`].
    pub extracted_text: Option<String>,
    /// How many rows of `chunks` it has (at most [`MAX_CHUNKS`]).
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub chunk_count: u64,
}

/// A document's current version and its progress, rewritten by each signature.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// The current version: the last signature's, or the upload's.
    pub hash: String,
    pub pdf_blob: BlobRef,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub size: u64,
    /// Signatures so far; the next one's position.
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub signatures: u64,
    /// Of them, by a required signer.
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub required_signed: u64,
}

/// One signature: the signer took the version at `baseHash`, put their mark on
/// it, and produced the version at `newHash`, stored as `pdfBlob`. Written once.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedVersion {
    /// Its place in the document's signatures, from 0.
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub position: u64,
    pub base_hash: String,
    pub new_hash: String,
    pub pdf_blob: BlobRef,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub size: u64,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub signed_at: u64,
}

// ── results ──────────────────────────────────────────────────────────────────

/// One page of the signature library.
#[derive(Serialize)]
pub struct SignaturePage {
    pub items: Vec<SignatureRecord>,
    /// The cursor of the next page; null on the last.
    pub next: Option<String>,
}

/// One page of bookmarked agreements.
#[derive(Serialize)]
pub struct ContextPage {
    pub items: Vec<ContextMetadata>,
    pub next: Option<String>,
}

/// A participant and their level.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantInfo {
    pub user_id: String,
    pub permission_level: String,
}

/// The agreement (or library) as a whole.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDetails {
    /// This app's id.
    pub context_id: String,
    pub context_name: String,
    /// The app's owner.
    pub owner: String,
    pub is_private: bool,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub participant_count: u64,
    /// Every participant (at most [`MAX_PARTICIPANTS`]), in account order.
    pub participants: Vec<ParticipantInfo>,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub document_count: u64,
    /// When `setup` ran.
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
}

/// A document as read: its current version and its status, from its progress.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub id: String,
    pub name: String,
    /// The current version's SHA-256.
    pub hash: String,
    pub uploaded_by: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub uploaded_at: u64,
    /// `Pending`, `PartiallySigned` or `FullySigned`.
    pub status: String,
    /// The current version's blob id (64 hex).
    pub pdf_blob_id: BlobRef,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub size: u64,
    pub required_signers: Vec<String>,
    /// The uploaded version, before any signature.
    pub original_hash: String,
}

/// One page of documents.
#[derive(Serialize)]
pub struct DocumentPage {
    pub items: Vec<DocumentInfo>,
    pub next: Option<String>,
}

/// A signature on a document, as read.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSignature {
    pub signer: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub signed_at: u64,
}

/// A document's status alone: what a client polls while others sign.
#[derive(Serialize)]
pub struct DocumentState {
    pub status: String,
    /// The current version's SHA-256.
    pub hash: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub signatures: u64,
}

/// Where to fetch a document's current version.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDownload {
    pub blob_id: BlobRef,
    pub hash: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub size: u64,
    /// `GET /apps/{app}/blobs/{blobId}?grant=<grant>` downloads it, signed in
    /// or not, for [`GRANT_TTL_SECS`] seconds.
    pub grant: String,
}

fn status_of(doc: &StoredDocument, p: &Progress) -> &'static str {
    if p.signatures == 0 {
        "Pending"
    } else if p.required_signed >= doc.required_signers.len() as u64 {
        "FullySigned"
    } else {
        "PartiallySigned"
    }
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na * nb)
    }
}

/// `text` cut to at most `max` bytes on a character boundary, with `...` when cut.
fn snippet(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &text[..end])
}

fn clean(text: &str) -> String {
    text.trim().replace(['\n', '\r'], " ").replace("  ", " ")
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire. Most
/// carry v1's message as `message`.
#[app::error]
pub enum Error {
    /// `setup` has not run yet.
    NotSetUp,
    /// `setup` already ran.
    AlreadySetUp,
    /// A library method on an agreement, or the other way round.
    WrongContext { message: String },
    /// The caller may not do this.
    Forbidden { message: String },
    /// The document, signature, participant or bookmark does not exist.
    NotFound { message: String },
    /// A malformed or out-of-bounds argument.
    Invalid { message: String },
    /// The state does not allow it (already done, the last admin, full).
    Conflict { message: String },
    /// `signDocument` before `setConsent`.
    ConsentRequired { message: String },
    /// `signDocument` from a version that is no longer the current one.
    StaleVersion { message: String, current: String },
    /// The app holds no blob with this id: upload it first.
    BlobNotFound { blob_id: String },
    /// A hash that is not the blob's SHA-256.
    HashMismatch { expected: String, actual: String },
}

/// A change, emitted after the write that caused it. A library's events reach
/// its owner; an agreement's reach everyone the app reaches.
#[app::event]
pub enum Event {
    SignatureCreated {
        id: u64,
        name: String,
        size: u64,
    },
    SignatureDeleted {
        id: u64,
    },
    ContextJoined {
        context_id: String,
        context_name: String,
    },
    ContextLeft {
        context_id: String,
    },
    DocumentUploaded {
        id: String,
        name: String,
        uploaded_by: String,
    },
    DocumentDeleted {
        id: String,
    },
    DocumentSigned {
        document_id: String,
        signer: String,
    },
    ParticipantJoined {
        user_id: String,
    },
    ParticipantLeft {
        user_id: String,
    },
    /// An admin changed an existing participant's level.
    ParticipantPermissionChanged {
        user_id: String,
        permission: String,
    },
}

/// The state: one personal library, or one agreement.
#[app::state(version = 1)]
pub struct MeroSign {
    /// Set once by `setup`.
    config: Cell<Config>,

    // ── personal library ─────────────────────────────────────────────────
    /// Saved signature images by id.
    signatures: UnorderedMap<u64, SignatureRecord>,
    /// The last signature id handed out.
    next_signature_id: Counter,
    /// Bookmarked agreements by app id.
    joined_contexts: UnorderedMap<String, ContextMetadata>,

    // ── agreement ────────────────────────────────────────────────────────
    /// Participants by account, with a count per level.
    participants: Table<Participant>,
    /// Accounts an admin removed: they cannot register themselves again.
    removed: Set<String>,
    /// Documents by id, as uploaded.
    documents: UnorderedMap<String, StoredDocument>,
    /// Each document's current version and status.
    progress: UnorderedMap<String, Progress>,
    /// Each document's search chunks, by `(document, n)`.
    chunks: UnorderedMap<(String, u64), DocumentChunk>,
    /// One row per signature, by `(document, signer)`.
    document_signatures: UnorderedMap<(String, String), SignedVersion>,
    /// Consents to sign, by `(document, account)`: when it was given.
    consents: UnorderedMap<(String, String), u64>,
}

#[app::logic]
#[allow(clippy::too_many_arguments)]
impl MeroSign {
    /// The empty state. The creator then calls `setup`.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    /// Fixes what kind of instance this is, and its name: v1's `init(is_private,
    /// context_name)`. The app's owner only, once. An agreement's creator is its
    /// first Admin.
    pub fn setup(&mut self, is_private: bool, context_name: String) -> app::Result<()> {
        let me = caller_account()?;
        if me != env::app_owner() {
            return Err(forbidden("Only the app's owner can set it up"));
        }
        if self.config.get()?.is_some() {
            return Err(Error::AlreadySetUp.into());
        }
        check_len("contextName", &context_name, MAX_NAME_BYTES)?;
        self.config.set(&Config {
            is_private,
            context_name,
            created_at: env::time_now(),
        })?;
        if !is_private {
            self.participants.insert(Participant {
                account: me,
                level: LEVEL_ADMIN.to_owned(),
                joined_at: env::time_now(),
                self_registered: false,
            })?;
        }
        Ok(())
    }

    /// Whether this is the account's default personal library (`setup(true,
    /// "default")`). `false` before `setup`.
    #[app::view]
    pub fn is_default_private_context(&self) -> app::Result<bool> {
        Ok(self
            .config
            .get()?
            .is_some_and(|c| c.is_private && c.context_name == "default"))
    }

    // ── personal library ─────────────────────────────────────────────────

    /// Saves a signature image, uploaded first as a blob of this app
    /// (`blobIdStr`, 64 hex; `dataSize` its size in bytes). Answers its id.
    pub fn create_signature(
        &mut self,
        name: String,
        blob_id_str: String,
        data_size: u64,
    ) -> app::Result<u64> {
        self.require_library("Signatures can only be created in private context")?;
        check_len("name", &name, MAX_NAME_BYTES)?;
        let blob = held_blob(&blob_id_str, data_size)?;
        let id = self.next_signature_id.increment()?;
        let created_at = env::time_now();
        let _ = self.signatures.insert(
            &id,
            &SignatureRecord {
                id,
                name: name.clone(),
                blob_id: blob,
                size: data_size,
                created_at,
            },
        )?;
        env::emit(
            Event::SignatureCreated {
                id,
                name,
                size: data_size,
            },
            Audience::Caller,
        )?;
        Ok(id)
    }

    /// Deletes a saved signature.
    pub fn delete_signature(&mut self, signature_id: u64) -> app::Result<()> {
        self.require_library("Signatures can only be deleted in private context")?;
        if self.signatures.remove(&signature_id)?.is_none() {
            return Err(not_found(format!("Signature not found: {signature_id}")));
        }
        env::emit(
            Event::SignatureDeleted { id: signature_id },
            Audience::Caller,
        )?;
        Ok(())
    }

    /// The saved signatures, oldest first: one page (`limit` at most 1,000,
    /// 100 by default; `next` is the cursor of the following page).
    #[app::view]
    pub fn list_signatures(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<SignaturePage> {
        self.require_library("Signatures can only be accessed in private context")?;
        let page = self.signatures.page(page_opts(cursor, limit))?;
        Ok(SignaturePage {
            items: page.items.into_iter().map(|(_, s)| s).collect(),
            next: page.next,
        })
    }

    /// Bookmarks an agreement (`contextIdStr`, its app id) under `contextName`.
    pub fn join_shared_context(
        &mut self,
        context_id_str: String,
        context_name: String,
    ) -> app::Result<()> {
        self.require_library("Context joining can only be managed in private context")?;
        check_len("contextIdStr", &context_id_str, MAX_ID_BYTES)?;
        check_len("contextName", &context_name, MAX_NAME_BYTES)?;
        if context_id_str.is_empty() {
            return Err(invalid("contextIdStr is empty"));
        }
        if self.joined_contexts.contains(&context_id_str)? {
            return Err(conflict("Already joined this context"));
        }
        let _ = self.joined_contexts.insert(
            &context_id_str,
            &ContextMetadata {
                context_id: context_id_str.clone(),
                context_name: context_name.clone(),
                role: "Unknown".to_owned(),
                joined_at: env::time_now(),
            },
        )?;
        env::emit(
            Event::ContextJoined {
                context_id: context_id_str,
                context_name,
            },
            Audience::Caller,
        )?;
        Ok(())
    }

    /// Removes an agreement's bookmark.
    pub fn leave_shared_context(&mut self, context_id_str: String) -> app::Result<()> {
        self.require_library("Context leaving can only be managed in private context")?;
        if self.joined_contexts.remove(&context_id_str)?.is_none() {
            return Err(not_found("Context not found"));
        }
        env::emit(
            Event::ContextLeft {
                context_id: context_id_str,
            },
            Audience::Caller,
        )?;
        Ok(())
    }

    /// The bookmarked agreements, by app id: one page.
    #[app::view]
    pub fn list_joined_contexts(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ContextPage> {
        self.require_library("Joined contexts can only be accessed in private context")?;
        let page = self.joined_contexts.page(page_opts(cursor, limit))?;
        Ok(ContextPage {
            items: page.items.into_iter().map(|(_, c)| c).collect(),
            next: page.next,
        })
    }

    // ── agreement: who ───────────────────────────────────────────────────

    /// The instance as a whole: its id, name, owner and kind, and for an
    /// agreement its participants and how many documents it holds.
    /// `contextIdStr` is ignored (the app answers for itself; kept for v1's
    /// clients).
    #[app::view]
    pub fn get_context_details(
        &self,
        context_id_str: Option<String>,
    ) -> app::Result<ContextDetails> {
        let _ = context_id_str;
        let config = self.config()?;
        let participants: Vec<ParticipantInfo> = self
            .all_participants()?
            .into_iter()
            .map(|p| ParticipantInfo {
                user_id: p.account,
                permission_level: p.level,
            })
            .collect();
        Ok(ContextDetails {
            context_id: env::app_id(),
            context_name: config.context_name,
            owner: env::app_owner(),
            is_private: config.is_private,
            participant_count: participants.len() as u64,
            participants,
            document_count: self.documents.len()?,
            created_at: config.created_at,
        })
    }

    /// The caller's account, as this app sees it.
    #[app::view]
    pub fn whoami(&self) -> app::Result<String> {
        caller_account()
    }

    /// Every participant's account (at most [`MAX_PARTICIPANTS`]), in account
    /// order.
    #[app::view]
    pub fn list_participants(&self) -> app::Result<Vec<String>> {
        self.require_agreement()?;
        Ok(self
            .all_participants()?
            .into_iter()
            .map(|p| p.account)
            .collect())
    }

    /// An account's level (`Admin`, `Sign` or `Read`); `NotFound` for someone
    /// who is not a participant.
    #[app::view]
    pub fn get_user_permission(&self, user_id_str: String) -> app::Result<String> {
        self.require_agreement()?;
        self.level_of(&user_id_str)?
            .ok_or_else(|| not_found("User not found"))
    }

    /// This app's id.
    #[app::view]
    pub fn get_context_id(&self) -> app::Result<String> {
        Ok(env::app_id())
    }

    /// Joins the agreement as a `Sign` participant: anyone the app reaches
    /// (the workspace's members and guests) whom an admin has not removed.
    pub fn register_self_as_participant(&mut self) -> app::Result<()> {
        if self.config()?.is_private {
            return Err(wrong_context(
                "Cannot register as participant in private context",
            ));
        }
        let me = caller_account()?;
        if self.removed.contains(&me)? {
            return Err(forbidden("An admin removed you from this agreement"));
        }
        if self.participants.contains(&me)? {
            return Err(conflict("Already registered as participant"));
        }
        self.check_room()?;
        self.participants.insert(Participant {
            account: me.clone(),
            level: LEVEL_SIGN.to_owned(),
            joined_at: env::time_now(),
            self_registered: true,
        })?;
        env::emit(Event::ParticipantJoined { user_id: me }, Audience::All)?;
        Ok(())
    }

    /// Adds `userIdStr` (an account of the workspace) at `permission` (`Read`,
    /// `Sign` or `Admin`). Admins only. Lifts an earlier removal.
    pub fn add_participant(&mut self, user_id_str: String, permission: String) -> app::Result<()> {
        self.require_admin()?;
        let level = parse_level(&permission)?;
        check_len("userIdStr", &user_id_str, MAX_ID_BYTES)?;
        if env::org_role(&user_id_str).is_none() && user_id_str != env::app_owner() {
            return Err(not_found(format!(
                "{user_id_str} is not in this agreement's workspace"
            )));
        }
        if self.participants.contains(&user_id_str)? {
            return Err(conflict("User is already a participant"));
        }
        self.check_room()?;
        let _ = self.removed.remove(&user_id_str)?;
        self.participants.insert(Participant {
            account: user_id_str.clone(),
            level: level.to_owned(),
            joined_at: env::time_now(),
            self_registered: false,
        })?;
        env::emit(
            Event::ParticipantJoined {
                user_id: user_id_str,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Removes a participant, and keeps them from registering themselves again.
    /// Admins only; refused for the last admin.
    pub fn remove_participant(&mut self, user_id_str: String) -> app::Result<()> {
        self.require_admin()?;
        let Some(p) = self.participants.get(&user_id_str)? else {
            return Err(not_found("User is not a participant"));
        };
        if p.level == LEVEL_ADMIN && self.admin_count()? <= 1 {
            return Err(conflict(
                "An agreement needs at least one admin: promote someone else first",
            ));
        }
        let _ = self.participants.remove(&user_id_str)?;
        let _ = self.removed.insert(&user_id_str)?;
        env::emit(
            Event::ParticipantLeft {
                user_id: user_id_str,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Changes an existing participant's level, up or down. Admins only; the
    /// last admin cannot step down. Setting the level someone holds is a no-op.
    pub fn set_participant_permission(
        &mut self,
        user_id_str: String,
        permission: String,
    ) -> app::Result<()> {
        self.require_admin()?;
        let level = parse_level(&permission)?;
        let Some(mut p) = self.participants.get(&user_id_str)? else {
            return Err(not_found("User is not a participant"));
        };
        if p.level == level {
            return Ok(());
        }
        if p.level == LEVEL_ADMIN && self.admin_count()? <= 1 {
            return Err(conflict(
                "An agreement needs at least one admin: promote someone else first",
            ));
        }
        p.level = level.to_owned();
        self.participants.upsert(p)?;
        env::emit(
            Event::ParticipantPermissionChanged {
                user_id: user_id_str,
                permission: level.to_owned(),
            },
            Audience::All,
        )?;
        Ok(())
    }

    // ── agreement: documents ─────────────────────────────────────────────

    /// Adds a document: the PDF uploaded first as a blob of this app
    /// (`pdfBlobIdStr`), whose SHA-256 `hash` is (the blob id is that SHA-256,
    /// so the two must be equal) and whose size is `fileSize`. Sign or Admin.
    /// Every participant holding `Sign` or `Admin` now must sign it. The search
    /// content is optional: at most [`MAX_EMBEDDING_DIM`] dimensions,
    /// [`MAX_TEXT_BYTES`] of text and [`MAX_CHUNKS`] chunks. Answers its id.
    pub fn upload_document(
        &mut self,
        name: String,
        hash: String,
        pdf_blob_id_str: String,
        file_size: u64,
        embeddings: Option<Vec<f32>>,
        extracted_text: Option<String>,
        chunks: Option<Vec<DocumentChunk>>,
    ) -> app::Result<String> {
        let me = self.require_level(LEVEL_SIGN)?;
        check_len("name", &name, MAX_NAME_BYTES)?;
        let pdf_blob = held_blob(&pdf_blob_id_str, file_size)?;
        check_hash(&hash, &pdf_blob)?;
        if let Some(e) = &embeddings {
            check_embedding(e)?;
        }
        if let Some(t) = &extracted_text {
            if t.len() > MAX_TEXT_BYTES {
                return Err(invalid(format!(
                    "extractedText is over {MAX_TEXT_BYTES} bytes"
                )));
            }
        }
        let chunks = chunks.unwrap_or_default();
        if chunks.len() > MAX_CHUNKS {
            return Err(invalid(format!("more than {MAX_CHUNKS} chunks")));
        }
        for c in &chunks {
            check_embedding(&c.embedding)?;
            if c.text.len() > MAX_TEXT_BYTES {
                return Err(invalid(format!("a chunk is over {MAX_TEXT_BYTES} bytes")));
            }
        }

        let id = format!("doc_{}", hex(&env::random_bytes(16)));
        let required_signers = self
            .all_participants()?
            .into_iter()
            .filter(|p| rank(&p.level) >= rank(LEVEL_SIGN))
            .map(|p| p.account)
            .collect();
        for (n, chunk) in chunks.iter().enumerate() {
            let _ = self.chunks.insert(&(id.clone(), n as u64), chunk)?;
        }
        let _ = self.documents.insert(
            &id,
            &StoredDocument {
                name: name.clone(),
                hash: hash.clone(),
                pdf_blob,
                size: file_size,
                uploaded_by: me.clone(),
                uploaded_at: env::time_now(),
                required_signers,
                embeddings,
                extracted_text,
                chunk_count: chunks.len() as u64,
            },
        )?;
        let _ = self.progress.insert(
            &id,
            &Progress {
                hash,
                pdf_blob,
                size: file_size,
                signatures: 0,
                required_signed: 0,
            },
        )?;
        env::emit(
            Event::DocumentUploaded {
                id: id.clone(),
                name,
                uploaded_by: me,
            },
            Audience::All,
        )?;
        Ok(id)
    }

    /// Removes a document with its signatures, consents and search chunks.
    /// Admins only. The blobs go once nothing refers to them.
    pub fn delete_document(&mut self, document_id: String) -> app::Result<()> {
        self.require_admin()?;
        let Some(doc) = self.documents.remove(&document_id)? else {
            return Err(not_found(format!("Document not found: {document_id}")));
        };
        let _ = self.progress.remove(&document_id)?;
        for n in 0..doc.chunk_count {
            let _ = self.chunks.remove(&(document_id.clone(), n))?;
        }
        let prefix = [KeyPart::Str(document_id.clone())];
        // Both are bounded by the participants (MAX_PARTICIPANTS < PAGE): one
        // page holds every row.
        let signed = self
            .document_signatures
            .prefix(&prefix, FindOpts::default().limit(PAGE))?;
        for (key, _) in signed.items {
            let _ = self.document_signatures.remove(&key)?;
        }
        let consents = self
            .consents
            .prefix(&prefix, FindOpts::default().limit(PAGE))?;
        for (key, _) in consents.items {
            let _ = self.consents.remove(&key)?;
        }
        env::emit(Event::DocumentDeleted { id: document_id }, Audience::All)?;
        Ok(())
    }

    /// The documents, by id: one page (`limit` at most 1,000, 100 by
    /// default). Participants only.
    #[app::view]
    pub fn list_documents(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<DocumentPage> {
        let _ = self.require_level(LEVEL_READ)?;
        let page = self.documents.page(page_opts(cursor, limit))?;
        let mut items = Vec::with_capacity(page.items.len());
        for (id, doc) in page.items {
            items.push(self.info(id, doc)?);
        }
        Ok(DocumentPage {
            items,
            next: page.next,
        })
    }

    /// Records the caller's consent to sign a document. Participants only;
    /// nobody can give it for someone else.
    pub fn set_consent(&mut self, document_id: String) -> app::Result<()> {
        let me = self.require_level(LEVEL_READ)?;
        if !self.documents.contains(&document_id)? {
            return Err(not_found(format!("Document not found: {document_id}")));
        }
        let _ = self.consents.insert(&(document_id, me), &env::time_now())?;
        Ok(())
    }

    /// Whether `userIdStr` has consented to sign a document.
    #[app::view]
    pub fn has_consented(&self, user_id_str: String, document_id: String) -> app::Result<bool> {
        self.require_agreement()?;
        Ok(self.consents.contains(&(document_id, user_id_str))?)
    }

    /// Records the caller's signature: the PDF with their mark, uploaded first
    /// as a blob (`pdfBlobIdStr`, whose SHA-256 is `newHash`), made from the
    /// version at `baseHash`. Sign or Admin, after `setConsent`, and with a
    /// passkey confirmation (`412 CONFIRM_REQUIRED` without one).
    ///
    /// Refused when the caller signed it already, when it is fully signed, and
    /// when `baseHash` is not its current version: somebody else signed in the
    /// meantime and this PDF lacks their mark.
    #[app::confirm]
    pub fn sign_document(
        &mut self,
        document_id: String,
        base_hash: String,
        pdf_blob_id_str: String,
        file_size: u64,
        new_hash: String,
    ) -> app::Result<()> {
        let me = self.require_level(LEVEL_SIGN)?;
        if !self.consents.contains(&(document_id.clone(), me.clone()))? {
            return Err(Error::ConsentRequired {
                message: "You must provide consent before signing this document".to_owned(),
            }
            .into());
        }
        let Some(doc) = self.documents.get(&document_id)? else {
            return Err(not_found(format!("Document not found: {document_id}")));
        };
        let mut p = self.progress_of(&document_id)?;
        if status_of(&doc, &p) == "FullySigned" {
            return Err(conflict(
                "This document is fully signed and takes no more signatures",
            ));
        }
        if self
            .document_signatures
            .contains(&(document_id.clone(), me.clone()))?
        {
            return Err(conflict("You have already signed this document"));
        }
        if p.hash != base_hash {
            return Err(Error::StaleVersion {
                message: format!(
                    "This document changed while you were signing it: you started from {base_hash}, \
                     but it is now at {}. Somebody else signed in the meantime, and saving \
                     this copy would erase their signature. Reopen the document and sign again.",
                    p.hash
                ),
                current: p.hash,
            }
            .into());
        }
        let pdf_blob = held_blob(&pdf_blob_id_str, file_size)?;
        check_hash(&new_hash, &pdf_blob)?;

        let signed_at = env::time_now();
        let _ = self.document_signatures.insert(
            &(document_id.clone(), me.clone()),
            &SignedVersion {
                position: p.signatures,
                base_hash,
                new_hash: new_hash.clone(),
                pdf_blob,
                size: file_size,
                signed_at,
            },
        )?;
        p.signatures += 1;
        if doc.required_signers.contains(&me) {
            p.required_signed += 1;
        }
        p.hash = new_hash;
        p.pdf_blob = pdf_blob;
        p.size = file_size;
        let _ = self.progress.insert(&document_id, &p)?;
        env::emit(
            Event::DocumentSigned {
                document_id,
                signer: me,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// The signatures on a document, in the order they were applied; `[]` for
    /// a document that does not exist. Participants only.
    #[app::view]
    pub fn get_document_signatures(
        &self,
        document_id: String,
    ) -> app::Result<Vec<DocumentSignature>> {
        let _ = self.require_level(LEVEL_READ)?;
        Ok(self
            .signed(&document_id)?
            .into_iter()
            .map(|(signer, v)| DocumentSignature {
                signer,
                signed_at: v.signed_at,
            })
            .collect())
    }

    /// A document's status (`Pending`, `PartiallySigned` or `FullySigned`), its
    /// current version's hash and how many signatures it has. Participants only.
    #[app::view]
    pub fn get_document_status(&self, document_id: String) -> app::Result<DocumentState> {
        let _ = self.require_level(LEVEL_READ)?;
        let Some(doc) = self.documents.get(&document_id)? else {
            return Err(not_found(format!("Document not found: {document_id}")));
        };
        let p = self.progress_of(&document_id)?;
        Ok(DocumentState {
            status: status_of(&doc, &p).to_owned(),
            hash: p.hash,
            signatures: p.signatures,
        })
    }

    /// Succeeds when the caller consented to a document and their signature is
    /// on it: a client asks after signing. Writes nothing.
    #[app::view]
    pub fn mark_participant_signed(&self, document_id: String) -> app::Result<()> {
        let me = caller_account()?;
        self.require_agreement()?;
        if !self.consents.contains(&(document_id.clone(), me.clone()))? {
            return Err(Error::ConsentRequired {
                message: "You must provide consent before being marked as signed".to_owned(),
            }
            .into());
        }
        if !self.documents.contains(&document_id)? {
            return Err(not_found(format!("Document not found: {document_id}")));
        }
        if !self.document_signatures.contains(&(document_id, me))? {
            return Err(conflict("You have not signed this document yet"));
        }
        Ok(())
    }

    /// The current version's blob, its hash and size, and a download grant
    /// valid for [`GRANT_TTL_SECS`] seconds. Participants only.
    #[app::view]
    pub fn document_download(&self, document_id: String) -> app::Result<DocumentDownload> {
        let _ = self.require_level(LEVEL_READ)?;
        if !self.documents.contains(&document_id)? {
            return Err(not_found(format!("Document not found: {document_id}")));
        }
        let p = self.progress_of(&document_id)?;
        Ok(DocumentDownload {
            grant: p.pdf_blob.grant(GRANT_TTL_SECS),
            blob_id: p.pdf_blob,
            hash: p.hash,
            size: p.size,
        })
    }

    /// The parts of a document most like `queryEmbedding` (cosine similarity
    /// over its chunks, or over the whole-document embedding when it has no
    /// chunks), as text. Participants only.
    #[app::view]
    pub fn search_document_by_embedding(
        &self,
        query_embedding: Vec<f32>,
        document_id: String,
    ) -> app::Result<String> {
        let _ = self.require_level(LEVEL_READ)?;
        let Some(document) = self.documents.get(&document_id)? else {
            return Err(not_found(format!(
                "Document with ID '{document_id}' not found"
            )));
        };

        if document.chunk_count > 0 {
            let page = self.chunks.prefix(
                &[KeyPart::Str(document_id.clone())],
                FindOpts::default().limit(PAGE),
            )?;
            let chunks: Vec<DocumentChunk> = page.items.into_iter().map(|(_, c)| c).collect();
            let dim = chunks.first().map_or(0, |c| c.embedding.len());
            if dim != query_embedding.len() {
                return Err(invalid(format!(
                    "Embedding dimension mismatch: query={}, document chunks={dim}",
                    query_embedding.len()
                )));
            }
            let mut scored: Vec<(&DocumentChunk, f32)> = chunks
                .iter()
                .map(|c| (c, cosine_similarity(&query_embedding, &c.embedding)))
                .filter(|(_, s)| *s > 0.1)
                .collect();
            if scored.is_empty() {
                return Ok(format!(
                    "Document: {}\nNo relevant sections found for your query. The document may not contain information related to your question.",
                    document.name
                ));
            }
            scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            let top: Vec<String> = scored
                .into_iter()
                .take(3)
                .map(|(chunk, s)| {
                    let max = if s > 0.5 {
                        300
                    } else if s > 0.3 {
                        200
                    } else {
                        150
                    };
                    format!("[Relevance: {s:.2}] {}", snippet(&clean(&chunk.text), max))
                })
                .collect();
            return Ok(format!(
                "Document: {}\nMost relevant sections:\n\n{}",
                document.name,
                top.join("\n\n")
            ));
        }

        let Some(doc_embedding) = &document.embeddings else {
            return Err(invalid("Document has no embeddings for semantic search"));
        };
        if doc_embedding.len() != query_embedding.len() {
            return Err(invalid(format!(
                "Embedding dimension mismatch: query={}, document={}",
                query_embedding.len(),
                doc_embedding.len()
            )));
        }
        let s = cosine_similarity(&query_embedding, doc_embedding);
        if s < 0.05 {
            return Ok(format!(
                "Document: {} (Low relevance: {s:.2})\nNo highly relevant content found for your query.",
                document.name
            ));
        }
        let text = match &document.extracted_text {
            Some(full) => {
                let max = if s > 0.4 {
                    400
                } else if s > 0.2 {
                    250
                } else {
                    150
                };
                snippet(&full.replace(['\n', '\r'], " ").replace("  ", " "), max)
            }
            None => format!("Document: {} (No extracted text available)", document.name),
        };
        Ok(format!(
            "Document: {} (Similarity: {s:.2})\n{text}",
            document.name
        ))
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

impl MeroSign {
    fn config(&self) -> app::Result<Config> {
        self.config.get()?.ok_or_else(|| Error::NotSetUp.into())
    }

    /// The personal library's owner, or a refusal.
    fn require_library(&self, wrong: &str) -> app::Result<String> {
        if !self.config()?.is_private {
            return Err(wrong_context(wrong));
        }
        let me = caller_account()?;
        if me != env::app_owner() {
            return Err(forbidden("This library is its owner's alone"));
        }
        Ok(me)
    }

    fn require_agreement(&self) -> app::Result<()> {
        if self.config()?.is_private {
            return Err(wrong_context(
                "This method can only be called from shared context",
            ));
        }
        Ok(())
    }

    /// The caller, a participant holding at least `minimum`.
    fn require_level(&self, minimum: &str) -> app::Result<String> {
        self.require_agreement()?;
        let me = caller_account()?;
        match self.level_of(&me)? {
            Some(level) if rank(&level) >= rank(minimum) => Ok(me),
            Some(_) => Err(forbidden(format!(
                "{minimum} permission or higher is required for this operation"
            ))),
            None => Err(forbidden("You are not a participant in this agreement")),
        }
    }

    fn require_admin(&self) -> app::Result<String> {
        self.require_agreement()?;
        let me = caller_account()?;
        match self.level_of(&me)? {
            Some(level) if level == LEVEL_ADMIN => Ok(me),
            Some(_) => Err(forbidden("Admin permissions required for this operation")),
            None => Err(forbidden("User permissions not found")),
        }
    }

    fn level_of(&self, account: &str) -> app::Result<Option<String>> {
        Ok(self.participants.get(account)?.map(|p| p.level))
    }

    fn admin_count(&self) -> app::Result<u64> {
        Ok(self
            .participants
            .count("perLevel", &[KeyPart::Str(LEVEL_ADMIN.to_owned())])?)
    }

    /// Every participant, in account order: one page, as there are at most
    /// [`MAX_PARTICIPANTS`].
    fn all_participants(&self) -> app::Result<Vec<Participant>> {
        Ok(self
            .participants
            .scan(FindOpts::default().limit(PAGE))?
            .items)
    }

    fn check_room(&self) -> app::Result<()> {
        let total: u64 = [LEVEL_ADMIN, LEVEL_SIGN, LEVEL_READ]
            .iter()
            .map(|l| {
                self.participants
                    .count("perLevel", &[KeyPart::Str((*l).to_owned())])
            })
            .sum::<Result<u64, _>>()?;
        if total >= MAX_PARTICIPANTS {
            return Err(conflict(format!(
                "An agreement holds at most {MAX_PARTICIPANTS} participants"
            )));
        }
        Ok(())
    }

    fn progress_of(&self, document_id: &str) -> app::Result<Progress> {
        self.progress
            .get(&document_id.to_owned())?
            .ok_or_else(|| not_found(format!("Document not found: {document_id}")))
    }

    /// A document's signatures with their signers, in the order applied.
    fn signed(&self, document_id: &str) -> app::Result<Vec<(String, SignedVersion)>> {
        // At most one per participant (MAX_PARTICIPANTS < PAGE): one page.
        let page = self.document_signatures.prefix(
            &[KeyPart::Str(document_id.to_owned())],
            FindOpts::default().limit(PAGE),
        )?;
        let mut out: Vec<(String, SignedVersion)> = page
            .items
            .into_iter()
            .map(|((_, signer), v)| (signer, v))
            .collect();
        out.sort_by_key(|(_, v)| v.position);
        Ok(out)
    }

    fn info(&self, id: String, doc: StoredDocument) -> app::Result<DocumentInfo> {
        let p = self.progress_of(&id)?;
        Ok(DocumentInfo {
            status: status_of(&doc, &p).to_owned(),
            id,
            name: doc.name,
            hash: p.hash,
            uploaded_by: doc.uploaded_by,
            uploaded_at: doc.uploaded_at,
            pdf_blob_id: p.pdf_blob,
            size: p.size,
            required_signers: doc.required_signers,
            original_hash: doc.hash,
        })
    }
}

/// The caller's account: a signed-in account, or the account an API key acts for.
fn caller_account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(a) => Ok(a),
        Caller::ApiKey { account, .. } => Ok(account),
        _ => Err(forbidden("This method needs an account")),
    }
}

fn page_opts(cursor: Option<String>, limit: Option<u32>) -> FindOpts {
    let mut opts = FindOpts::default().limit(limit.unwrap_or(DEFAULT_PAGE).min(PAGE));
    if let Some(c) = cursor {
        opts = opts.cursor(c);
    }
    opts
}

fn parse_level(permission: &str) -> app::Result<&'static str> {
    match permission {
        LEVEL_ADMIN => Ok(LEVEL_ADMIN),
        LEVEL_SIGN => Ok(LEVEL_SIGN),
        LEVEL_READ => Ok(LEVEL_READ),
        other => Err(invalid(format!(
            "Unknown permission {other:?}: Read, Sign or Admin"
        ))),
    }
}

/// The blob `id` names, which this app must hold, with `size` bytes.
fn held_blob(id: &str, size: u64) -> app::Result<BlobRef> {
    let blob = BlobRef::parse(id).ok_or_else(|| {
        invalid(format!(
            "Invalid blob id {id:?}: expected 64 lowercase hex digits"
        ))
    })?;
    let Some(info) = blob.info() else {
        return Err(Error::BlobNotFound {
            blob_id: id.to_owned(),
        }
        .into());
    };
    if info.size != size {
        return Err(invalid(format!(
            "The blob holds {} bytes, not {size}",
            info.size
        )));
    }
    Ok(blob)
}

/// `hash` is the blob's SHA-256, which is its id.
fn check_hash(hash: &str, blob: &BlobRef) -> app::Result<()> {
    let actual = blob.id();
    if hash.to_ascii_lowercase() != actual {
        return Err(Error::HashMismatch {
            expected: hash.to_owned(),
            actual,
        }
        .into());
    }
    Ok(())
}

fn check_embedding(e: &[f32]) -> app::Result<()> {
    if e.len() > MAX_EMBEDDING_DIM {
        return Err(invalid(format!(
            "an embedding has more than {MAX_EMBEDDING_DIM} dimensions"
        )));
    }
    if e.iter().any(|v| !v.is_finite()) {
        return Err(invalid("an embedding holds a value that is not finite"));
    }
    Ok(())
}

fn check_len(what: &str, value: &str, max: usize) -> app::Result<()> {
    if value.len() > max {
        return Err(invalid(format!("{what} is over {max} bytes")));
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

fn forbidden(message: impl Into<String>) -> AppError {
    Error::Forbidden {
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

fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

fn conflict(message: impl Into<String>) -> AppError {
    Error::Conflict {
        message: message.into(),
    }
    .into()
}

fn wrong_context(message: impl Into<String>) -> AppError {
    Error::WrongContext {
        message: message.into(),
    }
    .into()
}
