#![allow(clippy::len_without_is_empty)]

use std::cmp::Ordering;
use std::collections::BTreeSet;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::{app, env, AccountId, PublicKey};
use calimero_storage::collections::{
    AccessControl, Frozen, LwwRegister, Mergeable, ModeratedOnce, SortedMap, UnorderedMap,
    UserStorage, WriteOnce,
};

pub type UserId = [u8; 32];
pub type BlobId = [u8; 32];
pub type ContextId = [u8; 32];

// ── LWW convergence helper ───────────────────────────────────────────────────

/// Take `other` iff it wins a **total order** of (clock, canonical borsh bytes).
///
/// A bare `other.ts > self.ts` is not commutative, and from core 0.11.0-rc.32
/// that is a live bug rather than a latent one. At an exact clock tie with
/// differing content each replica keeps its own copy: `merge` changes nothing
/// on either side, so re-merging never closes the gap and the two stay
/// divergent permanently, with no error. Breaking the tie on the borsh
/// encoding — a total order over values — makes both replicas elect the same
/// winner independently, which is what convergence requires.
///
/// Before [core#3807] a collection value's `merge` was never called (entries
/// resolved last-write-wins by write ORDER), so these rules were dead code and
/// the tie could not be observed. `#[app::mergeable]` turns them on.
///
/// [core#3807]: https://github.com/calimero-network/core/pull/3807
fn lww_take<T: BorshSerialize>(mine_ts: u64, theirs_ts: u64, mine: &T, theirs: &T) -> bool {
    match theirs_ts.cmp(&mine_ts) {
        Ordering::Greater => true,
        Ordering::Less => false,
        // Equal clocks: decide on the canonical encoding, so both replicas
        // elect the same side.
        //
        // Infallible on purpose. Core's contract for a dispatched merge
        // requires a TOTAL rule — "`Err` is not validation, it is a refusal to
        // converge: the entity stays divergent and repair retries it
        // indefinitely" — so this must not surface an encoding error. A value
        // that came back out of storage was borsh-encoded to get there, which
        // is why the fallback is unreachable rather than merely unlikely.
        Ordering::Equal => {
            let encode = |v: &T| calimero_sdk::borsh::to_vec(v).unwrap_or_default();
            encode(theirs) > encode(mine)
        }
    }
}

/// Signature record - uses LWW based on created_at timestamp
#[app::mergeable(id = "mero_sign::SignatureRecord")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct SignatureRecord {
    pub id: u64,
    pub name: String,
    pub blob_id: BlobId,
    pub size: u64,
    pub created_at: u64,
}

impl Mergeable for SignatureRecord {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        // LWW based on created_at - newer wins
        if lww_take(self.created_at, other.created_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContextAgreement {
    pub context_id: ContextId,
    pub agreement_name: String,
    pub joined_at: u64,
}

/// Participant roles in shared contexts
#[derive(
    AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, PartialEq,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum ParticipantRole {
    Owner,
    Signer,
    Viewer,
    Unknown,
}

/// Document chunk with its embedding
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocumentChunk {
    pub text: String,
    pub embedding: Vec<f32>,
    pub start_position: usize,
    pub end_position: usize,
}

/// A document as uploaded. Written once: nobody, the uploader included, can
/// change it afterwards, and only an admin (a moderator of `documents`) can
/// remove it. The uploader is the entry's owner stamp.
///
/// What signing changes is recorded beside it, one write-once
/// [`SignedVersion`] per signature, never by rewriting this.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct StoredDocument {
    pub name: String,
    pub hash: String,
    pub pdf_blob_id: BlobId,
    pub size: u64,
    pub uploaded_at: u64,
    /// Who must sign it: every participant holding `Sign` or `Admin` when it
    /// was uploaded. Fixed with the document, so completion is a fact about
    /// the past — nobody who joins later reopens it.
    pub required_signers: Vec<UserId>,
    pub embeddings: Option<Vec<f32>>,
    pub extracted_text: Option<String>,
    pub chunks: Option<Vec<DocumentChunk>>,
}

/// One signature: the signer (the entry's owner stamp) took the version at
/// `base_hash`, put their mark on it, and produced the version at `new_hash`,
/// stored as `pdf_blob_id`. Written once, so a signature can be neither
/// withdrawn nor edited, and the version it signed stays on record.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct SignedVersion {
    pub base_hash: String,
    pub new_hash: String,
    pub pdf_blob_id: BlobId,
    pub size: u64,
    pub signed_at: u64,
}

/// Document information as read: the uploaded document, its current version
/// (the last signature's, or the upload's) and its status, derived every read
/// from the write-once entries.
///
/// `embeddings`, `extracted_text` and `chunks` are always `None` in
/// `list_documents`, which returns every document; they stay in storage for
/// `search_document_by_embedding`.
#[derive(AbiType, Debug, Clone, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocumentInfo {
    pub id: String,
    pub name: String,
    pub hash: String,
    pub uploaded_by: UserId,
    pub uploaded_at: u64,
    pub status: DocumentStatus,
    pub pdf_blob_id: BlobId,
    pub size: u64,
    pub required_signers: Vec<UserId>,
    pub embeddings: Option<Vec<f32>>,
    pub extracted_text: Option<String>,
    pub chunks: Option<Vec<DocumentChunk>>,
}

/// Document status, derived from the document's signatures.
///
/// `FullySigned` IS TERMINAL. Completion is a fact about the past: the
/// signers a document waits for are fixed when it is uploaded, its signatures
/// are written once, and a completed document refuses further signatures. A
/// participant added later was not party to it; if they need to be, that is a
/// new document.
#[derive(AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum DocumentStatus {
    Pending,
    PartiallySigned,
    FullySigned,
}

/// A signature on a document, as read. `signer` is the entry's owner stamp.
#[derive(AbiType, Debug, Clone, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocumentSignature {
    pub signer: UserId,
    pub signed_at: u64,
}

/// Permission levels for participants
#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum PermissionLevel {
    Read,
    Sign,
    Admin,
}

fn rank(level: &PermissionLevel) -> u8 {
    match level {
        PermissionLevel::Admin => 2,
        PermissionLevel::Sign => 1,
        PermissionLevel::Read => 0,
    }
}

