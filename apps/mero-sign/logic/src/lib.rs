#![allow(clippy::len_without_is_empty)]

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env, PublicKey};
use calimero_storage::collections::{LwwRegister, UnorderedMap, UnorderedSet, Vector};

/// Signature record - uses LWW based on created_at timestamp
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct SignatureRecord {
    pub id: u64,
    pub name: String,
    pub blob_id: [u8; 32],
    pub size: u64,
    pub created_at: u64,
}

impl calimero_storage::collections::Mergeable for SignatureRecord {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        // LWW based on created_at - newer wins
        if other.created_at > self.created_at {
            *self = other.clone();
        }
        Ok(())
    }
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContextAgreement {
    pub context_id: String,
    pub agreement_name: String,
    pub joined_at: u64,
}

/// Participant roles in shared contexts
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, PartialEq)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum ParticipantRole {
    Owner,
    Signer,
    Viewer,
    Unknown,
}

impl calimero_storage::collections::Mergeable for ParticipantRole {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        // Take higher priority role (Owner > Signer > Viewer > Unknown)
        let self_priority = match self {
            ParticipantRole::Owner => 3,
            ParticipantRole::Signer => 2,
            ParticipantRole::Viewer => 1,
            ParticipantRole::Unknown => 0,
        };
        let other_priority = match other {
            ParticipantRole::Owner => 3,
            ParticipantRole::Signer => 2,
            ParticipantRole::Viewer => 1,
            ParticipantRole::Unknown => 0,
        };
        if other_priority > self_priority {
            *self = other.clone();
        }
        Ok(())
    }
}

/// Document chunk with its embedding
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocumentChunk {
    pub text: String,
    pub embedding: Vec<f32>,
    pub start_position: usize,
    pub end_position: usize,
}

/// Document information - uses LWW based on uploaded_at timestamp
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocumentInfo {
    pub id: String,
    pub name: String,
    pub hash: String,
    pub uploaded_by: [u8; 32],
    pub uploaded_at: u64,
    pub status: DocumentStatus,
    pub pdf_blob_id: [u8; 32],
    pub size: u64,
    pub embeddings: Option<Vec<f32>>,
    pub extracted_text: Option<String>,
    pub chunks: Option<Vec<DocumentChunk>>,
}

impl calimero_storage::collections::Mergeable for DocumentInfo {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        // LWW based on uploaded_at - newer wins
        if other.uploaded_at > self.uploaded_at {
            *self = other.clone();
        }
        Ok(())
    }
}

/// Document status tracking
#[derive(Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum DocumentStatus {
    Pending,
    PartiallySigned,
    FullySigned,
}

/// Signature record for documents - uses LWW based on signed_at timestamp
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocumentSignature {
    pub signer: [u8; 32],
    pub signed_at: u64,
}

impl calimero_storage::collections::Mergeable for DocumentSignature {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        // LWW based on signed_at - newer wins
        if other.signed_at > self.signed_at {
            *self = other.clone();
        }
        Ok(())
    }
}

/// Permission levels for participants
#[derive(Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum PermissionLevel {
    Read,
    Sign,
    Admin,
}

impl calimero_storage::collections::Mergeable for PermissionLevel {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        // Take higher permission (Admin > Sign > Read)
        let self_priority = match self {
            PermissionLevel::Admin => 2,
            PermissionLevel::Sign => 1,
            PermissionLevel::Read => 0,
        };
        let other_priority = match other {
            PermissionLevel::Admin => 2,
            PermissionLevel::Sign => 1,
            PermissionLevel::Read => 0,
        };
        if other_priority > self_priority {
            *self = other.clone();
        }
        Ok(())
    }
}

/// Metadata for tracking joined shared contexts
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContextMetadata {
    pub context_id: String,
    pub context_name: String,
    pub role: ParticipantRole,
    pub joined_at: u64,
    pub private_identity: [u8; 32],
    pub shared_identity: [u8; 32],
}

impl calimero_storage::collections::Mergeable for ContextMetadata {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        // LWW based on joined_at - newer wins
        if other.joined_at > self.joined_at {
            *self = other.clone();
        }
        Ok(())
    }
}

