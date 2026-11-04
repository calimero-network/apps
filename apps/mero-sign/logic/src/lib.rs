//! MeroSign: document signing (a PDF, its signers, their consents and every
//! signed version) on core's component SDK (`calimero-sdk`).
//!
//! One app instance is either an account's **private** library (its saved
//! signatures and the agreements it joined, v1's "default private context") or
//! one **shared** agreement (its participants, documents, consents and
//! signatures, v1's shared context). The owner picks which, once, with
//! [`MeroSign::setup`] right after creating the instance.
//!
//! The app runs on its cluster's leader, which applies every write in one
//! replicated log, so the state is plain maps: v1's CRDT plumbing (the
//! `lww_take` tie-break, `Mergeable` rules, per-owner keys and the "lowest
//! holder" pick, write-once entries and the signature-chain fork resolution)
//! has nothing left to decide. A signature is accepted only on the version the
//! document is at, so the signed versions form one chain by construction.
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `Frozen<bool>` / `Frozen<UserId>` / `Frozen<String>` set by `init(is_private, context_name)` | `info: Cell<Info>`, set once by `setup(isPrivate, contextName)` |
//! | `UnorderedMap<String, SignatureRecord>` | `signatures: UnorderedMap<u64, SignatureRecord>` |
//! | `UnorderedMap<String, ContextMetadata>` / `<String, IdentityMapping>` | the same maps, keyed by the agreement's app id |
//! | `AccessControl` (admin tier, `signer` / `viewer` / `removed` roles) + `UserStorage` self-registrations | `participants: UnorderedMap<account, PermissionLevel>`, `admins: Set`, `removed: Set` |
//! | `ModeratedOnce<UnorderedMap<String, StoredDocument>>` | `documents`, with the search content in `documentContent` and `documentChunks` |
//! | `WriteOnce<SortedMap<"{doc}/{signer}/{nonce}", SignedVersion>>` | `documentSignatures: UnorderedMap<(doc, position), SignedVersion>` |
//! | `UserStorage<Consents>` | `consents: UnorderedMap<(doc, account), bool>` |
//!
//! # Blobs
//!
//! PDFs and signature images are blobs: the client uploads the bytes to the
//! app (`POST /apps/{app}/blobs`) and passes the blob's id (64 lowercase hex
//! digits) to a method, which stores it. The contract never reads the bytes.
//! At `1.0.0-rc.7` ids are stored as plain strings: core's `BlobRef` (#4815,
//! host-tracked retention, a reference to a blob the app does not hold refused)
//! is not in a release yet. Its JSON form is this same hex id, so moving to it
//! changes the stored type and nothing a client sees. See the README.
//!
//! # Who may do what
//!
//! The organization decides who reaches a shared agreement: its owner,
//! admins, members and guests. The contract's own roster decides what each may
//! do there, checked in each method against `env::caller()`:
//!
//! - **Admin** (the agreement's creator, then whoever an admin promotes):
//!   add, remove and re-level participants, delete documents. The last admin
//!   cannot step down or be removed.
//! - **Sign**: upload documents and sign them.
//! - **Read**: read; consenting is open to every caller, signing is not.
//! - A member of the organization (not a guest) joins as `Sign` with
//!   `registerSelfAsParticipant`, unless an admin removed them.
//!
//! A private library answers its owner only (`Forbidden` for anyone else).
//!
//! Everything a client sees differently from v1 is in
//! `apps/mero-sign/README.md`, "What changed in the port".

use calimero_sdk::env::{Caller, OrgRole};
use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};

/// Most rows one read returns: participants, signatures, chunks.
const PAGE: u32 = 1000;
/// The largest integer a JS number holds exactly (`Number.MAX_SAFE_INTEGER`):
/// signature ids stay below it, as in v1.
const MAX_SAFE_ID: u64 = (1 << 53) - 1;

// ── stored records and results ───────────────────────────────────────────────

/// What `setup` fixed: which kind of instance this is, and its name.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub is_private: bool,
    pub context_name: String,
    /// The account that set it up: the app's owner.
    pub owner: String,
    /// Unix milliseconds.
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub created_at: u64,
}

/// A saved signature image (private library).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureRecord {
    /// Below 2^53, a decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub id: u64,
    pub name: String,
    /// The image's blob id, 64 lowercase hex digits.
    pub blob_id: String,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub size: u64,
    /// Unix milliseconds.
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub created_at: u64,
}

/// Participant roles in shared contexts, as recorded in the private library.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ParticipantRole {
    Owner,
    Signer,
    Viewer,
    Unknown,
}

/// A shared agreement the owner of a private library joined.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMetadata {
    /// The agreement's app id.
    pub context_id: String,
    pub context_name: String,
    pub role: ParticipantRole,
    /// Unix milliseconds.
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub joined_at: u64,
    pub private_identity: String,
    pub shared_identity: String,
}

