//! # Private Docs Application
//!
//! A private document management application built on Calimero.
//! Uses LwwRegister for content with pure insert() updates (no remove() first).
//! Supports hierarchical folder organization similar to Notion.

#![allow(clippy::len_without_is_empty)]

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::Serialize;
use calimero_sdk::{app, env};
use calimero_storage::collections::{Counter, LwwRegister, Mergeable, UnorderedMap, UnorderedSet};

const IDENTITY_SIZE: usize = 32;

fn encode_identity(identity: &[u8; IDENTITY_SIZE]) -> String {
    bs58::encode(identity).into_string()
}

fn generate_doc_id(counter: u64) -> String {
    format!("doc_{}", counter)
}

fn generate_folder_id(counter: u64) -> String {
    format!("folder_{}", counter)
}

/// Folder for organizing documents hierarchically.
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Folder {
    pub id: LwwRegister<String>,
    pub name: LwwRegister<String>,
    pub parent_id: LwwRegister<Option<String>>,  // None = root level
    pub created_at: LwwRegister<u64>,
    pub updated_at: LwwRegister<u64>,
    pub color: LwwRegister<Option<String>>,  // Optional color for folder icon
}

impl Mergeable for Folder {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        self.id.merge(&other.id);
        self.name.merge(&other.name);
        self.parent_id.merge(&other.parent_id);
        self.created_at.merge(&other.created_at);
        self.updated_at.merge(&other.updated_at);
        self.color.merge(&other.color);
        Ok(())
    }
}

/// Document with all fields as CRDTs.
/// Content uses LwwRegister<String> for simplicity.
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Document {
    pub id: LwwRegister<String>,
    pub title: LwwRegister<String>,
    pub content: LwwRegister<String>,
    pub author: LwwRegister<String>,
    pub created_at: LwwRegister<u64>,
    pub updated_at: LwwRegister<u64>,
    pub tags: UnorderedSet<String>,
    pub archived: LwwRegister<bool>,
    pub folder_id: LwwRegister<Option<String>>,  // None = root level
}

