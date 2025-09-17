use candid::{CandidType, Deserialize};
use ic_cdk::api::time;
use ic_cdk::{caller, query, update};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, Storable};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashSet;

type Memory = VirtualMemory<DefaultMemoryImpl>;

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static CONTEXTS: RefCell<StableBTreeMap<StorableString, ContextRecord, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(0))),
        )
    );

    static DOCUMENTS: RefCell<StableBTreeMap<StorableString, DocumentRecord, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(1))),
        )
    );

    static AUDIT_TRAIL: RefCell<StableBTreeMap<StorableString, AuditTrail, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(2))),
        )
    );
}

#[derive(CandidType, Deserialize)]
enum Error {
    InvalidInput(String),
    NotFound,
    AlreadyExists,
    UpdateConflict(String),
    Unauthorized,
    DocumentNotReady,
    ConsentRequired,
    ContextNotFound,
}

#[derive(CandidType, Deserialize, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct StorableString(String);

const MAX_ID_SIZE: u32 = 128;
const MAX_CONTEXT_RECORD_SIZE: u32 = 4096;
const MAX_DOCUMENT_RECORD_SIZE: u32 = 2048;
const MAX_AUDIT_ENTRIES_SIZE: u32 = 8192;

impl Storable for StorableString {
    fn to_bytes<'a>(&'a self) -> Cow<'a, [u8]> {
        Cow::Borrowed(self.0.as_bytes())
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Self(String::from_utf8(bytes.to_vec()).unwrap())
    }

    const BOUND: Bound = Bound::Bounded {
        max_size: MAX_ID_SIZE,
        is_fixed_size: false,
    };
}

#[derive(CandidType, Deserialize, Clone)]
struct ContextRecord {
    context_id: String,
    admin_id: String,
    participants: Vec<String>,
    document_ids: Vec<String>,
    context_status: ContextStatus,
    metadata: ContextMetadata,
    created_at: u64,
}

impl Storable for ContextRecord {
    fn to_bytes<'a>(&'a self) -> Cow<'a, [u8]> {
        Cow::Owned(candid::encode_one(self).unwrap())
    }

    fn from_bytes<'a>(bytes: Cow<'a, [u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).unwrap()
    }

    const BOUND: Bound = Bound::Bounded {
        max_size: MAX_CONTEXT_RECORD_SIZE,
        is_fixed_size: false,
    };
}

#[derive(CandidType, Deserialize, Clone)]
struct ContextMetadata {
    title: Option<String>,
    description: Option<String>,
    agreement_type: Option<String>,
    expires_at: Option<u64>,
}

#[derive(CandidType, Deserialize, Clone, PartialEq)]
enum ContextStatus {
    Active,
    Completed,
    Expired,
}

#[derive(CandidType, Deserialize, Clone)]
struct DocumentRecord {
    document_id: String,
    context_id: String,
    original_hash: String,
    timestamp_original: u64,
    final_hash: Option<String>,
    timestamp_final: Option<u64>,
    current_signers: Vec<String>,
    document_status: DocumentStatus,
    metadata: DocumentMetadata,
}

impl Storable for DocumentRecord {
    fn to_bytes<'a>(&'a self) -> Cow<'a, [u8]> {
        Cow::Owned(candid::encode_one(self).unwrap())
    }

    fn from_bytes<'a>(bytes: Cow<'a, [u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).unwrap()
    }

    const BOUND: Bound = Bound::Bounded {
        max_size: MAX_DOCUMENT_RECORD_SIZE,
        is_fixed_size: false,
    };
}

#[derive(CandidType, Deserialize, Clone)]
struct DocumentMetadata {
    created_at: u64,
}

#[derive(CandidType, Deserialize, Clone, PartialEq)]
enum DocumentStatus {
    Pending,
    PartiallySigned,
    FullySigned,
}