/// Identity mapping for tracking user identities across contexts
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct IdentityMapping {
    pub private_identity: [u8; 32],
    pub shared_identity: [u8; 32],
    pub context_id: String,
    pub created_at: u64,
}

impl calimero_storage::collections::Mergeable for IdentityMapping {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        // LWW based on created_at - newer wins
        if other.created_at > self.created_at {
            *self = other.clone();
        }
        Ok(())
    }
}

/// Participant information with permission level
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ParticipantInfo {
    pub user_id: [u8; 32],
    pub permission_level: PermissionLevel,
}

/// Detailed information about a shared context
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContextDetails {
    pub context_id: String,
    pub context_name: String,
    pub owner: [u8; 32],
    pub is_private: bool,
    pub participant_count: u64,
    pub participants: Vec<ParticipantInfo>,
    pub document_count: u64,
    pub created_at: u64,
}

#[app::state(emits = MeroSignEvent)]
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MeroSignState {
    // Context type flag
    pub is_private: LwwRegister<bool>,

    pub owner: LwwRegister<[u8; 32]>,
    pub context_name: LwwRegister<String>,

    // Private context data
    pub signatures: UnorderedMap<String, SignatureRecord>,
    pub joined_contexts: UnorderedMap<String, ContextMetadata>,
    pub identity_mappings: UnorderedMap<String, IdentityMapping>,
    pub signature_count: LwwRegister<u64>,

    // Shared context data
    pub participants: UnorderedSet<[u8; 32]>,
    pub documents: UnorderedMap<String, DocumentInfo>,
    pub document_signatures: UnorderedMap<String, Vector<DocumentSignature>>,
    pub permissions: UnorderedMap<String, PermissionLevel>,
    pub consents: UnorderedMap<String, LwwRegister<bool>>,
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
        uploaded_by: [u8; 32],
    },
    DocumentDeleted {
        id: String,
    },
    DocumentSigned {
        document_id: String,
        signer: [u8; 32],
    },
    ParticipantInvited {
        user_id: [u8; 32],
        role: ParticipantRole,
    },
    ParticipantJoined {
        user_id: [u8; 32],
    },
    ParticipantLeft {
        user_id: [u8; 32],
    },
}

/// Helper to decode base58 blob_id from API input
fn parse_blob_id_base58(blob_id_str: &str) -> Result<[u8; 32], String> {
    match bs58::decode(blob_id_str).into_vec() {
        Ok(bytes) => {
            if bytes.len() != 32 {
                return Err(format!(
                    "Invalid blob ID length: expected 32 bytes, got {}",
                    bytes.len()
                ));
            }
            let mut blob_id = [0u8; 32];
            blob_id.copy_from_slice(&bytes);
            Ok(blob_id)
        }
        Err(e) => Err(format!("Failed to decode blob ID '{}': {}", blob_id_str, e)),
    }
}

/// Helper to decode base58 public key from API input
fn parse_public_key_base58(key_str: &str) -> Result<[u8; 32], String> {
    key_str
        .parse::<PublicKey>()
        .map(|pk| *pk.as_ref())
        .map_err(|e| format!("Failed to parse public key '{}': {}", key_str, e))
}

#[app::logic]
impl MeroSignState {
    #[app::init]
    pub fn init(is_private: bool, context_name: String) -> MeroSignState {
        let owner_raw = env::executor_id();

        let mut state = MeroSignState {
            is_private: is_private.into(),
            owner: owner_raw.into(),
            context_name: context_name.into(),

            signatures: UnorderedMap::new(),
            joined_contexts: UnorderedMap::new(),
            identity_mappings: UnorderedMap::new(),
            signature_count: 0u64.into(),
            participants: UnorderedSet::new(),
            documents: UnorderedMap::new(),
            document_signatures: UnorderedMap::new(),
            permissions: UnorderedMap::new(),
            consents: UnorderedMap::new(),
        };

        // For shared contexts, add the creator as a participant with admin permissions
        if !is_private {
            let _ = state.participants.insert(owner_raw);
            let owner_str = bs58::encode(&owner_raw).into_string();
            let _ = state.permissions.insert(owner_str, PermissionLevel::Admin);
        }

        state
    }

    pub fn is_default_private_context(&self) -> bool {
        *self.is_private.get() && self.context_name.get() == "default"
    }