/// Roles in [`AccessControl`]. Admin is the registry's own admin tier.
const ROLE_SIGNER: &str = "signer";
const ROLE_VIEWER: &str = "viewer";
/// Set by an admin's `remove_participant`: overrides a self-registration,
/// which only its registrant could otherwise withdraw.
const ROLE_REMOVED: &str = "removed";

/// Metadata for tracking joined shared contexts
#[app::mergeable(id = "mero_sign::ContextMetadata")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContextMetadata {
    pub context_id: ContextId,
    pub context_name: String,
    pub role: ParticipantRole,
    pub joined_at: u64,
    pub private_identity: UserId,
    pub shared_identity: UserId,
}

impl Mergeable for ContextMetadata {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        // LWW based on joined_at - newer wins
        if lww_take(self.joined_at, other.joined_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// Identity mapping for tracking user identities across contexts
#[app::mergeable(id = "mero_sign::IdentityMapping")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct IdentityMapping {
    pub private_identity: UserId,
    pub shared_identity: UserId,
    pub context_id: ContextId,
    pub created_at: u64,
}

impl Mergeable for IdentityMapping {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        // LWW based on created_at - newer wins
        if lww_take(self.created_at, other.created_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// One account's consents, in that account's own [`UserStorage`] slot: only
/// they can give (or forge) their consent, and nobody can occupy the entry.
#[derive(AbiType, Debug, Default, BorshSerialize, BorshDeserialize, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Consents {
    documents: UnorderedMap<String, LwwRegister<bool>>,
}

/// Participant information with permission level
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ParticipantInfo {
    pub user_id: UserId,
    pub permission_level: PermissionLevel,
}

/// Detailed information about a shared context
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContextDetails {
    pub context_id: ContextId,
    pub context_name: String,
    pub owner: UserId,
    pub is_private: bool,
    pub participant_count: u64,
    pub participants: Vec<ParticipantInfo>,
    pub document_count: u64,
    pub created_at: u64,
}

/// Every field that decides who may do what is guarded by a storage type,
/// because a member running a modified node skips every check in the methods
/// below and writes plain fields directly:
///
/// | field | who may write it, on every node |
/// |---|---|
/// | `is_private`, `owner`, `context_name` | nobody after `init` (`Frozen`) |
/// | `roles` | admins (`AccessControl`'s writer set) |
/// | `joined` | each account its own slot (`UserStorage`) |
/// | `documents` | anyone adds; nobody edits; admins remove (`ModeratedOnce`) |
/// | `document_signatures` | each signer their own; nobody edits or removes (`WriteOnce`) |
/// | `consents` | each account its own slot (`UserStorage`) |
///
/// The private-context fields (`signatures`, `joined_contexts`,
/// `identity_mappings`) are plain: a private context holds its owner's
/// account alone.
#[app::state(emits = MeroSignEvent)]
pub struct MeroSignState {
    // Context type flag
    pub is_private: Frozen<bool>,

    pub owner: Frozen<UserId>,
    pub context_name: Frozen<String>,

    // Private context data
    pub signatures: UnorderedMap<String, SignatureRecord>,
    pub joined_contexts: UnorderedMap<String, ContextMetadata>,
    pub identity_mappings: UnorderedMap<String, IdentityMapping>,

    // Shared context data
    /// Admin, signer and viewer grants, and removals.
    pub roles: AccessControl,
    /// Accounts that registered themselves through an open invitation: `Sign`
    /// unless an admin set another level or removed them.
    pub joined: UserStorage<LwwRegister<u64>>,
    /// Moderated by the admins, kept equal to `roles.admins()`.
    pub documents: ModeratedOnce<UnorderedMap<String, StoredDocument>>,
    /// `"{document_id}/{signer hex}/{nonce}"`: a document's signatures are one
    /// prefix, and the nonce leaves no key for anyone to occupy first.
    pub document_signatures: WriteOnce<SortedMap<String, SignedVersion>>,
    pub consents: UserStorage<Consents>,
}

#[app::event]
pub enum MeroSignEvent {
    // Private context events
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