/// Which identity the owner uses in a joined agreement. Under 1.0 both are
/// the owner's account; kept so v1 clients read the same record.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityMapping {
    pub private_identity: String,
    pub shared_identity: String,
    pub context_id: String,
    /// Unix milliseconds.
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub created_at: u64,
}

/// A document chunk with its embedding, for semantic search.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChunk {
    pub text: String,
    pub embedding: Vec<f32>,
    pub start_position: u32,
    pub end_position: u32,
}

/// Permission levels for participants.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionLevel {
    Read,
    Sign,
    Admin,
}

impl PermissionLevel {
    fn rank(self) -> u8 {
        match self {
            Self::Read => 0,
            Self::Sign => 1,
            Self::Admin => 2,
        }
    }
}

/// Document status, derived from the document's signatures. `FullySigned` is
/// terminal: the signers a document waits for are fixed at upload.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentStatus {
    Pending,
    PartiallySigned,
    FullySigned,
}

/// One version of a document's PDF.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub hash: String,
    /// 64 lowercase hex digits.
    pub pdf_blob_id: String,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub size: u64,
}

/// A document as stored. `required_signers` is at most one page of
/// participants (1,000), fixed at upload; `current` moves with each signature.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredDocument {
    pub name: String,
    pub uploaded_by: String,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub uploaded_at: u64,
    /// The version as uploaded.
    pub original: Version,
    /// The last signature's version, or the upload's.
    pub current: Version,
    pub required_signers: Vec<String>,
    /// How many signatures `documentSignatures` holds for it.
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub signature_count: u64,
}

/// The search content of a document, kept apart from it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentContent {
    pub embeddings: Option<Vec<f32>>,
    pub extracted_text: Option<String>,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub chunk_count: u64,
}

/// One signature: the signer took the version at `base_hash`, put their mark
/// on it and produced `new_hash`, stored as `pdf_blob_id`. Never changed.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedVersion {
    pub signer: String,
    pub base_hash: String,
    pub new_hash: String,
    pub pdf_blob_id: String,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub size: u64,
    /// Unix milliseconds.
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub signed_at: u64,
}

/// A document as read: its current version and status. `embeddings`,
/// `extractedText` and `chunks` are always `null` (as in v1's
/// `list_documents`); search reads them in place.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub id: String,
    pub name: String,
    pub hash: String,
    pub uploaded_by: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub uploaded_at: u64,
    pub status: DocumentStatus,
    pub pdf_blob_id: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub size: u64,
    pub required_signers: Vec<String>,
    pub embeddings: Option<Vec<f32>>,
    pub extracted_text: Option<String>,
    pub chunks: Option<Vec<DocumentChunk>>,
}

/// A signature on a document, as read.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSignature {
    pub signer: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub signed_at: u64,
}

/// A participant and their level.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantInfo {
    pub user_id: String,
    pub permission_level: PermissionLevel,
}

/// Detailed information about an agreement.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDetails {
    pub context_id: String,
    pub context_name: String,
    pub owner: String,
    pub is_private: bool,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub participant_count: u64,
    /// At most 1,000, in account order.
    pub participants: Vec<ParticipantInfo>,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub document_count: u64,
    /// When the agreement was set up, Unix milliseconds.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
}

// ── state ────────────────────────────────────────────────────────────────────

/// A private library or a shared agreement (see the crate docs).
#[app::state(version = 1)]
pub struct MeroSign {
    /// Set once by `setup`; nothing else works before it.
    info: Cell<Info>,

    // Private library.
    signatures: UnorderedMap<u64, SignatureRecord>,
    joined_contexts: UnorderedMap<String, ContextMetadata>,
    identity_mappings: UnorderedMap<String, IdentityMapping>,

    // Shared agreement.
    /// Every participant's level.
    participants: UnorderedMap<String, PermissionLevel>,
    /// The participants at `Admin`, for the last-admin check.
    admins: Set<String>,
    /// Accounts an admin removed: they cannot register themselves again.
    removed: Set<String>,
    documents: UnorderedMap<String, StoredDocument>,
    document_content: UnorderedMap<String, DocumentContent>,
    /// `(documentId, position)`.
    document_chunks: UnorderedMap<(String, u64), DocumentChunk>,
    /// `(documentId, position)`: a document's signatures in the order applied.
    document_signatures: UnorderedMap<(String, u64), SignedVersion>,
    /// `(documentId, account)` → consented.
    consents: UnorderedMap<(String, String), bool>,
}