#[derive(CandidType, Deserialize, Clone)]
struct AuditEntry {
    entry_id: String,
    user_id: String,
    action: AuditAction,
    timestamp: u64,
    context_id: String,
    document_id: Option<String>,
    consent_given: Option<bool>,
    document_hash_after_action: Option<String>,
    metadata: Option<String>,
}

#[derive(CandidType, Deserialize, Clone, PartialEq)]
enum AuditAction {
    ContextCreated,
    ParticipantAdded,
    DocumentUploaded,
    ConsentGiven,
    SignatureApplied,
    DocumentCompleted,
    ContextCompleted,
}

#[derive(CandidType, Deserialize, Clone)]
struct AuditTrail {
    entries: Vec<AuditEntry>,
}

impl AuditTrail {
    fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    fn add_entry(&mut self, entry: AuditEntry) {
        self.entries.push(entry);
    }

    fn get_entries(&self) -> &Vec<AuditEntry> {
        &self.entries
    }
}

impl Storable for AuditTrail {
    fn to_bytes<'a>(&'a self) -> Cow<'a, [u8]> {
        Cow::Owned(candid::encode_one(self).unwrap())
    }

    fn from_bytes<'a>(bytes: Cow<'a, [u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).unwrap()
    }

    const BOUND: Bound = Bound::Bounded {
        max_size: MAX_AUDIT_ENTRIES_SIZE,
        is_fixed_size: false,
    };
}

// Request structs
#[derive(CandidType, Deserialize)]
struct CreateContextRequest {
    context_id: String,
    participants: Vec<String>,
    title: Option<String>,
    description: Option<String>,
    agreement_type: Option<String>,
    expires_at: Option<u64>,
}

#[derive(CandidType, Deserialize)]
struct DocumentUploadRequest {
    context_id: String,
    document_id: String,
    document_hash: String,
}

#[derive(CandidType, Deserialize)]
struct SigningRequest {
    document_id: String,
    consent_acknowledged: bool,
}

#[derive(CandidType, Deserialize)]
enum VerificationStatus {
    Unrecorded,
    OriginalMatch,
    FinalMatch,
    NoMatch,
}

// Utility functions
fn validate_id(id: &str) -> Result<(), Error> {
    if id.is_empty() {
        return Err(Error::InvalidInput("ID cannot be empty.".to_string()));
    }
    if id.len() as u32 > MAX_ID_SIZE {
        return Err(Error::InvalidInput(format!(
            "ID exceeds max length of {} bytes.",
            MAX_ID_SIZE
        )));
    }
    if !id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(Error::InvalidInput(
            "ID contains invalid characters.".to_string(),
        ));
    }
    Ok(())
}

fn validate_hash(hash: &str) -> Result<(), Error> {
    if hash.len() != 64 {
        return Err(Error::InvalidInput(
            "Hash must be 64 characters long.".to_string(),
        ));
    }
    if hex::decode(hash).is_err() {
        return Err(Error::InvalidInput(
            "Hash contains non-hexadecimal characters.".to_string(),
        ));
    }
    Ok(())
}

fn generate_audit_id() -> String {
    format!("audit_{}", time())
}

fn add_audit_entry(context_id: &str, entry: AuditEntry) {
    let key = StorableString(context_id.to_string());
    AUDIT_TRAIL.with(|trail| {
        let mut trail = trail.borrow_mut();
        let mut audit_trail = trail.get(&key).unwrap_or_else(AuditTrail::new);
        audit_trail.add_entry(entry);
        trail.insert(key, audit_trail);
    });
}

fn is_context_participant(context_id: &str, user_id: &str) -> bool {
    let key = StorableString(context_id.to_string());
    CONTEXTS.with(|contexts| {
        contexts.borrow().get(&key).map_or(false, |context| {
            context.admin_id == user_id || context.participants.contains(&user_id.to_string())
        })
    })
}

