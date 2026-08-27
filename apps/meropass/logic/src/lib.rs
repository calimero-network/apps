#![allow(clippy::len_without_is_empty)]

use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::Serialize;
use calimero_sdk::env;
use calimero_storage::collections::UnorderedMap;
use thiserror::Error;

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct SecretItem {
    pub id: String,
    pub name: String,
    pub secret_type: String, // "login", "secure_note", "totp", "ssh_key", "payment_card"
    pub data: String, // JSON serialized secret data
    pub tags: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub version: u64,
    pub created_by: String, // user public key
}

// Removed Vault: a Calimero context IS a vault.

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct AuditLogEntry {
    pub id: String,
    pub action: String,
    pub details: String,
    pub user_public_key: String,
    pub timestamp: u64,
}

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Vault not found")]
    VaultNotFound,
    #[error("Secret not found")]
    SecretNotFound,
    #[error("Invalid secret type")]
    InvalidSecretType,
    #[error("Unauthorized access")]
    Unauthorized,
}

pub type Result<T> = std::result::Result<T, AppError>;

#[app::state(emits = for<'a> Event<'a>)]
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MeroPassApp {
    pub secrets: UnorderedMap<String, SecretItem>,
    pub audit_logs: UnorderedMap<String, AuditLogEntry>,
}

#[app::event]
pub enum Event<'a> {
    SecretAdded { secret_id: &'a str, name: &'a str },
    SecretUpdated { secret_id: &'a str, name: &'a str },
    SecretDeleted { secret_id: &'a str, name: &'a str },
}

#[app::logic]
impl MeroPassApp {
    #[app::init]
    pub fn init() -> MeroPassApp {
        MeroPassApp {
            secrets: UnorderedMap::new(),
            audit_logs: UnorderedMap::new(),
        }
    }


    pub fn add_secret(&mut self, name: String, secret_type: String, data: String, tags: Vec<String>) -> app::Result<String> {
        app::log!("Adding secret: {} of type: {}", name, secret_type);
        
        let secret_id = format!("secret_{}", env::time_now());
        let executor_pk = format!("{:?}", env::executor_id());
        
        let secret = SecretItem {
            id: secret_id.clone(),
            name: name.clone(),
            secret_type,
            data,
            tags: tags.clone(),
            created_at: env::time_now(),
            updated_at: env::time_now(),
            version: 1,
            created_by: executor_pk.clone(),
        };

        self.secrets.insert(secret_id.clone(), secret)?;
        
        app::emit!(Event::SecretAdded {
            secret_id: &secret_id,
            name: &name,
        });
        
        self.log_audit_event(
            &secret_id,
            "secret_added",
            &format!("Secret '{}' added", name),
        )?;

        Ok(secret_id)
    }
    pub fn update_secret(
        &mut self,
        secret_id: String,
        name: String,
        data: String,
        tags: Vec<String>,
    ) -> app::Result<()> {
        let secret = self.secrets.get(&secret_id)?.ok_or(AppError::SecretNotFound)?;
        let mut updated = secret;
        updated.name = name.clone();
        updated.data = data;
        updated.tags = tags.clone();
        updated.updated_at = env::time_now();
        updated.version += 1;
        self.secrets.insert(secret_id.clone(), updated)?;
        self.log_audit_event(
            &secret_id,
            "secret_updated",
            &format!("Secret '{}' updated", name),
        )?;
        Ok(())
    }

    pub fn delete_secret(&mut self, secret_id: String) -> app::Result<()> {
        let secret = self.secrets.get(&secret_id)?.ok_or(AppError::SecretNotFound)?;
        self.secrets.remove(&secret_id)?;
        self.log_audit_event(
            &secret_id,
            "secret_deleted",
            &format!("Secret '{}' deleted", secret.name),
        )?;
        Ok(())
    }

    pub fn get_secret(&self, secret_id: String) -> app::Result<Option<SecretItem>> {
        Ok(self.secrets.get(&secret_id)?)
    }

    pub fn list_secrets(&self) -> app::Result<Vec<SecretItem>> {
        let secrets: Vec<SecretItem> = self.secrets.entries()?.map(|(_, s)| s).collect();
        Ok(secrets)
    }

    pub fn search_secrets(&self, query: String) -> app::Result<Vec<SecretItem>> {
        let query_lower = query.to_lowercase();
        let results: Vec<SecretItem> = self
            .secrets
            .entries()? 
            .map(|(_, secret)| secret)
            .filter(|secret| {
                secret.name.to_lowercase().contains(&query_lower)
                    || secret
                        .tags
                        .iter()
                        .any(|tag| tag.to_lowercase().contains(&query_lower))
            })
            .collect();
        Ok(results)
    }

    pub fn get_secrets_by_tag(&self, tag: String) -> app::Result<Vec<SecretItem>> {
        let results: Vec<SecretItem> = self
            .secrets
            .entries()? 
            .map(|(_, secret)| secret)
            .filter(|secret| secret.tags.iter().any(|t| t == &tag))
            .collect();
        Ok(results)
    }

    pub fn get_audit_logs(&self) -> app::Result<Vec<AuditLogEntry>> {
        let mut logs: Vec<AuditLogEntry> = self.audit_logs.entries()?.map(|(_, l)| l).collect();
        logs.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        Ok(logs)
    }

    fn log_audit_event(
        &mut self,
        _entity_id: &str,
        action: &str,
        details: &str,
    ) -> app::Result<()> {
        let log_id = format!("log_{}", env::time_now());
        let log_entry = AuditLogEntry {
            id: log_id.clone(),
            action: action.to_string(),
            details: details.to_string(),
            user_public_key: format!("{:?}", env::executor_id()),
            timestamp: env::time_now(),
        };
        self.audit_logs.insert(log_id, log_entry)?;
        Ok(())
    }
}