    // Shared context events
    DocumentUploaded {
        id: String,
        name: String,
        uploaded_by: UserId,
    },
    DocumentDeleted {
        id: String,
    },
    DocumentSigned {
        document_id: String,
        signer: UserId,
    },
    ParticipantInvited {
        user_id: UserId,
        role: ParticipantRole,
    },
    ParticipantJoined {
        user_id: UserId,
    },
    ParticipantLeft {
        user_id: UserId,
    },
    /// An admin changed an existing participant's permission level.
    ParticipantPermissionChanged {
        user_id: UserId,
        permission: PermissionLevel,
    },
}

/// Helper to decode base58 blob_id from API input
/// Ids are HEX, not base58.
///
/// core 0.11.0-rc.27 removed base58 from ids entirely, so every id this contract
/// receives — a blob id from `upload_blob`, a context id, an account — is hex.
/// Decoding base58 failed with `contained invalid character '0' at byte 1`,
/// because base58 has no `0`: the alphabet omits it. That is what a hex id looks
/// like to a base58 decoder, and it is not an obvious message.
fn parse_blob_id_hex(blob_id_str: &str) -> app::Result<BlobId> {
    match hex::decode(blob_id_str) {
        Ok(bytes) => {
            if bytes.len() != 32 {
                return Err(AppError::msg(format!(
                    "Invalid blob ID length: expected 32 bytes, got {}",
                    bytes.len()
                )));
            }
            let mut blob_id = [0u8; 32];
            blob_id.copy_from_slice(&bytes);
            Ok(blob_id)
        }
        Err(e) => Err(AppError::msg(format!(
            "Failed to decode blob ID (expected hex) '{}': {}",
            blob_id_str, e
        ))),
    }
}

/// Helper to decode base58 public key from API input
fn parse_public_key_hex(key_str: &str) -> app::Result<UserId> {
    key_str
        .parse::<PublicKey>()
        .map(|pk| *pk.as_ref())
        .map_err(|e| AppError::msg(format!("Failed to parse public key '{}': {}", key_str, e)))
}

/// Helper to decode base58 context ID from API input
fn parse_context_id_hex(context_id_str: &str) -> app::Result<ContextId> {
    match hex::decode(context_id_str) {
        Ok(bytes) => {
            if bytes.len() != 32 {
                return Err(AppError::msg(format!(
                    "Invalid context ID length: expected 32 bytes, got {}",
                    bytes.len()
                )));
            }
            let mut context_id = [0u8; 32];
            context_id.copy_from_slice(&bytes);
            Ok(context_id)
        }
        Err(e) => Err(AppError::msg(format!(
            "Failed to decode context ID (expected hex) '{}': {}",
            context_id_str, e
        ))),
    }
}

/// Helper to encode context ID to base58 string
fn encode_context_id_base58(context_id: &ContextId) -> String {
    hex::encode(context_id)
}

fn store_err(what: &str) -> impl Fn(calimero_storage::collections::StoreError) -> AppError + '_ {
    move |e| AppError::msg(format!("{what}: {e:?}"))
}

/// A document's signatures in the order they were applied, with their
/// signers: starting from the uploaded version, each is the signature built
/// on the version before it.
///
/// Two signers who built on the same version (a race the `base_hash` check
/// narrows but cannot close) fork it; the fork is decided the same way on
/// every node — a required signer first, then the earlier signature, then the
/// key — and the other signature is not on the document: its mark is not in
/// the current PDF, so its signer may sign again. Each signer appears once.
fn chain(
    records: Vec<(String, UserId, SignedVersion)>,
    doc: &StoredDocument,
) -> Vec<(UserId, SignedVersion)> {
    let mut out: Vec<(UserId, SignedVersion)> = Vec::new();
    let mut hash = doc.hash.clone();
    loop {
        let next = records
            .iter()
            .filter(|(_, signer, v)| v.base_hash == hash && !out.iter().any(|(s, _)| s == signer))
            .min_by_key(|(key, signer, v)| {
                (
                    !doc.required_signers.contains(signer),
                    v.signed_at,
                    key.clone(),
                )
            });
        let Some((_, signer, v)) = next else {
            return out;
        };
        hash = v.new_hash.clone();
        out.push((*signer, v.clone()));
    }
}

fn status_of(doc: &StoredDocument, signed: &[(UserId, SignedVersion)]) -> DocumentStatus {
    if signed.is_empty() {
        DocumentStatus::Pending
    } else if doc
        .required_signers
        .iter()
        .all(|r| signed.iter().any(|(s, _)| s == r))
    {
        DocumentStatus::FullySigned
    } else {
        DocumentStatus::PartiallySigned
    }
}

#[app::logic]
impl MeroSignState {
    #[app::init]
    pub fn init(is_private: bool, context_name: String) -> MeroSignState {
        // The ACCOUNT, not the device: a document is signed by a PERSON, and one
        // signer on two machines must not read as two distinct signatories.
        let owner_raw = env::account_id();

        // The creator is the first admin of a shared context, and the first
        // moderator of its documents.
        MeroSignState {
            is_private: Frozen::new(is_private),
            owner: Frozen::new(owner_raw),
            context_name: Frozen::new(context_name),

            signatures: UnorderedMap::new(),
            joined_contexts: UnorderedMap::new(),
            identity_mappings: UnorderedMap::new(),
            roles: AccessControl::new(AccountId::from(owner_raw)),
            joined: UserStorage::new(),
            documents: ModeratedOnce::new(),
            document_signatures: WriteOnce::new(),
            consents: UserStorage::new(),
        }
    }

    fn private(&self) -> app::Result<bool> {
        Ok(*self.is_private.get()?)
    }

    pub fn is_default_private_context(&self) -> bool {
        self.private().unwrap_or(false)
            && self
                .context_name
                .get()
                .is_ok_and(|name| name.as_str() == "default")
    }

    /// Create a new signature and store its blob ID
    pub fn create_signature(
        &mut self,
        name: String,
        blob_id_str: String,
        data_size: u64,
    ) -> app::Result<u64> {
        if !self.private()? {
            return Err(AppError::msg(
                "Signatures can only be created in private context".to_string(),
            ));
        }

        // Random, not a counter: two devices of the owner creating a signature
        // at once read the same count and one overwrote the other.
        let mut id_bytes = [0u8; 8];
        env::random_bytes(&mut id_bytes);
        let signature_id = u64::from_le_bytes(id_bytes);

        let blob_id = parse_blob_id_hex(&blob_id_str)?;

        // `blob_announce_to_context` returns once the announce is SCHEDULED, not
        // once it is delivered — and since rc.39 it feeds availability-node
        // prefetch only, never discovery (peers find blobs by probe now). A
        // `false` here is therefore not a failure worth warning about, and the
        // old "Failed to announce" line was a false alarm in every e2e log.
        let current_context = env::context_id();
        if !env::blob_announce_to_context(&blob_id, &current_context) {
            app::log!(
                "Announce not scheduled for signature blob {} (prefetch only)",
                blob_id_str
            );
        }

        let signature = SignatureRecord {
            id: signature_id,
            name: name.clone(),
            blob_id,
            size: data_size,
            created_at: env::time_now(),
        };

        self.signatures
            .insert(signature_id.to_string(), signature)
            .map_err(|e| AppError::msg(format!("Failed to store signature: {:?}", e)))?;

        app::emit!(MeroSignEvent::SignatureCreated {
            id: signature_id,
            name,
            size: data_size,
        });

        Ok(signature_id)
    }

    /// Delete a signature by ID
    pub fn delete_signature(&mut self, signature_id: u64) -> app::Result<()> {
        if !self.private()? {
            return Err(AppError::msg(
                "Signatures can only be deleted in private context".to_string(),
            ));
        }

        let key = signature_id.to_string();

        match self.signatures.remove(&key) {
            Ok(Some(_)) => {
                app::emit!(MeroSignEvent::SignatureDeleted { id: signature_id });
                Ok(())
            }
            Ok(None) => Err(AppError::msg(format!(
                "Signature not found: {}",
                signature_id
            ))),
            Err(e) => Err(AppError::msg(format!(
                "Failed to delete signature: {:?}",
                e
            ))),
        }
    }

    /// Get all signatures
    pub fn list_signatures(&self) -> app::Result<Vec<SignatureRecord>> {
        if !self.private()? {
            return Err(AppError::msg(
                "Signatures can only be accessed in private context".to_string(),
            ));
        }

        let mut signatures = Vec::new();
        if let Ok(entries) = self.signatures.entries() {
            for (_, signature) in entries {
                signatures.push(signature.clone());
            }
        }
        Ok(signatures)
    }