fn has_user_given_consent(context_id: &str, user_id: &str, document_id: &str) -> bool {
    let key = StorableString(context_id.to_string());
    AUDIT_TRAIL.with(|trail| {
        trail.borrow().get(&key).map_or(false, |audit_trail| {
            audit_trail.get_entries().iter().any(|entry| {
                entry.user_id == user_id
                    && entry.action == AuditAction::ConsentGiven
                    && entry.consent_given == Some(true)
                    && entry
                        .document_id
                        .as_ref()
                        .map_or(false, |doc_id| doc_id == document_id)
            })
        })
    })
}

// Core functions
#[update]
fn create_context(request: CreateContextRequest) -> Result<(), Error> {
    validate_id(&request.context_id)?;

    let admin_id = caller().to_string();
    let key = StorableString(request.context_id.clone());

    CONTEXTS.with(|contexts| {
        let mut contexts = contexts.borrow_mut();
        if contexts.contains_key(&key) {
            return Err(Error::AlreadyExists);
        }

        let current_time = time();
        let metadata = ContextMetadata {
            title: request.title,
            description: request.description,
            agreement_type: request.agreement_type,
            expires_at: request.expires_at,
        };

        let context_record = ContextRecord {
            context_id: request.context_id.clone(),
            admin_id: admin_id.clone(),
            participants: request.participants,
            document_ids: Vec::new(),
            context_status: ContextStatus::Active,
            metadata,
            created_at: current_time,
        };

        contexts.insert(key, context_record);

        let audit_entry = AuditEntry {
            entry_id: generate_audit_id(),
            user_id: admin_id,
            action: AuditAction::ContextCreated,
            timestamp: current_time,
            context_id: request.context_id.clone(),
            document_id: None,
            consent_given: None,
            document_hash_after_action: None,
            metadata: Some("Context created".to_string()),
        };
        add_audit_entry(&request.context_id, audit_entry);
        Ok(())
    })
}

#[update]
fn add_participant_to_context(context_id: String, participant_id: String) -> Result<(), Error> {
    validate_id(&context_id)?;
    validate_id(&participant_id)?;

    let caller_id = caller().to_string();
    let key = StorableString(context_id.clone());

    CONTEXTS.with(|contexts| {
        let mut contexts = contexts.borrow_mut();
        match contexts.get(&key) {
            Some(mut context) => {
                if context.admin_id != caller_id {
                    return Err(Error::Unauthorized);
                }

                if context.participants.contains(&participant_id)
                    || context.admin_id == participant_id
                {
                    return Err(Error::UpdateConflict(
                        "User is already a participant in this context.".to_string(),
                    ));
                }

                context.participants.push(participant_id.clone());
                contexts.insert(key, context);

                let audit_entry = AuditEntry {
                    entry_id: generate_audit_id(),
                    user_id: caller_id,
                    action: AuditAction::ParticipantAdded,
                    timestamp: time(),
                    context_id: context_id.clone(),
                    document_id: None,
                    consent_given: None,
                    document_hash_after_action: None,
                    metadata: Some(format!("Added participant: {}", participant_id)),
                };
                add_audit_entry(&context_id, audit_entry);
                Ok(())
            }
            None => Err(Error::ContextNotFound),
        }
    })
}

