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

    static HASH_STORE: RefCell<StableBTreeMap<StorableString, DocumentRecord, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(0))),
        )
    );

    static AUDIT_TRAIL: RefCell<StableBTreeMap<StorableString, AuditTrail, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(1))),
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
}

#[derive(CandidType, Deserialize, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct StorableString(String);

const MAX_DOCUMENT_ID_SIZE: u32 = 128;

impl Storable for StorableString {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Borrowed(self.0.as_bytes())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Self(String::from_utf8(bytes.to_vec()).unwrap())
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: MAX_DOCUMENT_ID_SIZE,
        is_fixed_size: false,
    };
}

#[derive(CandidType, Deserialize, Clone)]
struct DocumentRecord {
    original_hash: String,
    timestamp_original: u64,
    final_hash: Option<String>,
    timestamp_final: Option<u64>,
    admin_id: String,
    participants: Vec<String>,
    current_signers: Vec<String>,
    document_status: DocumentStatus,
    metadata: DocumentMetadata,
}

#[derive(CandidType, Deserialize, Clone)]
struct DocumentMetadata {
    title: Option<String>,
    description: Option<String>,
    document_type: Option<String>,
    created_at: u64,
    expires_at: Option<u64>,
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
    consent_given: Option<bool>,
    document_hash_after_action: Option<String>,
    metadata: Option<String>,
}

#[derive(CandidType, Deserialize, Clone, PartialEq)]
enum AuditAction {
    DocumentUploaded,
    ConsentGiven,
    SignatureApplied,
    DocumentCompleted,
    SignerAdded,
}

#[derive(CandidType, Deserialize)]
struct SigningRequest {
    document_id: String,
    consent_acknowledged: bool,
}

#[derive(CandidType, Deserialize)]
struct DocumentUploadRequest {
    document_id: String,
    document_hash: String,
    participants: Vec<String>,
    title: Option<String>,
    description: Option<String>,
    document_type: Option<String>,
    expires_at: Option<u64>,
}

#[derive(CandidType, Deserialize)]
enum VerificationStatus {
    Unrecorded,
    OriginalMatch,
    FinalMatch,
    NoMatch,
}

const MAX_DOCUMENT_RECORD_SIZE: u32 = 2048;
const MAX_AUDIT_ENTRIES_SIZE: u32 = 8192;

impl Storable for DocumentRecord {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).unwrap())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).unwrap()
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: MAX_DOCUMENT_RECORD_SIZE,
        is_fixed_size: false,
    };
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
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).unwrap())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).unwrap()
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: MAX_AUDIT_ENTRIES_SIZE,
        is_fixed_size: false,
    };
}