    /// Join a shared context with identity mapping
    pub fn join_shared_context(
        &mut self,
        context_id_str: String,
        shared_identity_str: String,
        context_name: String,
    ) -> app::Result<()> {
        if !self.private()? {
            return Err(AppError::msg(
                "Context joining can only be managed in private context".to_string(),
            ));
        }

        let context_id = parse_context_id_hex(&context_id_str)?;
        let context_id_key = encode_context_id_base58(&context_id);

        if self
            .joined_contexts
            .contains(&context_id_key)
            .unwrap_or(false)
        {
            return Err(AppError::msg("Already joined this context".to_string()));
        }

        let private_identity = *self.owner.get()?;
        let shared_identity = parse_public_key_hex(&shared_identity_str)?;

        let metadata = ContextMetadata {
            context_id,
            context_name: context_name.clone(),
            role: ParticipantRole::Unknown,
            joined_at: env::time_now(),
            private_identity,
            shared_identity,
        };

        let identity_mapping = IdentityMapping {
            private_identity,
            shared_identity,
            context_id,
            created_at: env::time_now(),
        };

        self.joined_contexts
            .insert(context_id_key.clone(), metadata)
            .map_err(|e| AppError::msg(format!("Failed to join context: {:?}", e)))?;

        self.identity_mappings
            .insert(context_id_key.clone(), identity_mapping)
            .map_err(|e| AppError::msg(format!("Failed to store identity mapping: {:?}", e)))?;

        app::emit!(MeroSignEvent::ContextJoined {
            context_id: context_id_str,
            context_name
        });
        Ok(())
    }

    /// Leave a shared context
    pub fn leave_shared_context(&mut self, context_id_str: String) -> app::Result<()> {
        if !self.private()? {
            return Err(AppError::msg(
                "Context leaving can only be managed in private context".to_string(),
            ));
        }

        let context_id = parse_context_id_hex(&context_id_str)?;
        let context_id_key = encode_context_id_base58(&context_id);

        match self.joined_contexts.remove(&context_id_key) {
            Ok(Some(_)) => {
                let _ = self.identity_mappings.remove(&context_id_key);
                app::emit!(MeroSignEvent::ContextLeft {
                    context_id: context_id_str
                });
                Ok(())
            }
            Ok(None) => Err(AppError::msg("Context not found".to_string())),
            Err(e) => Err(AppError::msg(format!("Failed to leave context: {:?}", e))),
        }
    }

    /// List all joined contexts
    pub fn list_joined_contexts(&self) -> app::Result<Vec<ContextMetadata>> {
        if !self.private()? {
            return Err(AppError::msg(
                "Joined contexts can only be accessed in private context".to_string(),
            ));
        }

        let mut contexts = Vec::new();
        if let Ok(entries) = self.joined_contexts.entries() {
            for (_, metadata) in entries {
                contexts.push(metadata.clone());
            }
        }
        Ok(contexts)
    }

    // === SHARED CONTEXT METHODS ===

    /// Get detailed information about the shared context
    pub fn get_context_details(&self, context_id_str: String) -> app::Result<ContextDetails> {
        let context_id = parse_context_id_hex(&context_id_str)?;
        let mut participants_with_permissions = Vec::new();
        for user_id in self.participant_ids()? {
            let permission_level = self.level_of(&user_id)?.unwrap_or(PermissionLevel::Read);
            participants_with_permissions.push(ParticipantInfo {
                user_id,
                permission_level,
            });
        }

        let document_count = self
            .documents
            .len()
            .map_err(|e| AppError::msg(format!("Failed to get document count: {:?}", e)))?
            as u64;

        let context_details = ContextDetails {
            context_id,
            context_name: self.context_name.get()?.clone(),
            owner: *self.owner.get()?,
            is_private: self.private()?,
            participant_count: participants_with_permissions.len() as u64,
            participants: participants_with_permissions,
            document_count,
            created_at: env::time_now(),
        };

        Ok(context_details)
    }

    /// A participant's level: `None` for someone who is not one.
    ///
    /// Read from storage every node enforces: the admin tier and grants of
    /// `roles`, which only admins write, and the account's own `joined` slot,
    /// which only it writes. An admin's removal outranks a self-registration.
    fn level_of(&self, account: &UserId) -> app::Result<Option<PermissionLevel>> {
        let who = AccountId::from(*account);
        let has = |role: &str| {
            self.roles
                .has_role(role, &who)
                .map_err(store_err("Failed to check user permissions"))
        };
        Ok(if self.roles.is_admin(&who) {
            Some(PermissionLevel::Admin)
        } else if has(ROLE_REMOVED)? {
            None
        } else if has(ROLE_VIEWER)? {
            Some(PermissionLevel::Read)
        } else if has(ROLE_SIGNER)?
            || self
                .joined
                .contains_user(&who)
                .map_err(store_err("Failed to check user permissions"))?
        {
            Some(PermissionLevel::Sign)
        } else {
            None
        })
    }

    /// Every participant, in account order.
    fn participant_ids(&self) -> app::Result<Vec<UserId>> {
        let mut candidates: BTreeSet<UserId> = self
            .roles
            .admins()
            .into_iter()
            .map(|a| *a.as_bytes())
            .collect();
        for role in [ROLE_SIGNER, ROLE_VIEWER] {
            for who in self
                .roles
                .members_of(role)
                .map_err(store_err("Failed to list participants"))?
            {
                let _ = candidates.insert(*who.as_bytes());
            }
        }
        for (who, _) in self
            .joined
            .entries()
            .map_err(store_err("Failed to list participants"))?
        {
            let _ = candidates.insert(*who.as_bytes());
        }
        let mut out = Vec::new();
        for id in candidates {
            if self.level_of(&id)?.is_some() {
                out.push(id);
            }
        }
        Ok(out)
    }

    /// The admin gate for this shared context.
    ///
    /// The ACCOUNT, not the device: an admin on a second machine must still be
    /// an admin. This check only makes a refused call fail early — every node
    /// refuses a non-admin's write to `roles` or removal from `documents`.
    fn validate_admin_permissions(&self) -> app::Result<()> {
        if self.private()? {
            return Err(AppError::msg(
                "This method can only be called from shared context".to_string(),
            ));
        }

        match self.level_of(&env::account_id())? {
            Some(PermissionLevel::Admin) => Ok(()),
            Some(_) => Err(AppError::msg(
                "Admin permissions required for this operation".to_string(),
            )),
            None => Err(AppError::msg("User permissions not found".to_string())),
        }
    }