#[app::logic]
impl MeroSign {
    /// The empty instance. The node runs it once, when the app is created;
    /// the owner then calls `setup`.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    /// Makes this instance a private library (`isPrivate`) or a shared
    /// agreement named `contextName` (v1's `init(is_private, context_name)`).
    /// The app's owner only (`Forbidden`), once (`Conflict`). A shared
    /// agreement's owner is its first admin.
    pub fn setup(&mut self, is_private: bool, context_name: String) -> app::Result<()> {
        let me = account()?;
        if me != env::app_owner() {
            return Err(forbidden("only the app's owner can set it up"));
        }
        if self.info.get()?.is_some() {
            return Err(conflict("This agreement is already set up"));
        }
        self.info.set(&Info {
            is_private,
            context_name,
            owner: me.clone(),
            created_at: env::time_now(),
        })?;
        if !is_private {
            let _ = self.participants.insert(&me, &PermissionLevel::Admin)?;
            let _ = self.admins.insert(&me)?;
        }
        Ok(())
    }

    /// Whether this is the account's default private library (set up private
    /// and named `"default"`). `false` before `setup`.
    #[app::view]
    pub fn is_default_private_context(&self) -> app::Result<bool> {
        Ok(self
            .info
            .get()?
            .is_some_and(|i| i.is_private && i.context_name == "default"))
    }

    // ── private library ──────────────────────────────────────────────────────

    /// Saves a signature image the caller uploaded as blob `blobIdStr` and
    /// returns its id (below 2^53). Private library, owner only.
    /// Emits `SignatureCreated`.
    pub fn create_signature(
        &mut self,
        name: String,
        blob_id_str: String,
        data_size: u64,
    ) -> app::Result<u64> {
        self.private_owner("Signatures can only be created in private context")?;
        let blob_id = blob_id(&blob_id_str)?;
        let id = loop {
            let bytes = env::random_bytes(8);
            let mut raw = [0_u8; 8];
            raw.copy_from_slice(&bytes);
            let id = u64::from_le_bytes(raw) & MAX_SAFE_ID;
            if !self.signatures.contains(&id)? {
                break id;
            }
        };
        let _ = self.signatures.insert(
            &id,
            &SignatureRecord {
                id,
                name: name.clone(),
                blob_id,
                size: data_size,
                created_at: env::time_now(),
            },
        )?;
        env::emit(
            Event::SignatureCreated {
                id,
                name,
                size: data_size,
            },
            Audience::All,
        )?;
        Ok(id)
    }

    /// Deletes a saved signature. Private library, owner only; `NotFound` for
    /// an unknown id. Emits `SignatureDeleted`.
    pub fn delete_signature(&mut self, signature_id: u64) -> app::Result<()> {
        self.private_owner("Signatures can only be deleted in private context")?;
        if self.signatures.remove(&signature_id)?.is_none() {
            return Err(not_found("signature", &signature_id.to_string()));
        }
        env::emit(Event::SignatureDeleted { id: signature_id }, Audience::All)?;
        Ok(())
    }