#[update]
fn upload_document_to_context(request: DocumentUploadRequest) -> Result<(), Error> {
    validate_id(&request.context_id)?;
    validate_id(&request.document_id)?;
    validate_hash(&request.document_hash)?;

    let admin_id = caller().to_string();
    let context_key = StorableString(request.context_id.clone());
    let doc_key = StorableString(request.document_id.clone());

    // Check if context exists and caller is admin
    let context_exists = CONTEXTS.with(|contexts| {
        contexts
            .borrow()
            .get(&context_key)
            .map_or(false, |context| context.admin_id == admin_id)
    });

    if !context_exists {
        return Err(Error::Unauthorized);
    }

    DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        if documents.contains_key(&doc_key) {
            return Err(Error::AlreadyExists);
        }

        let current_time = time();
        let metadata = DocumentMetadata {
            created_at: current_time,
        };

        let document_record = DocumentRecord {
            document_id: request.document_id.clone(),
            context_id: request.context_id.clone(),
            original_hash: request.document_hash.clone(),
            timestamp_original: current_time,
            final_hash: None,
            timestamp_final: None,
            current_signers: Vec::new(),
            document_status: DocumentStatus::Pending,
            metadata,
        };

        documents.insert(doc_key, document_record);

        // Add document ID to context
        CONTEXTS.with(|contexts| {
            let mut contexts = contexts.borrow_mut();
            if let Some(mut context) = contexts.get(&context_key) {
                context.document_ids.push(request.document_id.clone());
                contexts.insert(context_key, context);
            }
        });

        let audit_entry = AuditEntry {
            entry_id: generate_audit_id(),
            user_id: admin_id,
            action: AuditAction::DocumentUploaded,
            timestamp: current_time,
            context_id: request.context_id.clone(),
            document_id: Some(request.document_id.clone()),
            consent_given: None,
            document_hash_after_action: Some(request.document_hash),
            metadata: None,
        };
        add_audit_entry(&request.context_id, audit_entry);
        Ok(())
    })
}

#[update]
fn record_consent_for_context(context_id: String, document_id: String) -> Result<(), Error> {
    validate_id(&context_id)?;
    validate_id(&document_id)?;
    let user_id = caller().to_string();

    // Check if user is a context participant
    if !is_context_participant(&context_id, &user_id) {
        return Err(Error::Unauthorized);
    }

    // Verify the document exists and belongs to the context
    let doc_key = StorableString(document_id.clone());
    let document_exists = DOCUMENTS.with(|documents| {
        documents
            .borrow()
            .get(&doc_key)
            .map_or(false, |document| document.context_id == context_id)
    });

    if !document_exists {
        return Err(Error::NotFound);
    }

    let audit_entry = AuditEntry {
        entry_id: generate_audit_id(),
        user_id,
        action: AuditAction::ConsentGiven,
        timestamp: time(),
        context_id: context_id.clone(),
        document_id: Some(document_id),
        consent_given: Some(true),
        document_hash_after_action: None,
        metadata: None,
    };
    add_audit_entry(&context_id, audit_entry);
    Ok(())
}

#[update]
fn sign_document(request: SigningRequest) -> Result<(), Error> {
    validate_id(&request.document_id)?;
    if !request.consent_acknowledged {
        return Err(Error::ConsentRequired);
    }

    let user_id = caller().to_string();
    let doc_key = StorableString(request.document_id.clone());

    DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        match documents.get(&doc_key) {
            Some(mut document) => {
                // Check if user is a context participant
                if !is_context_participant(&document.context_id, &user_id) {
                    return Err(Error::Unauthorized);
                }

                // Check if already signed
                if document.current_signers.contains(&user_id) {
                    return Err(Error::UpdateConflict(
                        "User has already signed this document.".to_string(),
                    ));
                }

                // Check consent requirement for this specific document
                if !has_user_given_consent(&document.context_id, &user_id, &request.document_id) {
                    return Err(Error::ConsentRequired);
                }

                // Add signature
                document.current_signers.push(user_id.clone());

                // Check if document is complete
                let context_key = StorableString(document.context_id.clone());
                let is_complete = CONTEXTS.with(|contexts| {
                    contexts
                        .borrow()
                        .get(&context_key)
                        .map_or(false, |context| {
                            let mut required_signers: HashSet<String> =
                                context.participants.iter().cloned().collect();
                            required_signers.insert(context.admin_id.clone());

                            let current_signers: HashSet<String> =
                                document.current_signers.iter().cloned().collect();

                            required_signers.is_subset(&current_signers)
                        })
                });

                // Update document status
                if is_complete {
                    document.document_status = DocumentStatus::FullySigned;
                    document.timestamp_final = Some(time());
                } else if document.document_status == DocumentStatus::Pending {
                    document.document_status = DocumentStatus::PartiallySigned;
                }

                let context_id = document.context_id.clone();
                documents.insert(doc_key, document);

                // Add signature audit entry
                let signature_entry = AuditEntry {
                    entry_id: generate_audit_id(),
                    user_id: user_id.clone(),
                    action: AuditAction::SignatureApplied,
                    timestamp: time(),
                    context_id: context_id.clone(),
                    document_id: Some(request.document_id.clone()),
                    consent_given: Some(true),
                    document_hash_after_action: None,
                    metadata: Some(format!("Signed by: {}", user_id)),
                };
                add_audit_entry(&context_id, signature_entry);

                // Add completion audit entry if complete
                if is_complete {
                    let completion_entry = AuditEntry {
                        entry_id: generate_audit_id(),
                        user_id: "system".to_string(),
                        action: AuditAction::DocumentCompleted,
                        timestamp: time(),
                        context_id: context_id.clone(),
                        document_id: Some(request.document_id.clone()),
                        consent_given: None,
                        document_hash_after_action: None,
                        metadata: Some("Document fully signed".to_string()),
                    };
                    add_audit_entry(&context_id, completion_entry);
                }

                Ok(())
            }
            None => Err(Error::NotFound),
        }
    })
}

