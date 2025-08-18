#![allow(clippy::len_without_is_empty)]

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env};
use calimero_storage::collections::{UnorderedMap, UnorderedSet, Vector};

mod types;
use types::id::UserId;

fn encode_blob_id_base58(blob_id_bytes: &[u8; 32]) -> String {
    let mut buf = [0u8; 44];
    let len = bs58::encode(blob_id_bytes).onto(&mut buf[..]).unwrap();
    std::str::from_utf8(&buf[..len]).unwrap().to_owned()
}

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

fn serialize_blob_id_bytes<S>(blob_id_bytes: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error>
where
    S: calimero_sdk::serde::Serializer,
{
    let safe_string = encode_blob_id_base58(blob_id_bytes);
    serializer.serialize_str(&safe_string)
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct SignatureRecord {
    pub id: u64,
    pub name: String,
    #[serde(serialize_with = "serialize_blob_id_bytes")]
    pub blob_id: [u8; 32],
    pub size: u64,
    pub created_at: u64,
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
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum ParticipantRole {
    Owner,
    Signer,
    Viewer,
    Unknown,
}

/// Document information
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocumentInfo {
    pub id: String,
    pub name: String,
    pub hash: String,
    pub uploaded_by: UserId,
    pub uploaded_at: u64,
    pub status: DocumentStatus,
    #[serde(serialize_with = "serialize_blob_id_bytes")]
    pub pdf_blob_id: [u8; 32],
    pub size: u64,
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

/// Signature record for documents
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocumentSignature {
    pub signer: UserId,
    pub signed_at: u64,
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

#[app::state(emits = MeroDocsEvent)]
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MeroDocsState {
    // Context type flag
    pub is_private: bool,

    pub owner: UserId,
    pub context_name: String,

    // Private context data
    pub signatures: UnorderedMap<String, SignatureRecord>,
    pub joined_contexts: UnorderedMap<String, ContextMetadata>,
    pub identity_mappings: UnorderedMap<String, IdentityMapping>, // Map context_id -> identity mapping
    pub signature_count: u64,

    // Shared context data
    pub participants: UnorderedSet<UserId>,
    pub documents: UnorderedMap<String, DocumentInfo>,
    pub document_signatures: UnorderedMap<String, Vector<DocumentSignature>>,
    pub permissions: UnorderedMap<String, PermissionLevel>,
    pub consents: UnorderedMap<String, bool>, // "user_id|document_id" -> consent
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
    pub private_identity: UserId, // User's private context identity
    pub shared_identity: UserId,  // User's identity in this shared context
}

/// Identity mapping for tracking user identities across contexts
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct IdentityMapping {
    pub private_identity: UserId, // Original private context identity
    pub shared_identity: UserId,  // Identity used in specific shared context
    pub context_id: String,       // Which shared context this mapping is for
    pub created_at: u64,          // When this mapping was created
}

/// Participant information with permission level
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ParticipantInfo {
    pub user_id: UserId,
    pub permission_level: PermissionLevel,
}

/// Detailed information about a shared context
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContextDetails {
    pub context_id: String,
    pub context_name: String,
    pub owner: UserId,
    pub is_private: bool,
    pub participant_count: u64,
    pub participants: Vec<ParticipantInfo>,
    pub document_count: u64,
    pub created_at: u64,
}

#[app::event]
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub enum MeroDocsEvent {
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
}

#[app::logic]
impl MeroDocsState {
    #[app::init]
    pub fn init(is_private: bool, context_name: String) -> MeroDocsState {
        let owner_raw = env::executor_id();
        let owner = UserId::new(owner_raw);

        let mut state = MeroDocsState {
            is_private,
            owner,
            context_name,

            signatures: UnorderedMap::new(),
            joined_contexts: UnorderedMap::new(),
            identity_mappings: UnorderedMap::new(),
            signature_count: 0,
            participants: UnorderedSet::new(),
            documents: UnorderedMap::new(),
            document_signatures: UnorderedMap::new(),
            permissions: UnorderedMap::new(),
            consents: UnorderedMap::new(),
        };

        // For shared contexts, add the creator as a participant with admin permissions
        if !is_private {
            let _ = state.participants.insert(owner);
            let owner_str = format!("{:?}", owner);
            let _ = state.permissions.insert(owner_str, PermissionLevel::Admin);
        }

        state
    }

    pub fn is_default_private_context(&self) -> bool {
        self.is_private && self.context_name == "default"
    }

    /// Create a new signature and store its blob ID
    pub fn create_signature(
        &mut self,
        name: String,
        blob_id_str: String,
        data_size: u64,
    ) -> Result<u64, String> {
        if !self.is_private {
            return Err("Signatures can only be created in private context".to_string());
        }

        let signature_id = self.signature_count;
        self.signature_count += 1;

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

        app::emit!(MeroDocsEvent::SignatureCreated {
            id: signature_id,
            name,
            size: data_size,
        });

        Ok(signature_id)
    }

    /// Delete a signature by ID
    pub fn delete_signature(&mut self, signature_id: u64) -> Result<(), String> {
        if !self.is_private {
            return Err("Signatures can only be deleted in private context".to_string());
        }

        let key = signature_id.to_string();

        match self.signatures.remove(&key) {
            Ok(Some(_)) => {
                app::emit!(MeroDocsEvent::SignatureDeleted { id: signature_id });
                Ok(())
            }
            Ok(None) => Err(format!("Signature not found: {}", signature_id)),
            Err(e) => Err(format!("Failed to delete signature: {:?}", e)),
        }
    }

    /// Get all signatures
    pub fn list_signatures(&self) -> Result<Vec<SignatureRecord>, String> {
        if !self.is_private {
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
        shared_identity: UserId,
        context_name: String,
    ) -> Result<(), String> {
        if !self.is_private {
            return Err("Context joining can only be managed in private context".to_string());
        }

        if self.joined_contexts.contains(&context_id).unwrap_or(false) {
            return Err("Already joined this context".to_string());
        }

        let private_identity = self.owner;

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

        app::emit!(MeroDocsEvent::ContextJoined {
            context_id,
            context_name
        });
        Ok(())
    }

    /// Leave a shared context
    pub fn leave_shared_context(&mut self, context_id: String) -> Result<(), String> {
        if !self.is_private {
            return Err("Context leaving can only be managed in private context".to_string());
        }

        match self.joined_contexts.remove(&context_id) {
            Ok(Some(_)) => {
                app::emit!(MeroDocsEvent::ContextLeft { context_id });
                Ok(())
            }
            Ok(None) => Err("Context not found".to_string()),
            Err(e) => Err(format!("Failed to leave context: {:?}", e)),
        }
    }

    /// List all joined contexts
    pub fn list_joined_contexts(&self) -> Result<Vec<ContextMetadata>, String> {
        if !self.is_private {
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
                let user_id_str = format!("{:?}", participant);
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
            context_id: context_id.clone(),
            context_name: self.context_name.clone(),
            owner: self.owner,
            is_private: self.is_private,
            participant_count: participants_with_permissions.len() as u64,
            participants: participants_with_permissions,
            document_count,
            created_at: env::time_now(),
        };

        Ok(context_details)
    }

    fn validate_admin_permissions(&self) -> Result<(), String> {
        if self.is_private {
            return Err("This method can only be called from shared context".to_string());
        }

        let current_user_str = format!("{:?}", self.owner);
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
        context_id: String,
        name: String,
        hash: String,
        pdf_blob_id_str: String,
        file_size: u64,
    ) -> Result<String, String> {
        let document_id = format!("doc_{}_{}", env::time_now(), name);

        if self.documents.contains(&document_id).unwrap_or(false) {
            return Err("Document with this ID already exists".to_string());
        }

        let pdf_blob_id_bytes = parse_blob_id_base58(&pdf_blob_id_str)?;

        // Announce blob to the network for discovery
        let current_context = env::context_id();
        if env::blob_announce_to_context(&pdf_blob_id_bytes, &current_context) {
            app::log!(
                "Successfully announced PDF blob {} to network",
                pdf_blob_id_str
            );
        } else {
            app::log!("Failed to announce PDF blob {} to network", pdf_blob_id_str);
        }

        let document = DocumentInfo {
            id: document_id.clone(),
            name: name.clone(),
            hash,
            uploaded_by: self.owner,
            uploaded_at: env::time_now(),
            status: DocumentStatus::Pending,
            pdf_blob_id: pdf_blob_id_bytes,
            size: file_size,
        };

        self.documents
            .insert(document_id.clone(), document)
            .map_err(|e| format!("Failed to upload document: {:?}", e))?;

        self.document_signatures
            .insert(document_id.clone(), Vector::new())
            .map_err(|e| format!("Failed to initialize document signatures: {:?}", e))?;

        app::emit!(MeroDocsEvent::DocumentUploaded {
            id: document_id.clone(),
            name,
            uploaded_by: self.owner,
        });

        Ok(document_id)
    }

    /// Delete a document by ID
    pub fn delete_document(
        &mut self,
        context_id: String,
        document_id: String,
    ) -> Result<(), String> {
        self.validate_admin_permissions()?;

        match self.documents.remove(&document_id) {
            Ok(Some(_)) => {
                let _ = self.document_signatures.remove(&document_id);

                app::emit!(MeroDocsEvent::DocumentDeleted { id: document_id });

                Ok(())
            }
            Ok(None) => Err(format!("Document not found: {}", document_id)),
            Err(e) => Err(format!("Failed to delete document: {:?}", e)),
        }
    }

    /// List all documents
    pub fn list_documents(&self, context_id: String) -> Result<Vec<DocumentInfo>, String> {
        let mut documents = Vec::new();
        if let Ok(entries) = self.documents.entries() {
            for (_, document) in entries {
                documents.push(document.clone());
            }
        }
        Ok(documents)
    }

    /// In your set_consent and has_consented methods:
    pub fn set_consent(&mut self, user_id: UserId, document_id: String) -> Result<(), String> {
        let key = format!("{:?}|{}", user_id, document_id);
        self.consents
            .insert(key, true)
            .map_err(|e| format!("Failed to store consent: {:?}", e))?;
        Ok(())
    }

    /// Check if user has given consent for a document
    pub fn has_consented(&self, user_id: UserId, document_id: String) -> Result<bool, String> {
        let key = format!("{:?}|{}", user_id, document_id);
        match self.consents.get(&key) {
            Ok(Some(consented)) => Ok(consented),
            Ok(None) => Ok(false),
            Err(e) => Err(format!("Failed to check consent: {:?}", e)),
        }
    }
    pub fn sign_document(
        &mut self,
        context_id: String,
        document_id: String,
        pdf_blob_id_str: String,
        file_size: u64,
        new_hash: String,
        signer_id: UserId,
    ) -> Result<(), String> {
        let has_consent = self.has_consented(signer_id.clone(), document_id.clone())?;
        if !has_consent {
            return Err("User must provide consent before signing this document".to_string());
        }

        let mut document = match self.documents.get(&document_id) {
            Ok(Some(doc)) => doc,
            Ok(None) => return Err("Document not found".to_string()),
            Err(e) => return Err(format!("Failed to get document: {:?}", e)),
        };

        let pdf_blob_id_bytes = parse_blob_id_base58(&pdf_blob_id_str)?;

        // Announce the signed blob to the network for discovery
        let current_context = env::context_id();
        if env::blob_announce_to_context(&pdf_blob_id_bytes, &current_context) {
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

        // Announce the signed blob to the network for discovery
        let current_context = env::context_id();
        if env::blob_announce_to_context(&pdf_blob_id_bytes, &current_context) {
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

        document.pdf_blob_id = pdf_blob_id_bytes;
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
            .unwrap_or_else(|| Vector::new());

        signatures
            .push(signature)
            .map_err(|e| format!("Failed to add signature: {:?}", e))?;

        self.document_signatures
            .insert(document_id.clone(), signatures)
            .map_err(|e| format!("Failed to update document signatures: {:?}", e))?;

        app::emit!(MeroDocsEvent::DocumentSigned {
            document_id,
            signer: signer_id,
        });

        Ok(())
    }

    /// Get signatures for a document
    pub fn get_document_signatures(
        &self,
        context_id: String,
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
        context_id: String,
        document_id: String,
        user_id: UserId,
    ) -> Result<(), String> {
        let has_consent = self.has_consented(user_id.clone(), document_id.clone())?;
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
            .unwrap_or_else(|| Vector::new());

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
                .insert(document_id.clone(), document)
                .map_err(|e| format!("Failed to update document status: {:?}", e))?;
        }

        Ok(())
    }

    /// Add participant to shared context
    pub fn add_participant(
        &mut self,
        context_id: String,
        user_id: UserId,
        permission: PermissionLevel,
    ) -> Result<(), String> {
        self.validate_admin_permissions()?;

        if self.participants.contains(&user_id).unwrap_or(false) {
            return Err("User is already a participant".to_string());
        }

        self.participants
            .insert(user_id)
            .map_err(|e| format!("Failed to add participant: {:?}", e))?;

        let user_id_str = format!("{:?}", user_id);
        self.permissions
            .insert(user_id_str, permission.clone())
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

        app::emit!(MeroDocsEvent::ParticipantJoined { user_id });

        Ok(())
    }
    /// Remove participant from shared context
    pub fn remove_participant(
        &mut self,
        context_id: String,
        user_id: UserId,
    ) -> Result<(), String> {
        self.validate_admin_permissions()?;

        if !self.participants.contains(&user_id).unwrap_or(false) {
            return Err("User is not a participant".to_string());
        }

        self.participants
            .remove(&user_id)
            .map_err(|e| format!("Failed to remove participant: {:?}", e))?;

        let user_id_str = format!("{:?}", user_id);
        self.permissions
            .remove(&user_id_str)
            .map_err(|e| format!("Failed to remove permissions: {:?}", e))?;

        app::emit!(MeroDocsEvent::ParticipantLeft { user_id });

        Ok(())
    }

    /// List all participants
    pub fn list_participants(&self, context_id: String) -> Result<Vec<UserId>, String> {
        let mut participants = Vec::new();
        if let Ok(iter) = self.participants.iter() {
            for participant in iter {
                participants.push(participant.clone());
            }
        }
        Ok(participants)
    }

    /// Get user permission level
    pub fn get_user_permission(
        &self,
        context_id: String,
        user_id: UserId,
    ) -> Result<PermissionLevel, String> {
        let user_id_str = format!("{:?}", user_id);
        match self.permissions.get(&user_id_str) {
            Ok(Some(perm)) => Ok(perm.clone()),
            Ok(None) => Err("User not found".to_string()),
            Err(e) => Err(format!("Failed to get permission: {:?}", e)),
        }
    }

    /// Get current context ID
    pub fn get_context_id(&self) -> String {
        if self.is_private {
            format!("private_{}", format!("{:?}", self.owner))
        } else {
            self.context_name.clone()
        }
    }

    /// Get identity mapping for a specific context
    pub fn get_identity_mapping(&self, context_id: String) -> Result<IdentityMapping, String> {
        if !self.is_private {
            return Err("Identity mappings can only be accessed in private context".to_string());
        }

        match self.identity_mappings.get(&context_id) {
            Ok(Some(mapping)) => Ok(mapping.clone()),
            Ok(None) => Err("Identity mapping not found for this context".to_string()),
            Err(e) => Err(format!("Failed to get identity mapping: {:?}", e)),
        }
    }

    /// Get shared identity for a specific context
    pub fn get_shared_identity(&self, context_id: String) -> Result<UserId, String> {
        if !self.is_private {
            return Err("Identity resolution can only be done in private context".to_string());
        }

        let mapping = self.get_identity_mapping(context_id)?;
        Ok(mapping.shared_identity)
    }

    /// Resolve private identity from shared identity
    pub fn resolve_private_identity(
        &self,
        shared_identity: UserId,
    ) -> Result<Option<UserId>, String> {
        if self.is_private {
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
}