    /// Require the CALLER to be a participant holding at least `minimum`.
    fn require_permission(&self, minimum: PermissionLevel) -> app::Result<()> {
        if self.private()? {
            return Err(AppError::msg(
                "This method can only be called from shared context".to_string(),
            ));
        }

        match self.level_of(&env::account_id())? {
            Some(level) if rank(&level) >= rank(&minimum) => Ok(()),
            Some(_) => Err(AppError::msg(format!(
                "{:?} permission or higher is required for this operation",
                minimum
            ))),
            None => Err(AppError::msg(
                "You are not a participant in this agreement".to_string(),
            )),
        }
    }

    /// Set `user`'s level through `roles`, then make the documents' moderators
    /// the admins again. Only an admin may; every node enforces both writes.
    fn set_level(&mut self, user: UserId, level: &PermissionLevel) -> app::Result<()> {
        let who = AccountId::from(user);
        let err = store_err("Failed to set permissions");
        let is_admin = self.roles.is_admin(&who);
        if *level != PermissionLevel::Admin && is_admin && self.roles.admins().len() <= 1 {
            return Err(AppError::msg(
                "An agreement needs at least one admin: promote someone else first".to_string(),
            ));
        }
        // Every grant before the admin revoke: an admin stepping themselves
        // down stops being able to grant on the line that revokes them. They
        // are still a moderator until the moderators are replaced, last.
        match level {
            PermissionLevel::Admin => {
                if !is_admin {
                    self.roles.grant_admin(who).map_err(&err)?;
                }
            }
            PermissionLevel::Sign => {
                self.roles.grant(ROLE_SIGNER, who).map_err(&err)?;
                self.roles.revoke(ROLE_VIEWER, &who).map_err(&err)?;
            }
            PermissionLevel::Read => {
                self.roles.grant(ROLE_VIEWER, who).map_err(&err)?;
                self.roles.revoke(ROLE_SIGNER, &who).map_err(&err)?;
            }
        }
        self.roles.revoke(ROLE_REMOVED, &who).map_err(&err)?;
        if *level != PermissionLevel::Admin && is_admin {
            self.roles.revoke_admin(&who).map_err(&err)?;
        }
        self.sync_moderators()
    }

    /// The admins moderate `documents`: they are who may delete one.
    fn sync_moderators(&mut self) -> app::Result<()> {
        let admins = self.roles.admins();
        if self.documents.moderators() != admins {
            self.documents
                .set_moderators(admins)
                .map_err(store_err("Failed to update document moderators"))?;
        }
        Ok(())
    }

    /// A stored document, or an error naming it.
    fn stored(&self, document_id: &str) -> app::Result<StoredDocument> {
        self.documents
            .get(&document_id.to_owned())
            .map_err(store_err("Failed to get document"))?
            .ok_or_else(|| AppError::msg("Document not found".to_string()))
    }

    /// The document's signatures on it, in order; see [`chain`].
    ///
    /// Signatures from accounts that neither must sign the document nor hold
    /// `Sign` now are ignored, so a member who is not a signer cannot put a
    /// version of their own on it.
    fn signed_chain(
        &self,
        document_id: &str,
        doc: &StoredDocument,
    ) -> app::Result<Vec<(UserId, SignedVersion)>> {
        let err = store_err("Failed to get document signatures");
        let mut records = Vec::new();
        for (key, version) in self
            .document_signatures
            .prefix(format!("{document_id}/").as_bytes())
            .map_err(&err)?
        {
            let Some(owner) = self.document_signatures.owner_of(&key).map_err(&err)? else {
                continue;
            };
            let signer = *owner.as_bytes();
            let may_sign = doc.required_signers.contains(&signer)
                || self
                    .level_of(&signer)?
                    .is_some_and(|l| rank(&l) >= rank(&PermissionLevel::Sign));
            if may_sign {
                records.push((key, signer, version));
            }
        }
        Ok(chain(records, doc))
    }

    fn info(
        &self,
        id: String,
        doc: StoredDocument,
        with_content: bool,
    ) -> app::Result<DocumentInfo> {
        let uploaded_by = self
            .documents
            .owner_of(&id)
            .map_err(store_err("Failed to get document"))?
            .map(|a| *a.as_bytes())
            .unwrap_or_default();
        let signed = self.signed_chain(&id, &doc)?;
        let status = status_of(&doc, &signed);
        let (hash, pdf_blob_id, size) = match signed.last() {
            Some((_, v)) => (v.new_hash.clone(), v.pdf_blob_id, v.size),
            None => (doc.hash.clone(), doc.pdf_blob_id, doc.size),
        };
        Ok(DocumentInfo {
            id,
            name: doc.name,
            hash,
            uploaded_by,
            uploaded_at: doc.uploaded_at,
            status,
            pdf_blob_id,
            size,
            required_signers: doc.required_signers,
            embeddings: doc.embeddings.filter(|_| with_content),
            extracted_text: doc.extracted_text.filter(|_| with_content),
            chunks: doc.chunks.filter(|_| with_content),
        })
    }

    /// Upload a document
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
        // A reader reads.
        self.require_permission(PermissionLevel::Sign)?;

        // NOT `doc_<millis>_<name>`: two uploads of the same filename inside one
        // millisecond produced the same key. Random bytes are unique without
        // coordination, and leave no key for anyone to occupy first.
        let mut id_bytes = [0u8; 16];
        env::random_bytes(&mut id_bytes);
        let document_id = format!("doc_{}", hex::encode(id_bytes));

        let pdf_blob_id = parse_blob_id_hex(&pdf_blob_id_str)?;

        // Announce is scheduled, not delivered, and since rc.39 it feeds
        // availability-node prefetch only — never discovery. A `false` is not a
        // failure. See the note on the signature-blob announce above.
        let current_context = env::context_id();
        if !env::blob_announce_to_context(&pdf_blob_id, &current_context) {
            app::log!(
                "Announce not scheduled for PDF blob {} (prefetch only)",
                pdf_blob_id_str
            );
        }

