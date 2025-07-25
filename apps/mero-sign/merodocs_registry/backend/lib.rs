use candid::{CandidType, Deserialize};
use ic_cdk::api::time;
use ic_cdk::{query, update};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, Storable};
use std::borrow::Cow;
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static HASH_STORE: RefCell<StableBTreeMap<StorableString, DocumentHashes, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(0))),
        )
    );
}

#[derive(CandidType, Deserialize)]
enum Error {
    InvalidInput(String),
    NotFound,
    AlreadyExists,
    UpdateConflict(String),
}

#[derive(CandidType, Deserialize, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct StorableString(String);

const MAX_CONTRACT_ID_SIZE: u32 = 128;

impl Storable for StorableString {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Borrowed(self.0.as_bytes())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Self(String::from_utf8(bytes.to_vec()).unwrap())
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: MAX_CONTRACT_ID_SIZE,
        is_fixed_size: false,
    };
}

#[derive(CandidType, Deserialize, Clone)]
struct DocumentHashes {
    original_hash: String,
    timestamp_original: u64,
    final_hash: Option<String>,
    timestamp_final: Option<u64>,
}

const MAX_DOCUMENT_HASHES_SIZE: u32 = 256;

impl Storable for DocumentHashes {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).unwrap())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).unwrap()
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: MAX_DOCUMENT_HASHES_SIZE,
        is_fixed_size: false,
    };
}

#[derive(CandidType, Deserialize)]
enum VerificationStatus {
    Unrecorded,
    OriginalMatch,
    FinalMatch,
    NoMatch,
}

fn validate_contract_id(id: &str) -> Result<(), Error> {
    if id.is_empty() {
        return Err(Error::InvalidInput(
            "Contract ID cannot be empty.".to_string(),
        ));
    }
    if id.len() as u32 > MAX_CONTRACT_ID_SIZE {
        return Err(Error::InvalidInput(format!(
            "Contract ID exceeds max length of {} bytes.",
            MAX_CONTRACT_ID_SIZE
        )));
    }
    if !id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(Error::InvalidInput(
            "Contract ID contains invalid characters.".to_string(),
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

#[update]
fn record_original_hash(contract_id: String, hash: String) -> Result<(), Error> {
    validate_contract_id(&contract_id)?;
    validate_hash(&hash)?;

    let key = StorableString(contract_id);

    HASH_STORE.with(|store| {
        let mut store = store.borrow_mut();
        if store.contains_key(&key) {
            Err(Error::AlreadyExists)
        } else {
            let record = DocumentHashes {
                original_hash: hash,
                timestamp_original: time(),
                final_hash: None,
                timestamp_final: None,
            };
            store.insert(key, record);
            Ok(())
        }
    })
}

#[update]
fn record_final_hash(contract_id: String, hash: String) -> Result<(), Error> {
    validate_contract_id(&contract_id)?;
    validate_hash(&hash)?;

    let key = StorableString(contract_id);

    HASH_STORE.with(|store| {
        let mut store = store.borrow_mut();
        match store.get(&key) {
            Some(mut record) => {
                if record.final_hash.is_some() {
                    Err(Error::UpdateConflict(
                        "Final hash has already been recorded.".to_string(),
                    ))
                } else {
                    record.final_hash = Some(hash);
                    record.timestamp_final = Some(time());
                    store.insert(key, record);
                    Ok(())
                }
            }
            None => Err(Error::NotFound),
        }
    })
}

#[query]
fn get_hashes(contract_id: String) -> Result<DocumentHashes, Error> {
    validate_contract_id(&contract_id)?;
    let key = StorableString(contract_id);
    HASH_STORE.with(|store| store.borrow().get(&key).ok_or(Error::NotFound))
}

#[query]
fn verify_hash(contract_id: String, hash_to_check: String) -> VerificationStatus {
    // Basic validation for query call to prevent unnecessary lookups
    if validate_contract_id(&contract_id).is_err() || validate_hash(&hash_to_check).is_err() {
        return VerificationStatus::Unrecorded; // Or a new status for invalid query
    }

    let key = StorableString(contract_id);
    match HASH_STORE.with(|store| store.borrow().get(&key)) {
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