impl Mergeable for Document {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        self.id.merge(&other.id);
        self.title.merge(&other.title);
        self.content.merge(&other.content);
        self.author.merge(&other.author);
        self.created_at.merge(&other.created_at);
        self.updated_at.merge(&other.updated_at);
        self.archived.merge(&other.archived);
        self.tags.merge(&other.tags)?;
        self.folder_id.merge(&other.folder_id);
        Ok(())
    }
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocumentSummary {
    pub id: String,
    pub title: String,
    pub author: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub tags: Vec<String>,
    pub archived: bool,
    pub preview: String,
    pub folder_id: Option<String>,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocumentResponse {
    pub id: String,
    pub title: String,
    pub content: String,
    pub author: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub tags: Vec<String>,
    pub archived: bool,
    pub folder_id: Option<String>,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FolderResponse {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub color: Option<String>,
    pub document_count: usize,
    pub subfolder_count: usize,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FolderTreeItem {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color: Option<String>,
    pub document_count: usize,
    pub children: Vec<FolderTreeItem>,
}

#[app::state(emits = DocsEvent)]
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct DocsApp {
    pub owner: LwwRegister<String>,
    pub documents: UnorderedMap<String, Document>,
    pub folders: UnorderedMap<String, Folder>,
    pub doc_counter: Counter,
    pub folder_counter: Counter,
}

#[app::event]
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub enum DocsEvent {
    DocumentCreated { id: String, title: String, author: String },
    DocumentUpdated { id: String, title: String, editor: String },
    DocumentDeleted { id: String, title: String },
    DocumentArchived { id: String, archived: bool },
    DocumentMoved { id: String, from_folder: Option<String>, to_folder: Option<String> },
    FolderCreated { id: String, name: String, parent_id: Option<String> },
    FolderUpdated { id: String, name: String },
    FolderDeleted { id: String, name: String },
    FolderMoved { id: String, from_parent: Option<String>, to_parent: Option<String> },
}

fn extract_tags(tags: &UnorderedSet<String>) -> Result<Vec<String>, String> {
    let iter = tags.iter().map_err(|e| format!("Failed to iterate tags: {:?}", e))?;
    Ok(iter.collect())
}

#[app::logic]
impl DocsApp {
    #[app::init]
    pub fn init() -> DocsApp {
        let owner_id = env::executor_id();
        let owner = encode_identity(&owner_id);
        app::log!("Initializing Private Docs app for owner: {}", owner);

        DocsApp {
            owner: owner.into(),
            documents: UnorderedMap::new(),
            folders: UnorderedMap::new(),
            doc_counter: Counter::new(),
            folder_counter: Counter::new(),
        }
    }

    pub fn create_document(
        &mut self,
        title: String,
        content: String,
        tags: Vec<String>,
        folder_id: Option<String>,
    ) -> Result<String, String> {
        if title.trim().is_empty() {
            return Err("Document title cannot be empty".to_string());
        }

        // Verify folder exists if specified
        if let Some(ref fid) = folder_id {
            let folder_exists = self.folders.get(fid)
                .map_err(|e| format!("Failed to check folder: {:?}", e))?
                .is_some();
            if !folder_exists {
                return Err(format!("Folder not found: {}", fid));
            }
        }

        let counter_value = self.doc_counter.value()
            .map_err(|e| format!("Failed to get counter: {:?}", e))?;
        self.doc_counter.increment()
            .map_err(|e| format!("Failed to increment counter: {:?}", e))?;

        let doc_id = generate_doc_id(counter_value);
        let author_id = env::executor_id();
        let author = encode_identity(&author_id);
        let timestamp = env::time_now();

        let mut tags_set = UnorderedSet::new();
        for tag in &tags {
            tags_set.insert(tag.clone()).map_err(|e| format!("Failed to add tag: {:?}", e))?;
        }

        let document = Document {
            id: LwwRegister::new(doc_id.clone()),
            title: LwwRegister::new(title.clone()),
            content: LwwRegister::new(content),
            author: LwwRegister::new(author.clone()),
            created_at: LwwRegister::new(timestamp),
            updated_at: LwwRegister::new(timestamp),
            tags: tags_set,
            archived: LwwRegister::new(false),
            folder_id: LwwRegister::new(folder_id),
        };

        self.documents.insert(doc_id.clone(), document)
            .map_err(|e| format!("Failed to store document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentCreated {
            id: doc_id.clone(),
            title: title.clone(),
            author,
        });

        app::log!("Document created: {} (ID: {})", title, doc_id);
        Ok(doc_id)
    }

    /// Set content using pure insert() - no remove() first
    pub fn set_content(&mut self, doc_id: String, content: String) -> Result<(), String> {
        // Get current document to preserve other fields
        let old_doc = self.documents.get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);
        let timestamp = env::time_now();

        // Create new document with updated content, preserving other fields
        // Clone the old tags into a new UnorderedSet
        let mut new_tags = UnorderedSet::new();
        let old_tags_vec = extract_tags(&old_doc.tags)?;
        for tag in old_tags_vec {
            new_tags.insert(tag).map_err(|e| format!("Failed to copy tag: {:?}", e))?;
        }

        let new_doc = Document {
            id: LwwRegister::new(old_doc.id.get().clone()),
            title: LwwRegister::new(old_doc.title.get().clone()),
            content: LwwRegister::new(content),
            author: LwwRegister::new(old_doc.author.get().clone()),
            created_at: LwwRegister::new(*old_doc.created_at.get()),
            updated_at: LwwRegister::new(timestamp),
            tags: new_tags,
            archived: LwwRegister::new(*old_doc.archived.get()),
            folder_id: LwwRegister::new(old_doc.folder_id.get().clone()),
        };

        let doc_title = new_doc.title.get().clone();

        // Use insert() directly - this overwrites without remove()
        self.documents.insert(doc_id.clone(), new_doc)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentUpdated {
            id: doc_id.clone(),
            title: doc_title,
            editor,
        });

        app::log!("Content updated for document {}", doc_id);
        Ok(())
    }

    /// Update metadata using pure insert() - no remove() first
    pub fn update_document_metadata(
        &mut self,
        doc_id: String,
        title: Option<String>,
        archived: Option<bool>,
    ) -> Result<(), String> {
        let old_doc = self.documents.get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);
        let timestamp = env::time_now();

        let new_title = title.filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| old_doc.title.get().clone());
        let new_archived = archived.unwrap_or_else(|| *old_doc.archived.get());

        let mut new_tags = UnorderedSet::new();
        let old_tags_vec = extract_tags(&old_doc.tags)?;
        for tag in old_tags_vec {
            new_tags.insert(tag).map_err(|e| format!("Failed to copy tag: {:?}", e))?;
        }

        let new_doc = Document {
            id: LwwRegister::new(old_doc.id.get().clone()),
            title: LwwRegister::new(new_title.clone()),
            content: LwwRegister::new(old_doc.content.get().clone()),
            author: LwwRegister::new(old_doc.author.get().clone()),
            created_at: LwwRegister::new(*old_doc.created_at.get()),
            updated_at: LwwRegister::new(timestamp),
            tags: new_tags,
            archived: LwwRegister::new(new_archived),
            folder_id: LwwRegister::new(old_doc.folder_id.get().clone()),
        };

        self.documents.insert(doc_id.clone(), new_doc)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentUpdated {
            id: doc_id.clone(),
            title: new_title,
            editor,
        });

        app::log!("Document metadata updated (ID: {})", doc_id);
        Ok(())
    }

    pub fn add_tag(&mut self, doc_id: String, tag: String) -> Result<(), String> {
        let old_doc = self.documents.get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let timestamp = env::time_now();

        let mut new_tags = UnorderedSet::new();
        let old_tags_vec = extract_tags(&old_doc.tags)?;
        for t in old_tags_vec {
            new_tags.insert(t).map_err(|e| format!("Failed to copy tag: {:?}", e))?;
        }
        new_tags.insert(tag.clone()).map_err(|e| format!("Failed to add tag: {:?}", e))?;

        let new_doc = Document {
            id: LwwRegister::new(old_doc.id.get().clone()),
            title: LwwRegister::new(old_doc.title.get().clone()),
            content: LwwRegister::new(old_doc.content.get().clone()),
            author: LwwRegister::new(old_doc.author.get().clone()),
            created_at: LwwRegister::new(*old_doc.created_at.get()),
            updated_at: LwwRegister::new(timestamp),
            tags: new_tags,
            archived: LwwRegister::new(*old_doc.archived.get()),
            folder_id: LwwRegister::new(old_doc.folder_id.get().clone()),
        };

        self.documents.insert(doc_id.clone(), new_doc)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::log!("Tag '{}' added to document {}", tag, doc_id);
        Ok(())
    }

    pub fn set_tags(&mut self, doc_id: String, tags: Vec<String>) -> Result<(), String> {
        let old_doc = self.documents.get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let timestamp = env::time_now();

        let mut new_tags = UnorderedSet::new();
        // Keep old tags
        let old_tags_vec = extract_tags(&old_doc.tags)?;
        for t in old_tags_vec {
            new_tags.insert(t).map_err(|e| format!("Failed to copy tag: {:?}", e))?;
        }
        // Add new tags
        for tag in tags {
            if !tag.is_empty() {
                new_tags.insert(tag).map_err(|e| format!("Failed to add tag: {:?}", e))?;
            }
        }

        let new_doc = Document {
            id: LwwRegister::new(old_doc.id.get().clone()),
            title: LwwRegister::new(old_doc.title.get().clone()),
            content: LwwRegister::new(old_doc.content.get().clone()),
            author: LwwRegister::new(old_doc.author.get().clone()),
            created_at: LwwRegister::new(*old_doc.created_at.get()),
            updated_at: LwwRegister::new(timestamp),
            tags: new_tags,
            archived: LwwRegister::new(*old_doc.archived.get()),
            folder_id: LwwRegister::new(old_doc.folder_id.get().clone()),
        };

        self.documents.insert(doc_id.clone(), new_doc)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::log!("Tags updated for document {}", doc_id);
        Ok(())
    }

    pub fn delete_document(&mut self, doc_id: String) -> Result<(), String> {
        let doc = self.documents.get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let title = doc.title.get().clone();

        self.documents.remove(&doc_id)
            .map_err(|e| format!("Failed to delete document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentDeleted {
            id: doc_id.clone(),
            title: title.clone(),
        });

        app::log!("Document deleted: {} (ID: {})", title, doc_id);
        Ok(())
    }

    pub fn set_archived(&mut self, doc_id: String, archived: bool) -> Result<(), String> {
        let old_doc = self.documents.get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let timestamp = env::time_now();

        let mut new_tags = UnorderedSet::new();
        let old_tags_vec = extract_tags(&old_doc.tags)?;
        for tag in old_tags_vec {
            new_tags.insert(tag).map_err(|e| format!("Failed to copy tag: {:?}", e))?;
        }

        let new_doc = Document {
            id: LwwRegister::new(old_doc.id.get().clone()),
            title: LwwRegister::new(old_doc.title.get().clone()),
            content: LwwRegister::new(old_doc.content.get().clone()),
            author: LwwRegister::new(old_doc.author.get().clone()),
            created_at: LwwRegister::new(*old_doc.created_at.get()),
            updated_at: LwwRegister::new(timestamp),
            tags: new_tags,
            archived: LwwRegister::new(archived),
            folder_id: LwwRegister::new(old_doc.folder_id.get().clone()),
        };

        self.documents.insert(doc_id.clone(), new_doc)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentArchived {
            id: doc_id.clone(),
            archived,
        });

        app::log!("Document {} archive status: {}", doc_id, if archived { "archived" } else { "unarchived" });
        Ok(())
    }

    pub fn get_document(&self, doc_id: String) -> Result<DocumentResponse, String> {
        let doc = self.documents.get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let tags = extract_tags(&doc.tags)?;

        Ok(DocumentResponse {
            id: doc.id.get().clone(),
            title: doc.title.get().clone(),
            content: doc.content.get().clone(),
            author: doc.author.get().clone(),
            created_at: *doc.created_at.get(),
            updated_at: *doc.updated_at.get(),
            tags,
            archived: *doc.archived.get(),
            folder_id: doc.folder_id.get().clone(),
        })
    }

    pub fn get_content(&self, doc_id: String) -> Result<String, String> {
        let doc = self.documents.get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;
        Ok(doc.content.get().clone())
    }

    pub fn get_content_length(&self, doc_id: String) -> Result<usize, String> {
        let doc = self.documents.get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;
        Ok(doc.content.get().len())
    }

    pub fn list_documents(&self, include_archived: bool) -> Result<Vec<DocumentSummary>, String> {
        let mut documents = Vec::new();

        let entries = self.documents.entries()
            .map_err(|e| format!("Failed to list documents: {:?}", e))?;

        for (_, doc) in entries {
            let archived = *doc.archived.get();
            if include_archived || !archived {
                let content = doc.content.get();
                let preview = if content.len() > 200 {
                    format!("{}...", &content[..200])
                } else {
                    content.clone()
                };

                let tags = extract_tags(&doc.tags)?;

                documents.push(DocumentSummary {
                    id: doc.id.get().clone(),
                    title: doc.title.get().clone(),
                    author: doc.author.get().clone(),
                    created_at: *doc.created_at.get(),
                    updated_at: *doc.updated_at.get(),
                    tags,
                    archived,
                    preview,
                    folder_id: doc.folder_id.get().clone(),
                });
            }
        }

        documents.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        app::log!("Listed {} documents", documents.len());
        Ok(documents)
    }

    pub fn search_documents(&self, query: String, include_archived: bool) -> Result<Vec<DocumentSummary>, String> {
        let mut results = Vec::new();
        let query_lower = query.to_lowercase();

        let entries = self.documents.entries()
            .map_err(|e| format!("Failed to search documents: {:?}", e))?;

        for (_, doc) in entries {
            if !include_archived && *doc.archived.get() {
                continue;
            }

            let content = doc.content.get();
            let title_match = doc.title.get().to_lowercase().contains(&query_lower);
            let content_match = content.to_lowercase().contains(&query_lower);
            let tags = extract_tags(&doc.tags)?;
            let tags_match = tags.iter().any(|tag| tag.to_lowercase().contains(&query_lower));

            if title_match || content_match || tags_match {
                let preview = if content.len() > 200 {
                    format!("{}...", &content[..200])
                } else {
                    content.clone()
                };

                results.push(DocumentSummary {
                    id: doc.id.get().clone(),
                    title: doc.title.get().clone(),
                    author: doc.author.get().clone(),
                    created_at: *doc.created_at.get(),
                    updated_at: *doc.updated_at.get(),
                    tags,
                    archived: *doc.archived.get(),
                    preview,
                    folder_id: doc.folder_id.get().clone(),
                });
            }
        }

        results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        app::log!("Search for '{}' found {} results", query, results.len());
        Ok(results)
    }

    pub fn get_documents_by_tag(&self, tag: String, include_archived: bool) -> Result<Vec<DocumentSummary>, String> {
        let mut results = Vec::new();
        let tag_lower = tag.to_lowercase();

        let entries = self.documents.entries()
            .map_err(|e| format!("Failed to filter documents: {:?}", e))?;

        for (_, doc) in entries {
            if !include_archived && *doc.archived.get() {
                continue;
            }

            let tags = extract_tags(&doc.tags)?;
            let has_tag = tags.iter().any(|t| t.to_lowercase() == tag_lower);

            if has_tag {
                let content = doc.content.get();
                let preview = if content.len() > 200 {
                    format!("{}...", &content[..200])
                } else {
                    content.clone()
                };

                results.push(DocumentSummary {
                    id: doc.id.get().clone(),
                    title: doc.title.get().clone(),
                    author: doc.author.get().clone(),
                    created_at: *doc.created_at.get(),
                    updated_at: *doc.updated_at.get(),
                    tags,
                    archived: *doc.archived.get(),
                    preview,
                    folder_id: doc.folder_id.get().clone(),
                });
            }
        }

        results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        app::log!("Filter by tag '{}' found {} results", tag, results.len());
        Ok(results)
    }

    pub fn get_all_tags(&self) -> Result<Vec<String>, String> {
        let mut tags_set = std::collections::BTreeSet::new();

        let entries = self.documents.entries()
            .map_err(|e| format!("Failed to get tags: {:?}", e))?;

        for (_, doc) in entries {
            let tags = extract_tags(&doc.tags)?;
            for tag in tags {
                tags_set.insert(tag);
            }
        }

        let tags: Vec<String> = tags_set.into_iter().collect();
        app::log!("Found {} unique tags", tags.len());
        Ok(tags)
    }

    pub fn get_stats(&self) -> Result<String, String> {
        let mut total_docs = 0u64;
        let mut archived_docs = 0u64;
        let mut total_tags = std::collections::BTreeSet::new();

        let entries = self.documents.entries()
            .map_err(|e| format!("Failed to get stats: {:?}", e))?;

        for (_, doc) in entries {
            total_docs += 1;
            if *doc.archived.get() {
                archived_docs += 1;
            }
            let tags = extract_tags(&doc.tags)?;
            for tag in tags {
                total_tags.insert(tag);
            }
        }

        let owner = self.owner.get();

        Ok(format!(
            "Private Docs Statistics:\n\
             - Total documents: {}\n\
             - Active documents: {}\n\
             - Archived documents: {}\n\
             - Unique tags: {}\n\
             - Owner: {}",
            total_docs,
            total_docs - archived_docs,
            archived_docs,
            total_tags.len(),
            owner
        ))
    }

    pub fn get_document_count(&self) -> Result<usize, String> {
        self.documents.len()
            .map_err(|e| format!("Failed to get document count: {:?}", e))
    }

    // ========== FOLDER METHODS ==========

    /// Create a new folder
    pub fn create_folder(
        &mut self,
        name: String,
        parent_id: Option<String>,
        color: Option<String>,
    ) -> Result<String, String> {
        if name.trim().is_empty() {
            return Err("Folder name cannot be empty".to_string());
        }

        // Verify parent folder exists if specified
        if let Some(ref pid) = parent_id {
            let parent_exists = self.folders.get(pid)
                .map_err(|e| format!("Failed to check parent folder: {:?}", e))?
                .is_some();
            if !parent_exists {
                return Err(format!("Parent folder not found: {}", pid));
            }
        }

        let counter_value = self.folder_counter.value()
            .map_err(|e| format!("Failed to get folder counter: {:?}", e))?;
        self.folder_counter.increment()
            .map_err(|e| format!("Failed to increment folder counter: {:?}", e))?;

        let folder_id = generate_folder_id(counter_value);
        let timestamp = env::time_now();

        let folder = Folder {
            id: LwwRegister::new(folder_id.clone()),
            name: LwwRegister::new(name.clone()),
            parent_id: LwwRegister::new(parent_id.clone()),
            created_at: LwwRegister::new(timestamp),
            updated_at: LwwRegister::new(timestamp),
            color: LwwRegister::new(color),
        };

        self.folders.insert(folder_id.clone(), folder)
            .map_err(|e| format!("Failed to store folder: {:?}", e))?;

        app::emit!(DocsEvent::FolderCreated {
            id: folder_id.clone(),
            name: name.clone(),
            parent_id,
        });

        app::log!("Folder created: {} (ID: {})", name, folder_id);
        Ok(folder_id)
    }

    /// Rename a folder
    pub fn rename_folder(&mut self, folder_id: String, name: String) -> Result<(), String> {
        if name.trim().is_empty() {
            return Err("Folder name cannot be empty".to_string());
        }

        let old_folder = self.folders.get(&folder_id)
            .map_err(|e| format!("Failed to access folder: {:?}", e))?
            .ok_or_else(|| format!("Folder not found: {}", folder_id))?;

        let timestamp = env::time_now();

        let new_folder = Folder {
            id: LwwRegister::new(old_folder.id.get().clone()),
            name: LwwRegister::new(name.clone()),
            parent_id: LwwRegister::new(old_folder.parent_id.get().clone()),
            created_at: LwwRegister::new(*old_folder.created_at.get()),
            updated_at: LwwRegister::new(timestamp),
            color: LwwRegister::new(old_folder.color.get().clone()),
        };

        self.folders.insert(folder_id.clone(), new_folder)
            .map_err(|e| format!("Failed to save folder: {:?}", e))?;

        app::emit!(DocsEvent::FolderUpdated {
            id: folder_id.clone(),
            name: name.clone(),
        });

        app::log!("Folder renamed: {} (ID: {})", name, folder_id);
        Ok(())
    }

    /// Update folder color
    pub fn set_folder_color(&mut self, folder_id: String, color: Option<String>) -> Result<(), String> {
        let old_folder = self.folders.get(&folder_id)
            .map_err(|e| format!("Failed to access folder: {:?}", e))?
            .ok_or_else(|| format!("Folder not found: {}", folder_id))?;

        let timestamp = env::time_now();

        let new_folder = Folder {
            id: LwwRegister::new(old_folder.id.get().clone()),
            name: LwwRegister::new(old_folder.name.get().clone()),
            parent_id: LwwRegister::new(old_folder.parent_id.get().clone()),
            created_at: LwwRegister::new(*old_folder.created_at.get()),
            updated_at: LwwRegister::new(timestamp),
            color: LwwRegister::new(color),
        };

        self.folders.insert(folder_id.clone(), new_folder)
            .map_err(|e| format!("Failed to save folder: {:?}", e))?;

        app::log!("Folder color updated (ID: {})", folder_id);
        Ok(())
    }

    /// Move a folder to a new parent (or root if parent_id is None)
    pub fn move_folder(&mut self, folder_id: String, new_parent_id: Option<String>) -> Result<(), String> {
        // Prevent moving folder into itself
        if let Some(ref pid) = new_parent_id {
            if pid == &folder_id {
                return Err("Cannot move folder into itself".to_string());
            }
            // Check for circular reference by walking up the tree
            let mut current_id = new_parent_id.clone();
            while let Some(cid) = current_id {
                if cid == folder_id {
                    return Err("Cannot create circular folder structure".to_string());
                }
                let parent = self.folders.get(&cid)
                    .map_err(|e| format!("Failed to check folder hierarchy: {:?}", e))?;
                current_id = parent.and_then(|f| f.parent_id.get().clone());
            }
        }

        let old_folder = self.folders.get(&folder_id)
            .map_err(|e| format!("Failed to access folder: {:?}", e))?
            .ok_or_else(|| format!("Folder not found: {}", folder_id))?;

        let from_parent = old_folder.parent_id.get().clone();
        
        // Verify new parent exists if specified
        if let Some(ref pid) = new_parent_id {
            let parent_exists = self.folders.get(pid)
                .map_err(|e| format!("Failed to check new parent folder: {:?}", e))?
                .is_some();
            if !parent_exists {
                return Err(format!("New parent folder not found: {}", pid));
            }
        }

        let timestamp = env::time_now();

        let new_folder = Folder {
            id: LwwRegister::new(old_folder.id.get().clone()),
            name: LwwRegister::new(old_folder.name.get().clone()),
            parent_id: LwwRegister::new(new_parent_id.clone()),
            created_at: LwwRegister::new(*old_folder.created_at.get()),
            updated_at: LwwRegister::new(timestamp),
            color: LwwRegister::new(old_folder.color.get().clone()),
        };

        self.folders.insert(folder_id.clone(), new_folder)
            .map_err(|e| format!("Failed to save folder: {:?}", e))?;

        app::emit!(DocsEvent::FolderMoved {
            id: folder_id.clone(),
            from_parent,
            to_parent: new_parent_id,
        });

        app::log!("Folder moved (ID: {})", folder_id);
        Ok(())
    }

    /// Delete a folder (optionally recursively)
    pub fn delete_folder(&mut self, folder_id: String, recursive: bool) -> Result<(), String> {
        let folder = self.folders.get(&folder_id)
            .map_err(|e| format!("Failed to access folder: {:?}", e))?
            .ok_or_else(|| format!("Folder not found: {}", folder_id))?;

        let folder_name = folder.name.get().clone();

        // Check for subfolders
        let subfolder_ids: Vec<String> = self.folders.entries()
            .map_err(|e| format!("Failed to list folders: {:?}", e))?
            .filter_map(|(id, f)| {
                if f.parent_id.get().as_ref() == Some(&folder_id) {
                    Some(id)
                } else {
                    None
                }
            })
            .collect();

        // Check for documents in folder
        let doc_ids: Vec<String> = self.documents.entries()
            .map_err(|e| format!("Failed to list documents: {:?}", e))?
            .filter_map(|(id, d)| {
                if d.folder_id.get().as_ref() == Some(&folder_id) {
                    Some(id)
                } else {
                    None
                }
            })
            .collect();

        if !recursive && (!subfolder_ids.is_empty() || !doc_ids.is_empty()) {
            return Err("Folder is not empty. Use recursive=true to delete contents.".to_string());
        }

        // Recursively delete subfolders
        for subfolder_id in subfolder_ids {
            self.delete_folder(subfolder_id, true)?;
        }

        // Move documents to root (or delete them if needed)
        for doc_id in doc_ids {
            self.move_document(doc_id, None)?;
        }

        // Delete the folder
        self.folders.remove(&folder_id)
            .map_err(|e| format!("Failed to delete folder: {:?}", e))?;

        app::emit!(DocsEvent::FolderDeleted {
            id: folder_id.clone(),
            name: folder_name.clone(),
        });

        app::log!("Folder deleted: {} (ID: {})", folder_name, folder_id);
        Ok(())
    }

    /// Get a single folder
    pub fn get_folder(&self, folder_id: String) -> Result<FolderResponse, String> {
        let folder = self.folders.get(&folder_id)
            .map_err(|e| format!("Failed to access folder: {:?}", e))?
            .ok_or_else(|| format!("Folder not found: {}", folder_id))?;

        // Count documents in folder
        let document_count = self.documents.entries()
            .map_err(|e| format!("Failed to count documents: {:?}", e))?
            .filter(|(_, d)| d.folder_id.get().as_ref() == Some(&folder_id))
            .count();

        // Count subfolders
        let subfolder_count = self.folders.entries()
            .map_err(|e| format!("Failed to count subfolders: {:?}", e))?
            .filter(|(_, f)| f.parent_id.get().as_ref() == Some(&folder_id))
            .count();

        Ok(FolderResponse {
            id: folder.id.get().clone(),
            name: folder.name.get().clone(),
            parent_id: folder.parent_id.get().clone(),
            created_at: *folder.created_at.get(),
            updated_at: *folder.updated_at.get(),
            color: folder.color.get().clone(),
            document_count,
            subfolder_count,
        })
    }

    /// List all folders
    pub fn list_folders(&self) -> Result<Vec<FolderResponse>, String> {
        let mut folders = Vec::new();

        let entries = self.folders.entries()
            .map_err(|e| format!("Failed to list folders: {:?}", e))?;

        for (folder_id, folder) in entries {
            // Count documents in folder
            let document_count = self.documents.entries()
                .map_err(|e| format!("Failed to count documents: {:?}", e))?
                .filter(|(_, d)| d.folder_id.get().as_ref() == Some(&folder_id))
                .count();

            // Count subfolders
            let subfolder_count = self.folders.entries()
                .map_err(|e| format!("Failed to count subfolders: {:?}", e))?
                .filter(|(_, f)| f.parent_id.get().as_ref() == Some(&folder_id))
                .count();

            folders.push(FolderResponse {
                id: folder.id.get().clone(),
                name: folder.name.get().clone(),
                parent_id: folder.parent_id.get().clone(),
                created_at: *folder.created_at.get(),
                updated_at: *folder.updated_at.get(),
                color: folder.color.get().clone(),
                document_count,
                subfolder_count,
            });
        }

        folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        app::log!("Listed {} folders", folders.len());
        Ok(folders)
    }

    /// Get folder tree structure
    pub fn get_folder_tree(&self) -> Result<Vec<FolderTreeItem>, String> {
        let all_folders: Vec<_> = self.folders.entries()
            .map_err(|e| format!("Failed to list folders: {:?}", e))?
            .collect();

        fn build_tree(
            folders: &[(String, &Folder)],
            parent_id: Option<&String>,
            documents: &UnorderedMap<String, Document>,
        ) -> Result<Vec<FolderTreeItem>, String> {
            let mut items = Vec::new();

            for (folder_id, folder) in folders {
                let folder_parent = folder.parent_id.get();
                let matches = match (parent_id, folder_parent.as_ref()) {
                    (None, None) => true,
                    (Some(pid), Some(fpid)) => pid == fpid,
                    _ => false,
                };

                if matches {
                    let document_count = documents.entries()
                        .map_err(|e| format!("Failed to count documents: {:?}", e))?
                        .filter(|(_, d)| d.folder_id.get().as_ref() == Some(folder_id))
                        .count();

                    let children = build_tree(folders, Some(folder_id), documents)?;

                    items.push(FolderTreeItem {
                        id: folder.id.get().clone(),
                        name: folder.name.get().clone(),
                        parent_id: folder.parent_id.get().clone(),
                        color: folder.color.get().clone(),
                        document_count,
                        children,
                    });
                }
            }

            items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            Ok(items)
        }

        let folder_refs: Vec<_> = all_folders.iter().map(|(id, f)| (id.clone(), f)).collect();
        build_tree(&folder_refs, None, &self.documents)
    }

    /// Get documents in a specific folder (or root if folder_id is None)
    pub fn get_documents_in_folder(
        &self,
        folder_id: Option<String>,
        include_archived: bool,
    ) -> Result<Vec<DocumentSummary>, String> {
        let mut documents = Vec::new();

        let entries = self.documents.entries()
            .map_err(|e| format!("Failed to list documents: {:?}", e))?;

        for (_, doc) in entries {
            let archived = *doc.archived.get();
            if !include_archived && archived {
                continue;
            }

            let doc_folder = doc.folder_id.get();
            let matches = match (&folder_id, doc_folder.as_ref()) {
                (None, None) => true,  // Both root
                (Some(fid), Some(dfid)) => fid == dfid,  // Same folder
                _ => false,
            };

            if matches {
                let content = doc.content.get();
                let preview = if content.len() > 200 {
                    format!("{}...", &content[..200])
                } else {
                    content.clone()
                };

                let tags = extract_tags(&doc.tags)?;

                documents.push(DocumentSummary {
                    id: doc.id.get().clone(),
                    title: doc.title.get().clone(),
                    author: doc.author.get().clone(),
                    created_at: *doc.created_at.get(),
                    updated_at: *doc.updated_at.get(),
                    tags,
                    archived,
                    preview,
                    folder_id: doc.folder_id.get().clone(),
                });
            }
        }

        documents.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        app::log!("Found {} documents in folder", documents.len());
        Ok(documents)
    }

    /// Move a document to a different folder
    pub fn move_document(&mut self, doc_id: String, folder_id: Option<String>) -> Result<(), String> {
        let old_doc = self.documents.get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let from_folder = old_doc.folder_id.get().clone();

        // Verify new folder exists if specified
        if let Some(ref fid) = folder_id {
            let folder_exists = self.folders.get(fid)
                .map_err(|e| format!("Failed to check folder: {:?}", e))?
                .is_some();
            if !folder_exists {
                return Err(format!("Folder not found: {}", fid));
            }
        }

        let timestamp = env::time_now();
        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);

        let mut new_tags = UnorderedSet::new();
        let old_tags_vec = extract_tags(&old_doc.tags)?;
        for tag in old_tags_vec {
            new_tags.insert(tag).map_err(|e| format!("Failed to copy tag: {:?}", e))?;
        }

        let new_doc = Document {
            id: LwwRegister::new(old_doc.id.get().clone()),
            title: LwwRegister::new(old_doc.title.get().clone()),
            content: LwwRegister::new(old_doc.content.get().clone()),
            author: LwwRegister::new(old_doc.author.get().clone()),
            created_at: LwwRegister::new(*old_doc.created_at.get()),
            updated_at: LwwRegister::new(timestamp),
            tags: new_tags,
            archived: LwwRegister::new(*old_doc.archived.get()),
            folder_id: LwwRegister::new(folder_id.clone()),
        };

        self.documents.insert(doc_id.clone(), new_doc)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentMoved {
            id: doc_id.clone(),
            from_folder,
            to_folder: folder_id,
        });

        app::log!("Document moved (ID: {})", doc_id);
        let _ = editor; // Suppress unused warning
        Ok(())
    }

    /// Get folder count
    pub fn get_folder_count(&self) -> Result<usize, String> {
        self.folders.len()
            .map_err(|e| format!("Failed to get folder count: {:?}", e))
    }
}