        let mut required_signers = Vec::new();
        for id in self.participant_ids()? {
            if self
                .level_of(&id)?
                .is_some_and(|l| rank(&l) >= rank(&PermissionLevel::Sign))
            {
                required_signers.push(id);
            }
        }
        let uploaded_by = env::account_id();
        let document = StoredDocument {
            name: name.clone(),
            hash,
            pdf_blob_id,
            size: file_size,
            uploaded_at: env::time_now(),
            required_signers,
            embeddings,
            extracted_text,
            chunks,
        };

        self.documents
            .insert(document_id.clone(), document)
            .map_err(|e| AppError::msg(format!("Failed to upload document: {:?}", e)))?;

        app::emit!(MeroSignEvent::DocumentUploaded {
            id: document_id.clone(),
            name,
            uploaded_by,
        });

        Ok(document_id)
    }

    /// Delete a document by ID. Admins only: they are the documents'
    /// moderators, and every node refuses anyone else's removal.
    pub fn delete_document(&mut self, document_id: String) -> app::Result<()> {
        self.validate_admin_permissions()?;

        match self.documents.remove(&document_id) {
            Ok(Some(_)) => {
                app::emit!(MeroSignEvent::DocumentDeleted { id: document_id });
                Ok(())
            }
            Ok(None) => Err(AppError::msg(format!(
                "Document not found: {}",
                document_id
            ))),
            Err(e) => Err(AppError::msg(format!("Failed to delete document: {:?}", e))),
        }
    }

    /// List all documents, without their search content (see [`DocumentInfo`]).
    pub fn list_documents(&self) -> app::Result<Vec<DocumentInfo>> {
        let entries: Vec<(String, StoredDocument)> = self
            .documents
            .entries()
            .map_err(store_err("Failed to list documents"))?
            .collect();
        let mut documents = Vec::new();
        for (id, doc) in entries {
            documents.push(self.info(id, doc, false)?);
        }
        Ok(documents)
    }

    /// Record the CALLER's consent to sign a document, in their own slot.
    ///
    /// Consent is a personal act. Nobody can give it for you, so there is no
    /// parameter to give — and the slot is yours alone on every node.
    pub fn set_consent(&mut self, document_id: String) -> app::Result<()> {
        let err = store_err("Failed to store consent");
        let mut consents = self.consents.get().map_err(&err)?.unwrap_or_default();
        let _ = consents
            .documents
            .insert(document_id, true.into())
            .map_err(&err)?;
        let _ = self.consents.insert(consents).map_err(&err)?;
        Ok(())
    }

    /// Check if user has given consent for a document (internal helper)
    fn check_consent(&self, user_id: &UserId, document_id: &str) -> app::Result<bool> {
        let err = store_err("Failed to check consent");
        let Some(consents) = self
            .consents
            .get_for_user(&AccountId::from(*user_id))
            .map_err(&err)?
        else {
            return Ok(false);
        };
        Ok(consents
            .documents
            .get(document_id)
            .map_err(&err)?
            .is_some_and(|c| *c.get()))
    }

    /// Check if user has given consent for a document (public API)
    pub fn has_consented(&self, user_id_str: String, document_id: String) -> app::Result<bool> {
        let user_id = parse_public_key_hex(&user_id_str)?;
        self.check_consent(&user_id, &document_id)
    }

    /// Record the CALLER's signature on a document.
    ///
    /// The signer is the caller's ACCOUNT — a document is signed by a PERSON,
    /// and one signer on two machines must not read as two signatories — and on
    /// every other node it is the signature entry's owner stamp. There is no
    /// signer parameter.
    ///
    /// A signature is not a field value, it is a whole new PDF: the signer
    /// downloads the current version, flattens their mark into it in the
    /// browser, uploads the result as a NEW blob, and records it here as a
    /// write-once [`SignedVersion`] from `base_hash` to `new_hash`. Nothing is
    /// overwritten: the uploaded document and every signature stay on record,
    /// and the document's current version is the last one in the chain.
    ///
    /// `base_hash` is the hash the signer actually had in front of them. If it
    /// is not the current version, somebody else signed in the meantime and
    /// this PDF lacks their mark — refused, so the signer re-fetches and
    /// re-signs.
    ///
    /// ⚠️ `pdf_blob_id_str` must name a blob THIS node holds. The announce below
    /// fails the whole call otherwise, with
    /// `blob operations not supported (NodeClient not available)` — a message
    /// about the host, not about the blob, which reads like a misconfigured node.
    pub fn sign_document(
        &mut self,
        document_id: String,
        base_hash: String,
        pdf_blob_id_str: String,
        file_size: u64,
        new_hash: String,
    ) -> app::Result<()> {
        let signer_id = env::account_id();

        // A signature from somebody who is not in the agreement is not a
        // signature. `Read` is a real level in this contract and this is the
        // one place it means something.
        self.require_permission(PermissionLevel::Sign)?;

        if !self.check_consent(&signer_id, &document_id)? {
            return Err(AppError::msg(
                "You must provide consent before signing this document".to_string(),
            ));
        }

        let document = self.stored(&document_id)?;
        let signed = self.signed_chain(&document_id, &document)?;
        if status_of(&document, &signed) == DocumentStatus::FullySigned {
            return Err(AppError::msg(
                "This document is fully signed and takes no more signatures".to_string(),
            ));
        }
        if signed.iter().any(|(s, _)| *s == signer_id) {
            return Err(AppError::msg(
                "You have already signed this document".to_string(),
            ));
        }
        let current = signed
            .last()
            .map_or(document.hash.clone(), |(_, v)| v.new_hash.clone());
        if current != base_hash {
            return Err(AppError::msg(format!(
                "This document changed while you were signing it: you started from {}, \
                 but it is now at {}. Somebody else signed in the meantime, and saving \
                 this copy would erase their signature. Reopen the document and sign again.",
                base_hash, current
            )));
        }

        let pdf_blob_id = parse_blob_id_hex(&pdf_blob_id_str)?;

        // Announce is scheduled, not delivered, and since rc.39 it feeds
        // availability-node prefetch only — never discovery. A `false` is not a
        // failure. See the note on the signature-blob announce above.
        let current_context = env::context_id();
        if !env::blob_announce_to_context(&pdf_blob_id, &current_context) {
            app::log!(
                "Announce not scheduled for signed PDF blob {} (prefetch only)",
                pdf_blob_id_str
            );
        }

        let mut nonce = [0u8; 16];
        env::random_bytes(&mut nonce);
        let key = format!(
            "{document_id}/{}/{}",
            hex::encode(signer_id),
            hex::encode(nonce)
        );
        self.document_signatures
            .insert(
                key,
                SignedVersion {
                    base_hash,
                    new_hash,
                    pdf_blob_id,
                    size: file_size,
                    signed_at: env::time_now(),
                },
            )
            .map_err(|e| AppError::msg(format!("Failed to add signature: {:?}", e)))?;

        app::emit!(MeroSignEvent::DocumentSigned {
            document_id,
            signer: signer_id,
        });

        Ok(())
    }