#[update]
fn record_final_hash(document_id: String, hash: String) -> Result<(), Error> {
    validate_id(&document_id)?;
    validate_hash(&hash)?;

    let caller_id = caller().to_string();
    let doc_key = StorableString(document_id.clone());

    DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        match documents.get(&doc_key) {
            Some(mut document) => {
                // Check if caller is context admin
                let is_admin = CONTEXTS.with(|contexts| {
                    let context_key = StorableString(document.context_id.clone());
                    contexts
                        .borrow()
                        .get(&context_key)
                        .map_or(false, |context| context.admin_id == caller_id)
                });

                if !is_admin {
                    return Err(Error::Unauthorized);
                }

                if document.final_hash.is_some() {
                    return Err(Error::UpdateConflict(
                        "Final hash has already been recorded.".to_string(),
                    ));
                }

                document.final_hash = Some(hash.clone());
                document.timestamp_final = Some(time());

                let context_id = document.context_id.clone();
                documents.insert(doc_key, document);

                let audit_entry = AuditEntry {
                    entry_id: generate_audit_id(),
                    user_id: caller_id,
                    action: AuditAction::DocumentCompleted,
                    timestamp: time(),
                    context_id: context_id.clone(),
                    document_id: Some(document_id.clone()),
                    consent_given: None,
                    document_hash_after_action: Some(hash),
                    metadata: Some("Final hash recorded".to_string()),
                };
                add_audit_entry(&context_id, audit_entry);
                Ok(())
            }
            None => Err(Error::NotFound),
        }
    })
}

// Query functions
#[query]
fn get_context(context_id: String) -> Result<ContextRecord, Error> {
    validate_id(&context_id)?;
    CONTEXTS.with(|contexts| {
        contexts
            .borrow()
            .get(&StorableString(context_id))
            .ok_or(Error::ContextNotFound)
    })
}

#[query]
fn get_document(document_id: String) -> Result<DocumentRecord, Error> {
    validate_id(&document_id)?;
    DOCUMENTS.with(|documents| {
        documents
            .borrow()
            .get(&StorableString(document_id))
            .ok_or(Error::NotFound)
    })
}

#[query]
fn get_context_documents(context_id: String) -> Result<Vec<DocumentRecord>, Error> {
    validate_id(&context_id)?;

    let context_key = StorableString(context_id.clone());
    let document_ids = CONTEXTS.with(|contexts| {
        contexts
            .borrow()
            .get(&context_key)
            .ok_or(Error::ContextNotFound)
            .map(|context| context.document_ids.clone())
    })?;

    let documents = DOCUMENTS.with(|documents| {
        let documents = documents.borrow();
        document_ids
            .iter()
            .filter_map(|doc_id| documents.get(&StorableString(doc_id.clone())))
            .collect()
    });

    Ok(documents)
}