fn validate_document_id(id: &str) -> Result<(), Error> {
    if id.is_empty() {
        return Err(Error::InvalidInput(
            "Document ID cannot be empty.".to_string(),
        ));
    }
    if id.len() as u32 > MAX_DOCUMENT_ID_SIZE {
        return Err(Error::InvalidInput(format!(
            "Document ID exceeds max length of {} bytes.",
            MAX_DOCUMENT_ID_SIZE
        )));
    }
    if !id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(Error::InvalidInput(
            "Document ID contains invalid characters.".to_string(),
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

fn add_audit_entry(document_id: &str, entry: AuditEntry) {
    let key = StorableString(document_id.to_string());
    AUDIT_TRAIL.with(|trail| {
        let mut trail = trail.borrow_mut();
        let mut audit_trail = trail.get(&key).unwrap_or_else(|| AuditTrail::new());
        audit_trail.add_entry(entry);
        trail.insert(key, audit_trail);
    });
}

#[update]
fn upload_document(request: DocumentUploadRequest) -> Result<(), Error> {
    validate_document_id(&request.document_id)?;
    validate_hash(&request.document_hash)?;

    let admin_id = caller().to_string();
    let key = StorableString(request.document_id.clone());

    HASH_STORE.with(|store| {
        let mut store = store.borrow_mut();
        if store.contains_key(&key) {
            return Err(Error::AlreadyExists);
        }

        let current_time = time();
        let metadata = DocumentMetadata {
            title: request.title,
            description: request.description,
            document_type: request.document_type,
            created_at: current_time,
            expires_at: request.expires_at,
        };

        let record = DocumentRecord {
            original_hash: request.document_hash.clone(),
            timestamp_original: current_time,
            final_hash: None,
            timestamp_final: None,
            admin_id: admin_id.clone(),
            participants: request.participants,
            current_signers: Vec::new(),
            document_status: DocumentStatus::Pending,
            metadata,
        };
        store.insert(key, record);

        let audit_entry = AuditEntry {
            entry_id: generate_audit_id(),
            user_id: admin_id,
            action: AuditAction::DocumentUploaded,
            timestamp: current_time,
            consent_given: None,
            document_hash_after_action: Some(request.document_hash),
            metadata: None,
        };
        add_audit_entry(&request.document_id, audit_entry);
        Ok(())
    })
}

#[update]
fn add_participant(document_id: String, participant_id: String) -> Result<(), Error> {
    validate_document_id(&document_id)?;
    let caller_id = caller().to_string();
    let key = StorableString(document_id.clone());

    HASH_STORE.with(|store| {
        let mut store = store.borrow_mut();
        match store.get(&key) {
            Some(mut record) => {
                if record.admin_id != caller_id {
                    return Err(Error::Unauthorized);
                }
                if record.admin_id == participant_id
                    || record.participants.contains(&participant_id)
                {
                    return Err(Error::UpdateConflict(
                        "User is already a required signer.".to_string(),
                    ));
                }

                record.participants.push(participant_id.clone());
                store.insert(key, record);

                let audit_entry = AuditEntry {
                    entry_id: generate_audit_id(),
                    user_id: caller_id,
                    action: AuditAction::SignerAdded,
                    timestamp: time(),
                    consent_given: None,
                    document_hash_after_action: None,
                    metadata: Some(format!("Added participant: {}", participant_id)),
                };
                add_audit_entry(&document_id, audit_entry);
                Ok(())
            }
            None => Err(Error::NotFound),
        }
    })
}

#[update]
fn record_consent(document_id: String) -> Result<(), Error> {
    validate_document_id(&document_id)?;
    let user_id = caller().to_string();
    let key = StorableString(document_id.clone());

    HASH_STORE.with(|store| match store.borrow().get(&key) {
        Some(record) => {
            if user_id != record.admin_id && !record.participants.contains(&user_id) {
                return Err(Error::Unauthorized);
            }
            Ok(())
        }
        None => Err(Error::NotFound),
    })?;

    let audit_entry = AuditEntry {
        entry_id: generate_audit_id(),
        user_id,
        action: AuditAction::ConsentGiven,
        timestamp: time(),
        consent_given: Some(true),
        document_hash_after_action: None,
        metadata: None,
    };
    add_audit_entry(&document_id, audit_entry);
    Ok(())
}

#[update]
fn sign_document(request: SigningRequest) -> Result<(), Error> {
    validate_document_id(&request.document_id)?;
    if !request.consent_acknowledged {
        return Err(Error::ConsentRequired);
    }

    let user_id = caller().to_string();
    let key = StorableString(request.document_id.clone());

    HASH_STORE.with(|store| {
        let mut store = store.borrow_mut();
        match store.get(&key) {
            Some(mut record) => {
                if user_id != record.admin_id && !record.participants.contains(&user_id) {
                    return Err(Error::Unauthorized);
                }
                if record.current_signers.contains(&user_id) {
                    return Err(Error::UpdateConflict(
                        "User has already signed this document.".to_string(),
                    ));
                }
                if !AUDIT_TRAIL.with(|t| {
                    t.borrow().get(&key).map_or(false, |trail| {
                        trail.get_entries().iter().any(|e| {
                            e.user_id == user_id
                                && e.action == AuditAction::ConsentGiven
                                && e.consent_given == Some(true)
                        })
                    })
                }) {
                    return Err(Error::ConsentRequired);
                }

                record.current_signers.push(user_id.clone());

                let mut required_set: HashSet<String> =
                    record.participants.iter().cloned().collect();
                required_set.insert(record.admin_id.clone());
                let current_set: HashSet<String> = record.current_signers.iter().cloned().collect();
                let is_complete = required_set.is_subset(&current_set);

                if is_complete {
                    record.document_status = DocumentStatus::FullySigned;
                    record.timestamp_final = Some(time());
                } else if record.document_status == DocumentStatus::Pending {
                    record.document_status = DocumentStatus::PartiallySigned;
                }

                let record_clone = record.clone();
                store.insert(key.clone(), record);

                let signature_entry = AuditEntry {
                    entry_id: generate_audit_id(),
                    user_id: user_id.clone(),
                    action: AuditAction::SignatureApplied,
                    timestamp: time(),
                    consent_given: Some(true),
                    document_hash_after_action: None,
                    metadata: Some(format!("Signed by: {}", user_id)),
                };
                add_audit_entry(&request.document_id, signature_entry);

                if is_complete {
                    let completion_entry = AuditEntry {
                        entry_id: generate_audit_id(),
                        user_id: "system".to_string(),
                        action: AuditAction::DocumentCompleted,
                        timestamp: time(),
                        consent_given: None,
                        document_hash_after_action: record_clone.final_hash.clone(),
                        metadata: Some(format!(
                            "All {} required parties have signed.",
                            required_set.len()
                        )),
                    };
                    add_audit_entry(&request.document_id, completion_entry);
                }
                Ok(())
            }
            None => Err(Error::NotFound),
        }
    })
}

#[update]
fn record_final_hash(document_id: String, hash: String) -> Result<(), Error> {
    validate_document_id(&document_id)?;
    validate_hash(&hash)?;
    let key = StorableString(document_id.clone());
    HASH_STORE.with(|store| {
        let mut store = store.borrow_mut();
        match store.get(&key) {
            Some(mut record) => {
                if record.final_hash.is_some() {
                    return Err(Error::UpdateConflict(
                        "Final hash has already been recorded.".to_string(),
                    ));
                }
                record.final_hash = Some(hash.clone());
                record.timestamp_final = Some(time());
                // Optionally mark as fully signed if not already
                record.document_status = DocumentStatus::FullySigned;
                store.insert(key, record);

                let audit_entry = AuditEntry {
                    entry_id: generate_audit_id(),
                    user_id: caller().to_string(),
                    action: AuditAction::DocumentCompleted,
                    timestamp: time(),
                    consent_given: None,
                    document_hash_after_action: Some(hash),
                    metadata: Some("Final hash recorded".to_string()),
                };
                add_audit_entry(&document_id, audit_entry);
                Ok(())
            }
            None => Err(Error::NotFound),
        }
    })
}

#[update]
fn record_original_hash(document_id: String, hash: String) -> Result<(), Error> {
    let request = DocumentUploadRequest {
        document_id,
        document_hash: hash,
        participants: Vec::new(),
        title: None,
        description: None,
        document_type: None,
        expires_at: None,
    };
    upload_document(request)
}

#[query]
fn get_document_record(document_id: String) -> Result<DocumentRecord, Error> {
    validate_document_id(&document_id)?;
    HASH_STORE.with(|store| {
        store
            .borrow()
            .get(&StorableString(document_id))
            .ok_or(Error::NotFound)
    })
}

#[query]
fn get_audit_trail(document_id: String) -> Result<Vec<AuditEntry>, Error> {
    validate_document_id(&document_id)?;
    Ok(AUDIT_TRAIL.with(|trail| {
        trail
            .borrow()
            .get(&StorableString(document_id))
            .map_or_else(Vec::new, |t| t.get_entries().clone())
    }))
}

#[query]
fn get_document_status(document_id: String) -> Result<DocumentStatus, Error> {
    validate_document_id(&document_id)?;
    HASH_STORE.with(|store| {
        store
            .borrow()
            .get(&StorableString(document_id))
            .map(|r| r.document_status)
            .ok_or(Error::NotFound)
    })
}

#[query]
fn get_signing_progress(document_id: String) -> Result<(Vec<String>, Vec<String>), Error> {
    validate_document_id(&document_id)?;
    HASH_STORE.with(
        |store| match store.borrow().get(&StorableString(document_id)) {
            Some(record) => {
                let mut required_signers = record.participants;
                required_signers.push(record.admin_id);
                required_signers.sort_unstable();
                required_signers.dedup();
                Ok((required_signers, record.current_signers))
            }
            None => Err(Error::NotFound),
        },
    )
}

#[query]
fn get_hashes(document_id: String) -> Result<DocumentRecord, Error> {
    get_document_record(document_id)
}

#[query]
fn verify_hash(document_id: String, hash_to_check: String) -> VerificationStatus {
    if validate_document_id(&document_id).is_err() || validate_hash(&hash_to_check).is_err() {
        return VerificationStatus::Unrecorded;
    }
    match HASH_STORE.with(|store| store.borrow().get(&StorableString(document_id))) {
        Some(record) => {
            if record.original_hash == hash_to_check {
                VerificationStatus::OriginalMatch
            } else if let Some(final_hash) = &record.final_hash {
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

ic_cdk::export_candid!();