    /// The signatures on a document, in the order they were applied.
    pub fn get_document_signatures(
        &self,
        document_id: String,
    ) -> app::Result<Vec<DocumentSignature>> {
        let Some(document) = self
            .documents
            .get(&document_id)
            .map_err(store_err("Failed to get document"))?
        else {
            return Ok(Vec::new());
        };
        Ok(self
            .signed_chain(&document_id, &document)?
            .into_iter()
            .map(|(signer, v)| DocumentSignature {
                signer,
                signed_at: v.signed_at,
            })
            .collect())
    }

    /// Confirm the CALLER's signature is on a document.
    ///
    /// The status is derived from the signatures on every read, so there is
    /// nothing left to recompute; this stays so a client can ask, after
    /// signing, whether its signature is the one on the document.
    pub fn mark_participant_signed(&mut self, document_id: String) -> app::Result<()> {
        let user_id = env::account_id();
        if !self.check_consent(&user_id, &document_id)? {
            return Err(AppError::msg(
                "You must provide consent before being marked as signed".to_string(),
            ));
        }
        let document = self.stored(&document_id)?;
        if !self
            .signed_chain(&document_id, &document)?
            .iter()
            .any(|(s, _)| *s == user_id)
        {
            return Err(AppError::msg(
                "You have not signed this document yet".to_string(),
            ));
        }
        Ok(())
    }

    /// Register self as participant (for users who joined via open invitation)
    pub fn register_self_as_participant(&mut self) -> app::Result<()> {
        if self.private()? {
            return Err(AppError::msg(
                "Cannot register as participant in private context".to_string(),
            ));
        }

        // The ACCOUNT — see the note in `init`.
        let executor_id = env::account_id();

        let who = AccountId::from(executor_id);
        if self
            .roles
            .has_role(ROLE_REMOVED, &who)
            .map_err(store_err("Failed to check user permissions"))?
        {
            return Err(AppError::msg(
                "An admin removed you from this agreement".to_string(),
            ));
        }
        if self.level_of(&executor_id)?.is_some() {
            return Err(AppError::msg(
                "Already registered as participant".to_string(),
            ));
        }

        // `Sign`, in the caller's own slot.
        let _ = self
            .joined
            .insert(LwwRegister::new(env::time_now()))
            .map_err(|e| AppError::msg(format!("Failed to register as participant: {:?}", e)))?;

        app::emit!(MeroSignEvent::ParticipantJoined {
            user_id: executor_id
        });

        Ok(())
    }

    /// Add participant to shared context (admin only)
    pub fn add_participant(
        &mut self,
        user_id_str: String,
        permission: PermissionLevel,
    ) -> app::Result<()> {
        self.validate_admin_permissions()?;

        let user_id = parse_public_key_hex(&user_id_str)?;

        if self.level_of(&user_id)?.is_some() {
            return Err(AppError::msg("User is already a participant".to_string()));
        }

        self.set_level(user_id, &permission)?;

        app::emit!(MeroSignEvent::ParticipantJoined { user_id });

        Ok(())
    }

    /// Remove participant from shared context. The removal outranks the
    /// participant's own registration, and is refused for the last admin.
    pub fn remove_participant(&mut self, user_id_str: String) -> app::Result<()> {
        self.validate_admin_permissions()?;

        let user_id = parse_public_key_hex(&user_id_str)?;

        if self.level_of(&user_id)?.is_none() {
            return Err(AppError::msg("User is not a participant".to_string()));
        }

        let who = AccountId::from(user_id);
        let err = store_err("Failed to remove participant");
        if self.roles.is_admin(&who) && self.roles.admins().len() <= 1 {
            return Err(AppError::msg(
                "An agreement needs at least one admin: promote someone else first".to_string(),
            ));
        }
        self.roles.grant(ROLE_REMOVED, who).map_err(&err)?;
        for role in [ROLE_SIGNER, ROLE_VIEWER] {
            self.roles.revoke(role, &who).map_err(&err)?;
        }
        if self.roles.is_admin(&who) {
            self.roles.revoke_admin(&who).map_err(&err)?;
            self.sync_moderators()?;
        }

        app::emit!(MeroSignEvent::ParticipantLeft { user_id });

        Ok(())
    }

    /// Change an EXISTING participant's permission level, up or down.
    ///
    /// `add_participant` cannot do this: it refuses a user who is already a
    /// participant. Levels live in `AccessControl`, whose grants merge
    /// last-writer-wins, so a demotion converges like a promotion. The last
    /// admin cannot step down.
    pub fn set_participant_permission(
        &mut self,
        user_id_str: String,
        permission: PermissionLevel,
    ) -> app::Result<()> {
        self.validate_admin_permissions()?;

        let user_id = parse_public_key_hex(&user_id_str)?;

        let Some(current) = self.level_of(&user_id)? else {
            return Err(AppError::msg("User is not a participant".to_string()));
        };
        // Idempotent: setting the level somebody already holds is a no-op,
        // not an error. A UI that re-sends the current value is not a bug.
        if current == permission {
            return Ok(());
        }

        self.set_level(user_id, &permission)?;

        app::emit!(MeroSignEvent::ParticipantPermissionChanged {
            user_id,
            permission
        });

        Ok(())
    }