#[query]
fn get_audit_trail(context_id: String) -> Result<Vec<AuditEntry>, Error> {
    validate_id(&context_id)?;
    Ok(AUDIT_TRAIL.with(|trail| {
        trail
            .borrow()
            .get(&StorableString(context_id))
            .map_or_else(Vec::new, |t| t.get_entries().clone())
    }))
}

#[query]
fn get_audit_trail_for_document(
    context_id: String,
    document_id: String,
) -> Result<Vec<AuditEntry>, Error> {
    validate_id(&context_id)?;
    validate_id(&document_id)?;

    Ok(AUDIT_TRAIL.with(|trail| {
        trail
            .borrow()
            .get(&StorableString(context_id))
            .map_or_else(Vec::new, |t| {
                t.get_entries()
                    .iter()
                    .filter(|entry| {
                        entry
                            .document_id
                            .as_ref()
                            .map_or(false, |doc| doc == &document_id)
                    })
                    .cloned()
                    .collect()
            })
    }))
}

#[query]
fn get_context_signing_progress(
    context_id: String,
) -> Result<(Vec<String>, Vec<String>, Vec<(String, DocumentStatus)>), Error> {
    validate_id(&context_id)?;

    let context_key = StorableString(context_id.clone());
    let context = CONTEXTS.with(|contexts| {
        contexts
            .borrow()
            .get(&context_key)
            .ok_or(Error::ContextNotFound)
    })?;

    let mut required_signers = context.participants.clone();
    required_signers.push(context.admin_id);
    required_signers.sort_unstable();
    required_signers.dedup();

    // Get users who have given consent (now per document)
    let consented_users = AUDIT_TRAIL.with(|trail| {
        trail
            .borrow()
            .get(&context_key)
            .map_or_else(Vec::new, |audit_trail| {
                audit_trail
                    .get_entries()
                    .iter()
                    .filter(|entry| {
                        entry.action == AuditAction::ConsentGiven
                            && entry.consent_given == Some(true)
                            && entry.document_id.is_some()
                    })
                    .map(|entry| entry.user_id.clone())
                    .collect::<HashSet<String>>()
                    .into_iter()
                    .collect()
            })
    });

    // Get document statuses
    let document_statuses = DOCUMENTS.with(|documents| {
        let documents = documents.borrow();
        context
            .document_ids
            .iter()
            .filter_map(|doc_id| {
                documents
                    .get(&StorableString(doc_id.clone()))
                    .map(|doc| (doc_id.clone(), doc.document_status.clone()))
            })
            .collect()
    });

    Ok((required_signers, consented_users, document_statuses))
}

#[query]
fn verify_document_hash(document_id: String, hash_to_check: String) -> VerificationStatus {
    if validate_id(&document_id).is_err() || validate_hash(&hash_to_check).is_err() {
        return VerificationStatus::Unrecorded;
    }

    match DOCUMENTS.with(|documents| documents.borrow().get(&StorableString(document_id))) {
        Some(document) => {
            if document.original_hash == hash_to_check {
                VerificationStatus::OriginalMatch
            } else if let Some(final_hash) = &document.final_hash {
                if *final_hash == hash_to_check {
                    VerificationStatus::FinalMatch
                } else {
                    VerificationStatus::NoMatch
                }
            } else {
                VerificationStatus::NoMatch
            }
        }
        None => VerificationStatus::Unrecorded,
    }
}

#[query]
fn is_user_context_participant(context_id: String, user_id: String) -> bool {
    is_context_participant(&context_id, &user_id)
}

#[query]
fn has_user_consented(context_id: String, user_id: String, document_id: String) -> bool {
    has_user_given_consent(&context_id, &user_id, &document_id)
}

ic_cdk::export_candid!();