    /// Create a new signature and store its blob ID
    pub fn create_signature(
        &mut self,
        name: String,
        blob_id_str: String,
        data_size: u64,
    ) -> Result<u64, String> {
        if !*self.is_private.get() {
            return Err("Signatures can only be created in private context".to_string());
        }

        let signature_id = *self.signature_count.get();
        self.signature_count.set(signature_id + 1);

        let blob_id = parse_blob_id_base58(&blob_id_str)?;

        // Announce the signature blob to the network for discovery
        let current_context = env::context_id();
        if env::blob_announce_to_context(&blob_id, &current_context) {
            app::log!(
                "Successfully announced signature blob {} to network",
                blob_id_str
            );
        } else {
            app::log!(
                "Failed to announce signature blob {} to network",
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
            .map_err(|e| format!("Failed to store signature: {:?}", e))?;

        app::emit!(MeroSignEvent::SignatureCreated {
            id: signature_id,
            name,
            size: data_size,
        });

        Ok(signature_id)
    }

    /// Delete a signature by ID
    pub fn delete_signature(&mut self, signature_id: u64) -> Result<(), String> {
        if !*self.is_private.get() {
            return Err("Signatures can only be deleted in private context".to_string());
        }

        let key = signature_id.to_string();

        match self.signatures.remove(&key) {
            Ok(Some(_)) => {
                app::emit!(MeroSignEvent::SignatureDeleted { id: signature_id });
                Ok(())
            }
            Ok(None) => Err(format!("Signature not found: {}", signature_id)),
            Err(e) => Err(format!("Failed to delete signature: {:?}", e)),
        }
    }

    /// Get all signatures
    pub fn list_signatures(&self) -> Result<Vec<SignatureRecord>, String> {
        if !*self.is_private.get() {
            return Err("Signatures can only be accessed in private context".to_string());
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
        context_id: String,
        shared_identity_str: String,
        context_name: String,
    ) -> Result<(), String> {
        if !*self.is_private.get() {
            return Err("Context joining can only be managed in private context".to_string());
        }

        if self.joined_contexts.contains(&context_id).unwrap_or(false) {
            return Err("Already joined this context".to_string());
        }

        let private_identity = *self.owner.get();
        let shared_identity = parse_public_key_base58(&shared_identity_str)?;

        let metadata = ContextMetadata {
            context_id: context_id.clone(),
            context_name: context_name.clone(),
            role: ParticipantRole::Unknown,
            joined_at: env::time_now(),
            private_identity,
            shared_identity,
        };

        let identity_mapping = IdentityMapping {
            private_identity,
            shared_identity,
            context_id: context_id.clone(),
            created_at: env::time_now(),
        };

        self.joined_contexts
            .insert(context_id.clone(), metadata)
            .map_err(|e| format!("Failed to join context: {:?}", e))?;

        self.identity_mappings
            .insert(context_id.clone(), identity_mapping)
            .map_err(|e| format!("Failed to store identity mapping: {:?}", e))?;

        app::emit!(MeroSignEvent::ContextJoined {
            context_id,
            context_name
        });
        Ok(())
    }

    /// Leave a shared context
    pub fn leave_shared_context(&mut self, context_id: String) -> Result<(), String> {
        if !*self.is_private.get() {
            return Err("Context leaving can only be managed in private context".to_string());
        }

        match self.joined_contexts.remove(&context_id) {
            Ok(Some(_)) => {
                app::emit!(MeroSignEvent::ContextLeft { context_id });
                Ok(())
            }
            Ok(None) => Err("Context not found".to_string()),
            Err(e) => Err(format!("Failed to leave context: {:?}", e)),
        }
    }

    /// List all joined contexts
    pub fn list_joined_contexts(&self) -> Result<Vec<ContextMetadata>, String> {
        if !*self.is_private.get() {
            return Err("Joined contexts can only be accessed in private context".to_string());
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
    pub fn get_context_details(&self, context_id: String) -> Result<ContextDetails, String> {
        let mut participants_with_permissions = Vec::new();

        if let Ok(iter) = self.participants.iter() {
            for participant in iter {
                let user_id_str = bs58::encode(&participant).into_string();
                let permission = self
                    .permissions
                    .get(&user_id_str)
                    .map_err(|e| format!("Failed to get permission for user: {:?}", e))?
                    .unwrap_or(PermissionLevel::Read);

                participants_with_permissions.push(ParticipantInfo {
                    user_id: participant.clone(),
                    permission_level: permission,
                });
            }
        }

        let document_count =
            self.documents
                .len()
                .map_err(|e| format!("Failed to get document count: {:?}", e))? as u64;

        let context_details = ContextDetails {
            context_id,
            context_name: self.context_name.get().clone(),
            owner: *self.owner.get(),
            is_private: *self.is_private.get(),
            participant_count: participants_with_permissions.len() as u64,
            participants: participants_with_permissions,
            document_count,
            created_at: env::time_now(),
        };

        Ok(context_details)
    }

    fn validate_admin_permissions(&self) -> Result<(), String> {
        if *self.is_private.get() {
            return Err("This method can only be called from shared context".to_string());
        }

        let current_user_str = bs58::encode(self.owner.get()).into_string();
        match self.permissions.get(&current_user_str) {
            Ok(Some(PermissionLevel::Admin)) => Ok(()),
            Ok(Some(_)) => Err("Admin permissions required for this operation".to_string()),
            Ok(None) => Err("User permissions not found".to_string()),
            Err(e) => Err(format!("Failed to check user permissions: {:?}", e)),
        }
    }

    /// Upload a document
    pub fn upload_document(
        &mut self,
        name: String,
        hash: String,
        pdf_blob_id_str: String,
        file_size: u64,
        embeddings: Option<Vec<f32>>,
        extracted_text: Option<String>,
        chunks: Option<Vec<DocumentChunk>>,
    ) -> Result<String, String> {
        let document_id = format!("doc_{}_{}", env::time_now(), name);

        if self.documents.contains(&document_id).unwrap_or(false) {
            return Err("Document with this ID already exists".to_string());
        }

        let pdf_blob_id = parse_blob_id_base58(&pdf_blob_id_str)?;

        // Announce blob to the network for discovery
        let current_context = env::context_id();
        if env::blob_announce_to_context(&pdf_blob_id, &current_context) {
            app::log!(
                "Successfully announced PDF blob {} to network",
                pdf_blob_id_str
            );
        } else {
            app::log!("Failed to announce PDF blob {} to network", pdf_blob_id_str);
        }

        let uploaded_by = *self.owner.get();
        let document = DocumentInfo {
            id: document_id.clone(),
            name: name.clone(),
            hash,
            uploaded_by,
            uploaded_at: env::time_now(),
            status: DocumentStatus::Pending,
            pdf_blob_id,
            size: file_size,
            embeddings,
            extracted_text,
            chunks,
        };

        self.documents
            .insert(document_id.clone(), document)
            .map_err(|e| format!("Failed to upload document: {:?}", e))?;

        self.document_signatures
            .insert(document_id.clone(), Vector::new())
            .map_err(|e| format!("Failed to initialize document signatures: {:?}", e))?;

        app::emit!(MeroSignEvent::DocumentUploaded {
            id: document_id.clone(),
            name,
            uploaded_by,
        });

        Ok(document_id)
    }

    /// Delete a document by ID
    pub fn delete_document(&mut self, document_id: String) -> Result<(), String> {
        self.validate_admin_permissions()?;

        match self.documents.remove(&document_id) {
            Ok(Some(_)) => {
                let _ = self.document_signatures.remove(&document_id);

                app::emit!(MeroSignEvent::DocumentDeleted { id: document_id });

                Ok(())
            }
            Ok(None) => Err(format!("Document not found: {}", document_id)),
            Err(e) => Err(format!("Failed to delete document: {:?}", e)),
        }
    }

    /// List all documents
    pub fn list_documents(&self) -> Result<Vec<DocumentInfo>, String> {
        let mut documents = Vec::new();
        if let Ok(entries) = self.documents.entries() {
            for (_, document) in entries {
                documents.push(document.clone());
            }
        }
        Ok(documents)
    }

    /// Set consent for a user on a document
    pub fn set_consent(&mut self, user_id_str: String, document_id: String) -> Result<(), String> {
        let user_id = parse_public_key_base58(&user_id_str)?;
        let key = format!("{}|{}", bs58::encode(&user_id).into_string(), document_id);
        self.consents
            .insert(key, true.into())
            .map_err(|e| format!("Failed to store consent: {:?}", e))?;
        Ok(())
    }

    /// Check if user has given consent for a document (internal helper)
    fn check_consent(&self, user_id: &[u8; 32], document_id: &str) -> Result<bool, String> {
        let key = format!("{}|{}", bs58::encode(user_id).into_string(), document_id);
        match self.consents.get(&key) {
            Ok(Some(consented)) => Ok(*consented.get()),
            Ok(None) => Ok(false),
            Err(e) => Err(format!("Failed to check consent: {:?}", e)),
        }
    }

    /// Check if user has given consent for a document (public API)
    pub fn has_consented(&self, user_id_str: String, document_id: String) -> Result<bool, String> {
        let user_id = parse_public_key_base58(&user_id_str)?;
        self.check_consent(&user_id, &document_id)
    }

    pub fn sign_document(
        &mut self,
        document_id: String,
        pdf_blob_id_str: String,
        file_size: u64,
        new_hash: String,
        signer_id_str: String,
    ) -> Result<(), String> {
        let signer_id = parse_public_key_base58(&signer_id_str)?;
        let has_consent = self.check_consent(&signer_id, &document_id)?;
        if !has_consent {
            return Err("User must provide consent before signing this document".to_string());
        }

        let mut document = match self.documents.get(&document_id) {
            Ok(Some(doc)) => doc,
            Ok(None) => return Err("Document not found".to_string()),
            Err(e) => return Err(format!("Failed to get document: {:?}", e)),
        };

        let pdf_blob_id = parse_blob_id_base58(&pdf_blob_id_str)?;

        // Announce the signed blob to the network for discovery
        let current_context = env::context_id();
        if env::blob_announce_to_context(&pdf_blob_id, &current_context) {
            app::log!(
                "Successfully announced signed PDF blob {} to network",
                pdf_blob_id_str
            );
        } else {
            app::log!(
                "Failed to announce signed PDF blob {} to network",
                pdf_blob_id_str
            );
        }

        document.pdf_blob_id = pdf_blob_id;
        document.size = file_size;
        document.hash = new_hash;
        document.status = DocumentStatus::PartiallySigned;

        self.documents
            .insert(document_id.clone(), document)
            .map_err(|e| format!("Failed to update document: {:?}", e))?;

        let signature = DocumentSignature {
            signer: signer_id,
            signed_at: env::time_now(),
        };

        let mut signatures = self
            .document_signatures
            .get(&document_id)
            .map_err(|e| format!("Failed to get document signatures: {:?}", e))?
            .unwrap_or_else(Vector::new);

        signatures
            .push(signature)
            .map_err(|e| format!("Failed to add signature: {:?}", e))?;

        self.document_signatures
            .insert(document_id.clone(), signatures)
            .map_err(|e| format!("Failed to update document signatures: {:?}", e))?;

        app::emit!(MeroSignEvent::DocumentSigned {
            document_id,
            signer: signer_id,
        });

        Ok(())
    }

    /// Get signatures for a document
    pub fn get_document_signatures(
        &self,
        document_id: String,
    ) -> Result<Vec<DocumentSignature>, String> {
        let mut signatures = Vec::new();
        if let Ok(Some(sigs)) = self.document_signatures.get(&document_id) {
            if let Ok(iter) = sigs.iter() {
                for sig in iter {
                    signatures.push(sig.clone());
                }
            }
        }
        Ok(signatures)
    }

    /// Update document status to fully signed
    pub fn mark_participant_signed(
        &mut self,
        document_id: String,
        user_id_str: String,
    ) -> Result<(), String> {
        let user_id = parse_public_key_base58(&user_id_str)?;
        let has_consent = self.check_consent(&user_id, &document_id)?;
        if !has_consent {
            return Err("User must provide consent before being marked as signed".to_string());
        }

        let mut document = match self.documents.get(&document_id) {
            Ok(Some(doc)) => doc,
            Ok(None) => return Err("Document not found".to_string()),
            Err(e) => return Err(format!("Failed to get document: {:?}", e)),
        };

        let signatures = self
            .document_signatures
            .get(&document_id)
            .map_err(|e| format!("Failed to get document signatures: {:?}", e))?
            .unwrap_or_else(Vector::new);

        let mut already_signed = false;
        if let Ok(iter) = signatures.iter() {
            for sig in iter {
                if sig.signer == user_id {
                    already_signed = true;
                    break;
                }
            }
        }
        if !already_signed {
            return Err("User has not signed this document yet".to_string());
        }

        let mut all_signed = true;
        if let Ok(participants_iter) = self.participants.iter() {
            for participant in participants_iter {
                let mut signed = false;
                if let Ok(sig_iter) = signatures.iter() {
                    for sig in sig_iter {
                        if sig.signer == participant {
                            signed = true;
                            break;
                        }
                    }
                }
                if !signed {
                    all_signed = false;
                    break;
                }
            }
        }

        if all_signed {
            document.status = DocumentStatus::FullySigned;
            self.documents
                .insert(document_id, document)
                .map_err(|e| format!("Failed to update document status: {:?}", e))?;
        }

        Ok(())
    }

    /// Register self as participant (for users who joined via open invitation)
    pub fn register_self_as_participant(&mut self) -> Result<(), String> {
        if *self.is_private.get() {
            return Err("Cannot register as participant in private context".to_string());
        }

        let executor_id = env::executor_id();

        // Check if already a participant
        if self.participants.contains(&executor_id).unwrap_or(false) {
            return Err("Already registered as participant".to_string());
        }

        // Add as participant with Sign permission
        self.participants
            .insert(executor_id)
            .map_err(|e| format!("Failed to register as participant: {:?}", e))?;

        let user_id_str = bs58::encode(&executor_id).into_string();
        self.permissions
            .insert(user_id_str, PermissionLevel::Sign)
            .map_err(|e| format!("Failed to set permissions: {:?}", e))?;

        // Update document statuses since new signer joined
        let mut docs_to_update = Vec::new();
        if let Ok(entries) = self.documents.entries() {
            for (_, document) in entries {
                if document.status == DocumentStatus::FullySigned {
                    let mut updated_document = document.clone();
                    updated_document.status = DocumentStatus::PartiallySigned;
                    docs_to_update.push(updated_document);
                }
            }
        }
        for document in docs_to_update {
            let _ = self.documents.insert(document.id.clone(), document);
        }

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
    ) -> Result<(), String> {
        self.validate_admin_permissions()?;

        let user_id = parse_public_key_base58(&user_id_str)?;

        if self.participants.contains(&user_id).unwrap_or(false) {
            return Err("User is already a participant".to_string());
        }

        self.participants
            .insert(user_id)
            .map_err(|e| format!("Failed to add participant: {:?}", e))?;

        let user_id_key = bs58::encode(&user_id).into_string();
        self.permissions
            .insert(user_id_key, permission.clone())
            .map_err(|e| format!("Failed to set permissions: {:?}", e))?;

        if permission == PermissionLevel::Sign {
            let mut docs_to_update = Vec::new();
            if let Ok(entries) = self.documents.entries() {
                for (_, document) in entries {
                    if document.status == DocumentStatus::FullySigned {
                        let mut updated_document = document.clone();
                        updated_document.status = DocumentStatus::PartiallySigned;
                        docs_to_update.push(updated_document);
                    }
                }
            }
            for document in docs_to_update {
                let _ = self.documents.insert(document.id.clone(), document);
            }
        }

        app::emit!(MeroSignEvent::ParticipantJoined { user_id });

        Ok(())
    }

    /// Remove participant from shared context
    pub fn remove_participant(&mut self, user_id_str: String) -> Result<(), String> {
        self.validate_admin_permissions()?;

        let user_id = parse_public_key_base58(&user_id_str)?;

        if !self.participants.contains(&user_id).unwrap_or(false) {
            return Err("User is not a participant".to_string());
        }

        self.participants
            .remove(&user_id)
            .map_err(|e| format!("Failed to remove participant: {:?}", e))?;

        let user_id_key = bs58::encode(&user_id).into_string();
        self.permissions
            .remove(&user_id_key)
            .map_err(|e| format!("Failed to remove permissions: {:?}", e))?;

        app::emit!(MeroSignEvent::ParticipantLeft { user_id });

        Ok(())
    }

    /// List all participants
    pub fn list_participants(&self) -> Result<Vec<[u8; 32]>, String> {
        let mut participants = Vec::new();
        if let Ok(iter) = self.participants.iter() {
            for participant in iter {
                participants.push(participant.clone());
            }
        }
        Ok(participants)
    }

    /// Get user permission level
    pub fn get_user_permission(&self, user_id_str: String) -> Result<PermissionLevel, String> {
        let user_id = parse_public_key_base58(&user_id_str)?;
        let user_id_key = bs58::encode(&user_id).into_string();
        match self.permissions.get(&user_id_key) {
            Ok(Some(perm)) => Ok(perm.clone()),
            Ok(None) => Err("User not found".to_string()),
            Err(e) => Err(format!("Failed to get permission: {:?}", e)),
        }
    }

    /// Get current context ID
    pub fn get_context_id(&self) -> String {
        if *self.is_private.get() {
            format!("private_{}", bs58::encode(self.owner.get()).into_string())
        } else {
            self.context_name.get().clone()
        }
    }

    /// Get identity mapping for a specific context
    pub fn get_identity_mapping(&self, context_id: String) -> Result<IdentityMapping, String> {
        if !*self.is_private.get() {
            return Err("Identity mappings can only be accessed in private context".to_string());
        }

        match self.identity_mappings.get(&context_id) {
            Ok(Some(mapping)) => Ok(mapping.clone()),
            Ok(None) => Err("Identity mapping not found for this context".to_string()),
            Err(e) => Err(format!("Failed to get identity mapping: {:?}", e)),
        }
    }

    /// Get shared identity for a specific context
    pub fn get_shared_identity(&self, context_id: String) -> Result<[u8; 32], String> {
        if !*self.is_private.get() {
            return Err("Identity resolution can only be done in private context".to_string());
        }

        let mapping = self.get_identity_mapping(context_id)?;
        Ok(mapping.shared_identity)
    }

    /// Resolve private identity from shared identity
    pub fn resolve_private_identity(
        &self,
        shared_identity_str: String,
    ) -> Result<Option<[u8; 32]>, String> {
        if *self.is_private.get() {
            let shared_identity = parse_public_key_base58(&shared_identity_str)?;
            if let Ok(entries) = self.identity_mappings.entries() {
                for (_, mapping) in entries {
                    if mapping.shared_identity == shared_identity {
                        return Ok(Some(mapping.private_identity));
                    }
                }
            }
            Ok(None)
        } else {
            Err("Cannot resolve private identity from shared context".to_string())
        }
    }

    pub fn search_document_by_embedding(
        &self,
        query_embedding: Vec<f32>,
        document_id: String,
    ) -> Result<String, String> {
        let document = match self.documents.get(&document_id) {
            Ok(Some(doc)) => doc,
            Ok(None) => return Err(format!("Document with ID '{}' not found", document_id)),
            Err(e) => return Err(format!("Failed to access document: {:?}", e)),
        };

        if let Some(chunks) = &document.chunks {
            if chunks.is_empty() {
                return Err("Document has no chunks for semantic search".to_string());
            }

            if chunks[0].embedding.len() != query_embedding.len() {
                return Err(format!(
                    "Embedding dimension mismatch: query={}, document chunks={}",
                    query_embedding.len(),
                    chunks[0].embedding.len()
                ));
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
                        .replace('\n', " ")
                        .replace('\r', " ")
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
            None => return Err("Document has no embeddings for semantic search".to_string()),
        };

        if doc_embedding.len() != query_embedding.len() {
            return Err(format!(
                "Embedding dimension mismatch: query={}, document={}",
                query_embedding.len(),
                doc_embedding.len()
            ));
        }

        let similarity = cosine_similarity(&query_embedding, doc_embedding);

        if similarity < 0.05 {
            return Ok(format!(
                "Document: {} (Low relevance: {:.2})\nNo highly relevant content found for your query.",
                document.name, similarity
            ));
        }

        let text_snippet = if let Some(ref full_text) = document.extracted_text {
            let clean_text = full_text
                .replace('\n', " ")
                .replace('\r', " ")
                .replace("  ", " ");

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