    /// The caller's ACCOUNT id, as this contract sees it.
    ///
    /// Exists because the frontend cannot work it out. A device key and an
    /// account id have both been 32 raw bytes — 64 hex characters — since core
    /// 0.11.0-rc.27, so the two are indistinguishable by inspection, and this
    /// app holds a DEVICE key in `localStorage` (`agreementContextUserID`, the
    /// context member public key from the join response) while participants
    /// are keyed by ACCOUNT. Comparing the two type-checks and silently matches
    /// nothing, which is how a UI ends up unable to tell an admin that they
    /// are one.
    ///
    /// One call removes the guess: the contract is the only thing that knows.
    pub fn whoami(&self) -> UserId {
        env::account_id()
    }

    /// List all participants
    pub fn list_participants(&self) -> app::Result<Vec<UserId>> {
        self.participant_ids()
    }

    /// Get user permission level
    pub fn get_user_permission(&self, user_id_str: String) -> app::Result<PermissionLevel> {
        let user_id = parse_public_key_hex(&user_id_str)?;
        self.level_of(&user_id)?
            .ok_or_else(|| AppError::msg("User not found".to_string()))
    }

    /// Get current context ID
    pub fn get_context_id(&self) -> ContextId {
        env::context_id()
    }

    /// Get identity mapping for a specific context
    pub fn get_identity_mapping(&self, context_id_str: String) -> app::Result<IdentityMapping> {
        if !self.private()? {
            return Err(AppError::msg(
                "Identity mappings can only be accessed in private context".to_string(),
            ));
        }

        let context_id = parse_context_id_hex(&context_id_str)?;
        let context_id_key = encode_context_id_base58(&context_id);

        match self.identity_mappings.get(&context_id_key) {
            Ok(Some(mapping)) => Ok(mapping.clone()),
            Ok(None) => Err(AppError::msg(
                "Identity mapping not found for this context".to_string(),
            )),
            Err(e) => Err(AppError::msg(format!(
                "Failed to get identity mapping: {:?}",
                e
            ))),
        }
    }

    /// Get shared identity for a specific context
    pub fn get_shared_identity(&self, context_id_str: String) -> app::Result<UserId> {
        if !self.private()? {
            return Err(AppError::msg(
                "Identity resolution can only be done in private context".to_string(),
            ));
        }

        let mapping = self.get_identity_mapping(context_id_str)?;
        Ok(mapping.shared_identity)
    }

    /// Resolve private identity from shared identity
    pub fn resolve_private_identity(
        &self,
        shared_identity_str: String,
    ) -> app::Result<Option<UserId>> {
        if self.private()? {
            let shared_identity = parse_public_key_hex(&shared_identity_str)?;
            if let Ok(entries) = self.identity_mappings.entries() {
                for (_, mapping) in entries {
                    if mapping.shared_identity == shared_identity {
                        return Ok(Some(mapping.private_identity));
                    }
                }
            }
            Ok(None)
        } else {
            Err(AppError::msg(
                "Cannot resolve private identity from shared context".to_string(),
            ))
        }
    }

    pub fn search_document_by_embedding(
        &self,
        query_embedding: Vec<f32>,
        document_id: String,
    ) -> app::Result<String> {
        let document = match self.documents.get(&document_id) {
            Ok(Some(doc)) => doc,
            Ok(None) => {
                return Err(AppError::msg(format!(
                    "Document with ID '{}' not found",
                    document_id
                )))
            }
            Err(e) => return Err(AppError::msg(format!("Failed to access document: {:?}", e))),
        };

        if let Some(chunks) = &document.chunks {
            if chunks.is_empty() {
                return Err(AppError::msg(
                    "Document has no chunks for semantic search".to_string(),
                ));
            }

            if chunks[0].embedding.len() != query_embedding.len() {
                return Err(AppError::msg(format!(
                    "Embedding dimension mismatch: query={}, document chunks={}",
                    query_embedding.len(),
                    chunks[0].embedding.len()
                )));
            }

            let mut chunk_similarities: Vec<(&DocumentChunk, f32)> = chunks
                .iter()
                .map(|chunk| {
                    let similarity = cosine_similarity(&query_embedding, &chunk.embedding);
                    (chunk, similarity)
                })
                .filter(|(_, similarity)| *similarity > 0.1)
                .collect();

            if chunk_similarities.is_empty() {
                return Ok(format!(
                    "Document: {}\nNo relevant sections found for your query. The document may not contain information related to your question.",
                    document.name
                ));
            }

            chunk_similarities
                .sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

            let top_chunks: Vec<String> = chunk_similarities
                .into_iter()
                .take(3)
                .map(|(chunk, similarity)| {
                    let clean_text = chunk
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

                    let display_text = if clean_text.len() > max_chars {
                        format!("{}...", &clean_text[..max_chars])
                    } else {
                        clean_text
                    };

                    format!("[Relevance: {:.2}] {}", similarity, display_text)
                })
                .collect();

            return Ok(format!(
                "Document: {}\nMost relevant sections:\n\n{}",
                document.name,
                top_chunks.join("\n\n")
            ));
        }

        let doc_embedding = match &document.embeddings {
            Some(embedding) => embedding,
            None => {
                return Err(AppError::msg(
                    "Document has no embeddings for semantic search".to_string(),
                ))
            }
        };

        if doc_embedding.len() != query_embedding.len() {
            return Err(AppError::msg(format!(
                "Embedding dimension mismatch: query={}, document={}",
                query_embedding.len(),
                doc_embedding.len()
            )));
        }

        let similarity = cosine_similarity(&query_embedding, doc_embedding);

        if similarity < 0.05 {
            return Ok(format!(
                "Document: {} (Low relevance: {:.2})\nNo highly relevant content found for your query.",
                document.name, similarity
            ));
        }

        let text_snippet = if let Some(ref full_text) = document.extracted_text {
            let clean_text = full_text.replace(['\n', '\r'], " ").replace("  ", " ");

            let max_chars = if similarity > 0.4 {
                400
            } else if similarity > 0.2 {
                250
            } else {
                150
            };

            if clean_text.len() > max_chars {
                format!("{}...", &clean_text[..max_chars])
            } else {
                clean_text
            }
        } else {
            format!("Document: {} (No extracted text available)", document.name)
        };

        Ok(format!(
            "Document: {} (Similarity: {:.2})\n{}",
            document.name, similarity, text_snippet
        ))
    }
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        0.0
    } else {
        dot_product / (norm_a * norm_b)
    }
}

#[cfg(test)]
mod tests;