    /// The saved signatures, at most 1,000, in id order. Private library,
    /// owner only.
    #[app::view]
    pub fn list_signatures(&self) -> app::Result<Vec<SignatureRecord>> {
        self.private_owner("Signatures can only be accessed in private context")?;
        Ok(self
            .signatures
            .page(FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .map(|(_, s)| s)
            .collect())
    }

    /// Records that the owner joined the agreement `contextIdStr` (its app id)
    /// as `sharedIdentityStr` (their account). Private library, owner only;
    /// `Conflict` if already recorded. Emits `ContextJoined`.
    pub fn join_shared_context(
        &mut self,
        context_id_str: String,
        shared_identity_str: String,
        context_name: String,
    ) -> app::Result<()> {
        let owner = self.private_owner("Context joining can only be managed in private context")?;
        let context_id = non_empty("contextIdStr", context_id_str)?;
        let shared_identity = non_empty("sharedIdentityStr", shared_identity_str)?;
        if self.joined_contexts.contains(&context_id)? {
            return Err(conflict("Already joined this context"));
        }
        let now = env::time_now();
        let _ = self.joined_contexts.insert(
            &context_id,
            &ContextMetadata {
                context_id: context_id.clone(),
                context_name: context_name.clone(),
                role: ParticipantRole::Unknown,
                joined_at: now,
                private_identity: owner.clone(),
                shared_identity: shared_identity.clone(),
            },
        )?;
        let _ = self.identity_mappings.insert(
            &context_id,
            &IdentityMapping {
                private_identity: owner,
                shared_identity,
                context_id: context_id.clone(),
                created_at: now,
            },
        )?;
        env::emit(
            Event::ContextJoined {
                context_id,
                context_name,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Forgets a joined agreement. Private library, owner only; `NotFound` if
    /// it was not recorded. Emits `ContextLeft`.
    pub fn leave_shared_context(&mut self, context_id_str: String) -> app::Result<()> {
        self.private_owner("Context leaving can only be managed in private context")?;
        if self.joined_contexts.remove(&context_id_str)?.is_none() {
            return Err(not_found("context", &context_id_str));
        }
        let _ = self.identity_mappings.remove(&context_id_str)?;
        env::emit(
            Event::ContextLeft {
                context_id: context_id_str,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// The joined agreements, at most 1,000, in app-id order. Private library,
    /// owner only.
    #[app::view]
    pub fn list_joined_contexts(&self) -> app::Result<Vec<ContextMetadata>> {
        self.private_owner("Joined contexts can only be accessed in private context")?;
        Ok(self
            .joined_contexts
            .page(FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .map(|(_, c)| c)
            .collect())
    }

    /// The identity mapping recorded for a joined agreement. Private library,
    /// owner only; `NotFound` if none.
    #[app::view]
    pub fn get_identity_mapping(&self, context_id_str: String) -> app::Result<IdentityMapping> {
        self.private_owner("Identity mappings can only be accessed in private context")?;
        self.identity_mappings
            .get(&context_id_str)?
            .ok_or_else(|| not_found("identity mapping", &context_id_str))
    }

    /// The shared identity recorded for a joined agreement. Private library,
    /// owner only; `NotFound` if none.
    #[app::view]
    pub fn get_shared_identity(&self, context_id_str: String) -> app::Result<String> {
        Ok(self.get_identity_mapping(context_id_str)?.shared_identity)
    }

    /// The private identity behind a shared one, if recorded. Private library,
    /// owner only.
    #[app::view]
    pub fn resolve_private_identity(
        &self,
        shared_identity_str: String,
    ) -> app::Result<Option<String>> {
        self.private_owner("Cannot resolve private identity from shared context")?;
        Ok(self
            .identity_mappings
            .page(FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .find(|(_, m)| m.shared_identity == shared_identity_str)
            .map(|(_, m)| m.private_identity))
    }

    // ── agreement: who ───────────────────────────────────────────────────────

    /// The caller's account, as this contract sees it.
    #[app::view]
    pub fn whoami(&self) -> app::Result<String> {
        account()
    }

    /// This instance's app id (v1's context id).
    #[app::view]
    pub fn get_context_id(&self) -> app::Result<String> {
        Ok(env::app_id())
    }

    /// The agreement's name, owner, participants (at most 1,000) and document
    /// count. `contextIdStr` is echoed back as `contextId`.
    #[app::view]
    pub fn get_context_details(&self, context_id_str: String) -> app::Result<ContextDetails> {
        let info = self.info()?;
        let participants = self.participant_page()?;
        Ok(ContextDetails {
            context_id: context_id_str,
            context_name: info.context_name,
            owner: info.owner,
            is_private: info.is_private,
            participant_count: self.participants.len()?,
            participants: participants
                .into_iter()
                .map(|(user_id, permission_level)| ParticipantInfo {
                    user_id,
                    permission_level,
                })
                .collect(),
            document_count: self.documents.len()?,
            created_at: info.created_at,
        })
    }

    /// Every participant's account, at most 1,000, in account order.
    #[app::view]
    pub fn list_participants(&self) -> app::Result<Vec<String>> {
        Ok(self
            .participant_page()?
            .into_iter()
            .map(|(a, _)| a)
            .collect())
    }

    /// A participant's level; `NotFound` for someone who is not one.
    #[app::view]
    pub fn get_user_permission(&self, user_id_str: String) -> app::Result<PermissionLevel> {
        self.participants
            .get(&user_id_str)?
            .ok_or_else(|| not_found("participant", &user_id_str))
    }

    /// Joins the agreement as `Sign` (v1: after redeeming an open invitation).
    /// Members of the organization only (a guest gets `Forbidden`), not after
    /// an admin removed you (`Forbidden`), and once (`Conflict`). Emits
    /// `ParticipantJoined`.
    pub fn register_self_as_participant(&mut self) -> app::Result<()> {
        self.shared("Cannot register as participant in private context")?;
        let me = account()?;
        if self.removed.contains(&me)? {
            return Err(forbidden("An admin removed you from this agreement"));
        }
        if self.participants.contains(&me)? {
            return Err(conflict("Already registered as participant"));
        }
        let member =
            me == env::app_owner() || env::org_role(&me).is_some_and(|r| r >= OrgRole::Member);
        if !member {
            return Err(forbidden(
                "Only members of the organization can join an agreement",
            ));
        }
        let _ = self.participants.insert(&me, &PermissionLevel::Sign)?;
        env::emit(Event::ParticipantJoined { user_id: me }, Audience::All)?;
        Ok(())
    }

    /// Adds an account of the organization (guests included) at `permission`.
    /// Admins only (`Forbidden`); `Conflict` for a participant (use
    /// `setParticipantPermission`), `Invalid` for an account outside the
    /// organization. Clears an earlier removal. Emits `ParticipantJoined`.
    pub fn add_participant(
        &mut self,
        user_id_str: String,
        permission: PermissionLevel,
    ) -> app::Result<()> {
        self.require_admin()?;
        let user = non_empty("userIdStr", user_id_str)?;
        if self.participants.contains(&user)? {
            return Err(conflict("User is already a participant"));
        }
        if user != env::app_owner() && env::org_role(&user).is_none() {
            return Err(invalid(format!(
                "{user} is not in this agreement's organization"
            )));
        }
        self.set_level(&user, permission)?;
        env::emit(Event::ParticipantJoined { user_id: user }, Audience::All)?;
        Ok(())
    }

    /// Removes a participant, and keeps them from registering again. Admins
    /// only (`Forbidden`); `NotFound` for someone who is not one; `Conflict`
    /// for the last admin. Emits `ParticipantLeft`.
    pub fn remove_participant(&mut self, user_id_str: String) -> app::Result<()> {
        self.require_admin()?;
        let Some(level) = self.participants.get(&user_id_str)? else {
            return Err(not_found("participant", &user_id_str));
        };
        if level == PermissionLevel::Admin && self.admins.len()? <= 1 {
            return Err(conflict(
                "An agreement needs at least one admin: promote someone else first",
            ));
        }
        let _ = self.participants.remove(&user_id_str)?;
        let _ = self.admins.remove(&user_id_str)?;
        let _ = self.removed.insert(&user_id_str)?;
        env::emit(
            Event::ParticipantLeft {
                user_id: user_id_str,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Changes an existing participant's level, up or down. Admins only
    /// (`Forbidden`); `NotFound` for someone who is not one; `Conflict` for the
    /// last admin stepping down. Setting the level they hold is a no-op.
    /// Emits `ParticipantPermissionChanged`.
    pub fn set_participant_permission(
        &mut self,
        user_id_str: String,
        permission: PermissionLevel,
    ) -> app::Result<()> {
        self.require_admin()?;
        let Some(current) = self.participants.get(&user_id_str)? else {
            return Err(not_found("participant", &user_id_str));
        };
        if current == permission {
            return Ok(());
        }
        if current == PermissionLevel::Admin && self.admins.len()? <= 1 {
            return Err(conflict(
                "An agreement needs at least one admin: promote someone else first",
            ));
        }
        self.set_level(&user_id_str, permission)?;
        env::emit(
            Event::ParticipantPermissionChanged {
                user_id: user_id_str,
                permission,
            },
            Audience::All,
        )?;
        Ok(())
    }

    // ── agreement: documents ─────────────────────────────────────────────────

    /// Adds a document the caller uploaded as blob `pdfBlobIdStr` and returns
    /// its id. `Sign` or above (`Forbidden`). Its required signers are every
    /// participant at `Sign` or above now (at most 1,000). Emits
    /// `DocumentUploaded`.
    #[allow(clippy::too_many_arguments)]
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
        let me = self.require_level(PermissionLevel::Sign)?;
        let pdf_blob_id = blob_id(&pdf_blob_id_str)?;
        let id = format!("doc_{}", hex(&env::random_bytes(16)));
        let required_signers = self
            .participant_page()?
            .into_iter()
            .filter(|(_, l)| l.rank() >= PermissionLevel::Sign.rank())
            .map(|(a, _)| a)
            .collect();
        let version = Version {
            hash,
            pdf_blob_id,
            size: file_size,
        };
        let _ = self.documents.insert(
            &id,
            &StoredDocument {
                name: name.clone(),
                uploaded_by: me.clone(),
                uploaded_at: env::time_now(),
                original: version.clone(),
                current: version,
                required_signers,
                signature_count: 0,
            },
        )?;
        let chunks = chunks.unwrap_or_default();
        for (i, chunk) in chunks.iter().enumerate() {
            let _ = self
                .document_chunks
                .insert(&(id.clone(), i as u64), chunk)?;
        }
        if embeddings.is_some() || extracted_text.is_some() || !chunks.is_empty() {
            let _ = self.document_content.insert(
                &id,
                &DocumentContent {
                    embeddings,
                    extracted_text,
                    chunk_count: chunks.len() as u64,
                },
            )?;
        }
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

    /// Deletes a document with its search content, signatures and consents.
    /// Admins only (`Forbidden`); `NotFound` for an unknown id. The blobs stay
    /// in the app until the owner deletes them. Emits `DocumentDeleted`.
    pub fn delete_document(&mut self, document_id: String) -> app::Result<()> {
        self.require_admin()?;
        if self.documents.remove(&document_id)?.is_none() {
            return Err(not_found("document", &document_id));
        }
        let _ = self.document_content.remove(&document_id)?;
        clear_prefix(&mut self.document_chunks, &document_id)?;
        clear_prefix(&mut self.document_signatures, &document_id)?;
        clear_prefix(&mut self.consents, &document_id)?;
        env::emit(Event::DocumentDeleted { id: document_id }, Audience::All)?;
        Ok(())
    }

    /// Every document (at most 1,000, in id order) with its current version
    /// and status, without its search content.
    #[app::view]
    pub fn list_documents(&self) -> app::Result<Vec<DocumentInfo>> {
        self.info()?;
        let page = self.documents.page(FindOpts::default().limit(PAGE))?;
        page.items
            .into_iter()
            .map(|(id, doc)| self.document_info(id, doc))
            .collect()
    }

    /// Records the CALLER's consent to sign a document. Nobody can consent for
    /// you, so there is no account parameter.
    pub fn set_consent(&mut self, document_id: String) -> app::Result<()> {
        let me = account()?;
        let _ = self.consents.insert(&(document_id, me), &true)?;
        Ok(())
    }

    /// Whether `userIdStr` consented to sign a document.
    #[app::view]
    pub fn has_consented(&self, user_id_str: String, document_id: String) -> app::Result<bool> {
        Ok(self
            .consents
            .get(&(document_id, user_id_str))?
            .unwrap_or(false))
    }

    /// Records the CALLER's signature: the PDF at the document's current
    /// version (`baseHash`) with their mark on it, uploaded as blob
    /// `pdfBlobIdStr`, is the document's new version `newHash`. `Sign` or
    /// above (`Forbidden`), after consenting (`Forbidden`); `Conflict` for a
    /// fully signed document, a second signature, or a `baseHash` that is no
    /// longer current (someone signed in between: reopen and sign again).
    /// Emits `DocumentSigned`.
    pub fn sign_document(
        &mut self,
        document_id: String,
        base_hash: String,
        pdf_blob_id_str: String,
        file_size: u64,
        new_hash: String,
    ) -> app::Result<()> {
        let me = self.require_level(PermissionLevel::Sign)?;
        if !self.consented(&me, &document_id)? {
            return Err(forbidden(
                "You must provide consent before signing this document",
            ));
        }
        let mut doc = self.stored(&document_id)?;
        let signed = self.signers(&document_id)?;
        if status_of(&doc, &signed) == DocumentStatus::FullySigned {
            return Err(conflict(
                "This document is fully signed and takes no more signatures",
            ));
        }
        if signed.contains(&me) {
            return Err(conflict("You have already signed this document"));
        }
        if doc.current.hash != base_hash {
            return Err(conflict(format!(
                "This document changed while you were signing it: you started from {}, \
                 but it is now at {}. Somebody else signed in the meantime, and saving \
                 this copy would erase their signature. Reopen the document and sign again.",
                base_hash, doc.current.hash
            )));
        }
        let pdf_blob_id = blob_id(&pdf_blob_id_str)?;
        let _ = self.document_signatures.insert(
            &(document_id.clone(), doc.signature_count),
            &SignedVersion {
                signer: me.clone(),
                base_hash,
                new_hash: new_hash.clone(),
                pdf_blob_id: pdf_blob_id.clone(),
                size: file_size,
                signed_at: env::time_now(),
            },
        )?;
        doc.signature_count += 1;
        doc.current = Version {
            hash: new_hash,
            pdf_blob_id,
            size: file_size,
        };
        let _ = self.documents.insert(&document_id, &doc)?;
        env::emit(
            Event::DocumentSigned {
                document_id,
                signer: me,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// The signatures on a document, in the order they were applied; empty
    /// for an unknown document.
    #[app::view]
    pub fn get_document_signatures(
        &self,
        document_id: String,
    ) -> app::Result<Vec<DocumentSignature>> {
        Ok(self
            .signature_page(&document_id)?
            .into_iter()
            .map(|v| DocumentSignature {
                signer: v.signer,
                signed_at: v.signed_at,
            })
            .collect())
    }

    /// Confirms the CALLER's signature is on a document: `Forbidden` without
    /// consent, `Invalid` if they have not signed it. Writes nothing.
    pub fn mark_participant_signed(&mut self, document_id: String) -> app::Result<()> {
        let me = account()?;
        if !self.consented(&me, &document_id)? {
            return Err(forbidden(
                "You must provide consent before being marked as signed",
            ));
        }
        self.stored(&document_id)?;
        if !self.signers(&document_id)?.contains(&me) {
            return Err(invalid("You have not signed this document yet"));
        }
        Ok(())
    }

    /// The most relevant passages of a document for a query embedding, as
    /// text: by chunk when the document has chunks, else by its whole-document
    /// embedding. `NotFound` for an unknown document; `Invalid` for a document
    /// with nothing to search or an embedding of another dimension.
    #[app::view]
    pub fn search_document_by_embedding(
        &self,
        query_embedding: Vec<f32>,
        document_id: String,
    ) -> app::Result<String> {
        let document = self.stored(&document_id)?;
        let content = self.document_content.get(&document_id)?;
        if content.as_ref().is_some_and(|c| c.chunk_count > 0) {
            let chunks: Vec<DocumentChunk> = self
                .document_chunks
                .prefix(
                    &[KeyPart::Str(document_id.clone())],
                    FindOpts::default().limit(PAGE),
                )?
                .items
                .into_iter()
                .map(|(_, c)| c)
                .collect();
            return search_chunks(&document.name, &query_embedding, &chunks);
        }
        let content = content.unwrap_or(DocumentContent {
            embeddings: None,
            extracted_text: None,
            chunk_count: 0,
        });
        let Some(doc_embedding) = content.embeddings else {
            return Err(invalid("Document has no embeddings for semantic search"));
        };
        if doc_embedding.len() != query_embedding.len() {
            return Err(invalid(format!(
                "Embedding dimension mismatch: query={}, document={}",
                query_embedding.len(),
                doc_embedding.len()
            )));
        }
        let similarity = cosine_similarity(&query_embedding, &doc_embedding);
        if similarity < 0.05 {
            return Ok(format!(
                "Document: {} (Low relevance: {:.2})\nNo highly relevant content found for your query.",
                document.name, similarity
            ));
        }
        let text_snippet = match content.extracted_text {
            Some(full_text) => {
                let clean_text = full_text.replace(['\n', '\r'], " ").replace("  ", " ");
                let max_chars = if similarity > 0.4 {
                    400
                } else if similarity > 0.2 {
                    250
                } else {
                    150
                };
                truncate(clean_text, max_chars)
            }
            None => format!("Document: {} (No extracted text available)", document.name),
        };
        Ok(format!(
            "Document: {} (Similarity: {:.2})\n{}",
            document.name, similarity, text_snippet
        ))
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire.
#[app::error]
pub enum Error {
    /// No `what` has this id.
    NotFound { what: String, id: String },
    /// The caller may not do this: not the owner, not an admin, not a signer,
    /// no consent, removed, a guest.
    Forbidden { message: String },
    /// An argument is unusable, or the instance is not set up yet.
    Invalid { message: String },
    /// The state does not allow it now: already set up, already a
    /// participant, already signed, fully signed, a stale version, the last
    /// admin.
    Conflict { message: String },
}

/// A change, emitted after the write that caused it, to everyone the app
/// reaches.
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
        permission: PermissionLevel,
    },
}

// ── helpers on the state ─────────────────────────────────────────────────────

impl MeroSign {
    fn info(&self) -> app::Result<Info> {
        self.info
            .get()?
            .ok_or_else(|| invalid("This instance is not set up yet: its owner calls setup first"))
    }

    /// The caller, on a private library they own.
    fn private_owner(&self, not_private: &str) -> app::Result<String> {
        let info = self.info()?;
        if !info.is_private {
            return Err(invalid(not_private));
        }
        let me = account()?;
        if me != info.owner {
            return Err(forbidden("A private library answers its owner only"));
        }
        Ok(me)
    }

    fn shared(&self, private: &str) -> app::Result<()> {
        if self.info()?.is_private {
            return Err(invalid(private));
        }
        Ok(())
    }

    /// The caller, holding at least `minimum` in this agreement.
    fn require_level(&self, minimum: PermissionLevel) -> app::Result<String> {
        self.shared("This method can only be called from shared context")?;
        let me = account()?;
        match self.participants.get(&me)? {
            Some(level) if level.rank() >= minimum.rank() => Ok(me),
            Some(_) => Err(forbidden(format!(
                "{minimum:?} permission or higher is required for this operation"
            ))),
            None => Err(forbidden("You are not a participant in this agreement")),
        }
    }

    fn require_admin(&self) -> app::Result<String> {
        self.require_level(PermissionLevel::Admin)
            .map_err(|e| match e.code.as_str() {
                "Forbidden" => forbidden("Admin permissions required for this operation"),
                _ => e,
            })
    }

    fn set_level(&mut self, user: &String, level: PermissionLevel) -> app::Result<()> {
        let _ = self.participants.insert(user, &level)?;
        if level == PermissionLevel::Admin {
            let _ = self.admins.insert(user)?;
        } else {
            let _ = self.admins.remove(user)?;
        }
        let _ = self.removed.remove(user)?;
        Ok(())
    }

    fn participant_page(&self) -> app::Result<Vec<(String, PermissionLevel)>> {
        Ok(self
            .participants
            .page(FindOpts::default().limit(PAGE))?
            .items)
    }

    fn stored(&self, document_id: &str) -> app::Result<StoredDocument> {
        self.documents
            .get(&document_id.to_owned())?
            .ok_or_else(|| not_found("document", document_id))
    }

    fn signature_page(&self, document_id: &str) -> app::Result<Vec<SignedVersion>> {
        Ok(self
            .document_signatures
            .prefix(
                &[KeyPart::Str(document_id.to_owned())],
                FindOpts::default().limit(PAGE),
            )?
            .items
            .into_iter()
            .map(|(_, v)| v)
            .collect())
    }

    fn signers(&self, document_id: &str) -> app::Result<Vec<String>> {
        Ok(self
            .signature_page(document_id)?
            .into_iter()
            .map(|v| v.signer)
            .collect())
    }

    fn consented(&self, account: &str, document_id: &str) -> app::Result<bool> {
        Ok(self
            .consents
            .get(&(document_id.to_owned(), account.to_owned()))?
            .unwrap_or(false))
    }

    fn document_info(&self, id: String, doc: StoredDocument) -> app::Result<DocumentInfo> {
        let signed = self.signers(&id)?;
        let status = status_of(&doc, &signed);
        Ok(DocumentInfo {
            id,
            name: doc.name,
            hash: doc.current.hash,
            uploaded_by: doc.uploaded_by,
            uploaded_at: doc.uploaded_at,
            status,
            pdf_blob_id: doc.current.pdf_blob_id,
            size: doc.current.size,
            required_signers: doc.required_signers,
            embeddings: None,
            extracted_text: None,
            chunks: None,
        })
    }
}

// ── free helpers ─────────────────────────────────────────────────────────────

/// The calling account; `LoginRequired` for anything that is not one.
fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

fn status_of(doc: &StoredDocument, signed: &[String]) -> DocumentStatus {
    if signed.is_empty() {
        DocumentStatus::Pending
    } else if doc.required_signers.iter().all(|r| signed.contains(r)) {
        DocumentStatus::FullySigned
    } else {
        DocumentStatus::PartiallySigned
    }
}

/// A blob id: 64 hex digits (a SHA-256), answered in lowercase.
fn blob_id(id: &str) -> app::Result<String> {
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(invalid(format!(
            "Invalid blob ID '{id}': expected 64 hex digits"
        )));
    }
    Ok(id.to_ascii_lowercase())
}

fn non_empty(field: &str, value: String) -> app::Result<String> {
    if value.trim().is_empty() {
        return Err(invalid(format!("{field} must not be empty")));
    }
    Ok(value)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Every entry whose key starts with `first`, a page at a time.
fn clear_prefix<K, V>(map: &mut UnorderedMap<K, V>, first: &str) -> app::Result<()>
where
    K: ToKey + FromKey,
    V: Serialize + serde::de::DeserializeOwned,
{
    loop {
        let page = map.prefix(
            &[KeyPart::Str(first.to_owned())],
            FindOpts::default().limit(PAGE),
        )?;
        if page.items.is_empty() {
            return Ok(());
        }
        for (key, _) in page.items {
            let _ = map.remove(&key)?;
        }
    }
}

fn truncate(text: String, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((at, _)) => format!("{}...", &text[..at]),
        None => text,
    }
}

fn search_chunks(name: &str, query: &[f32], chunks: &[DocumentChunk]) -> app::Result<String> {
    let Some(first) = chunks.first() else {
        return Err(invalid("Document has no chunks for semantic search"));
    };
    if first.embedding.len() != query.len() {
        return Err(invalid(format!(
            "Embedding dimension mismatch: query={}, document chunks={}",
            query.len(),
            first.embedding.len()
        )));
    }
    let mut scored: Vec<(&DocumentChunk, f32)> = chunks
        .iter()
        .map(|c| (c, cosine_similarity(query, &c.embedding)))
        .filter(|(_, s)| *s > 0.1)
        .collect();
    if scored.is_empty() {
        return Ok(format!(
            "Document: {name}\nNo relevant sections found for your query. The document may not contain information related to your question."
        ));
    }
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let top: Vec<String> = scored
        .into_iter()
        .take(3)
        .map(|(chunk, similarity)| {
            let clean = chunk
                .text
                .trim()
                .replace(['\n', '\r'], " ")
                .replace("  ", " ");
            let max_chars = if similarity > 0.5 {
                300
            } else if similarity > 0.3 {
                200
            } else {
                150
            };
            format!(
                "[Relevance: {:.2}] {}",
                similarity,
                truncate(clean, max_chars)
            )
        })
        .collect();
    Ok(format!(
        "Document: {name}\nMost relevant sections:\n\n{}",
        top.join("\n\n")
    ))
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm_a = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        0.0
    } else {
        dot / (norm_a * norm_b)
    }
}

fn not_found(what: &str, id: &str) -> AppError {
    Error::NotFound {
        what: what.to_owned(),
        id: id.to_owned(),
    }
    .into()
}

fn forbidden(message: impl Into<String>) -> AppError {
    Error::Forbidden {
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
