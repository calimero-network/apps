//! # Mero Drive Application
//!
//! A private document management application built on Calimero.
//! Uses an RGA-backed document body for collaborative HTML strings.
//! Supports hierarchical folder organization similar to Notion.
//! Storage layout v2 replaces the old LWW string body and requires fresh app state.

#![allow(clippy::len_without_is_empty)]

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::Serialize;
use calimero_sdk::{app, env};
use calimero_storage::collections::{
    Counter, LwwRegister, Mergeable, ReplicatedGrowableArray, UnorderedMap, UnorderedSet,
};

const IDENTITY_SIZE: usize = 32;
const DOCUMENT_PREVIEW_LIMIT: usize = 200;
const STORAGE_LAYOUT_VERSION: u32 = 2;
const STORAGE_LAYOUT_MIGRATION_STRATEGY: &str =
    "Document.content now uses an RGA-backed Borsh layout; existing deployments must start with fresh app state.";

fn encode_identity(identity: &[u8; IDENTITY_SIZE]) -> String {
    bs58::encode(identity).into_string()
}

fn generate_doc_id(counter: u64) -> String {
    format!("doc_{}", counter)
}

fn generate_folder_id(counter: u64) -> String {
    format!("folder_{}", counter)
}

fn generate_file_id(counter: u64) -> String {
    format!("file_{}", counter)
}

/// Folder for organizing documents hierarchically.
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Folder {
    pub id: LwwRegister<String>,
    pub name: LwwRegister<String>,
    pub parent_id: LwwRegister<Option<String>>, // None = root level
    pub created_at: LwwRegister<u64>,
    pub updated_at: LwwRegister<u64>,
    pub color: LwwRegister<Option<String>>, // Optional color for folder icon
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

/// Uploaded file with metadata stored as CRDTs.
/// The binary content lives in Calimero blob storage; this struct holds the reference.
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct FileEntry {
    pub id: LwwRegister<String>,
    pub name: LwwRegister<String>,
    pub blob_id: LwwRegister<String>,
    pub mime_type: LwwRegister<String>,
    pub size: LwwRegister<u64>,
    pub folder_id: LwwRegister<Option<String>>,
    pub created_at: LwwRegister<u64>,
    pub updated_at: LwwRegister<u64>,
    pub uploaded_by: LwwRegister<String>,
}

impl Mergeable for FileEntry {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        self.id.merge(&other.id);
        self.name.merge(&other.name);
        self.blob_id.merge(&other.blob_id);
        self.mime_type.merge(&other.mime_type);
        self.size.merge(&other.size);
        self.folder_id.merge(&other.folder_id);
        self.created_at.merge(&other.created_at);
        self.updated_at.merge(&other.updated_at);
        self.uploaded_by.merge(&other.uploaded_by);
        Ok(())
    }
}

/// Registry entry for cross-context folder visibility.
/// Stored in the General context's folder_registry map.
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct FolderMeta {
    pub context_id: LwwRegister<String>,
    pub name: LwwRegister<String>,
    pub color: LwwRegister<Option<String>>,
    pub created_at: LwwRegister<u64>,
}

impl Mergeable for FolderMeta {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        self.context_id.merge(&other.context_id);
        self.name.merge(&other.name);
        self.color.merge(&other.color);
        self.created_at.merge(&other.created_at);
        Ok(())
    }
}

/// Document with all fields as CRDTs.
/// Content uses an RGA so concurrent edits preserve the stored HTML string.
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Document {
    pub id: LwwRegister<String>,
    pub title: LwwRegister<String>,
    pub content: ReplicatedGrowableArray,
    pub author: LwwRegister<String>,
    pub created_at: LwwRegister<u64>,
    pub updated_at: LwwRegister<u64>,
    pub tags: UnorderedSet<String>,
    pub archived: LwwRegister<bool>,
    pub folder_id: LwwRegister<Option<String>>, // None = root level
}

impl Mergeable for Document {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        self.id.merge(&other.id);
        self.title.merge(&other.title);
        self.content.merge(&other.content)?;
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

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FolderRegistryEntry {
    pub context_id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FileEntryResponse {
    pub id: String,
    pub name: String,
    pub blob_id: String,
    pub mime_type: String,
    pub size: u64,
    pub folder_id: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub uploaded_by: String,
}

#[app::state(emits = DocsEvent)]
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct DocsApp {
    pub owner: LwwRegister<String>,
    pub documents: UnorderedMap<String, Document>,
    pub folders: UnorderedMap<String, Folder>,
    pub files: UnorderedMap<String, FileEntry>,
    pub doc_counter: Counter,
    pub folder_counter: Counter,
    pub file_counter: Counter,
    pub context_name: LwwRegister<String>,
    pub folder_registry: UnorderedMap<String, FolderMeta>,
}

#[app::event]
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub enum DocsEvent {
    DocumentCreated {
        id: String,
        title: String,
        author: String,
    },
    DocumentUpdated {
        id: String,
        title: String,
        editor: String,
    },
    DocumentDeleted {
        id: String,
        title: String,
    },
    DocumentArchived {
        id: String,
        archived: bool,
    },
    DocumentMoved {
        id: String,
        from_folder: Option<String>,
        to_folder: Option<String>,
    },
    FolderCreated {
        id: String,
        name: String,
        parent_id: Option<String>,
    },
    FolderUpdated {
        id: String,
        name: String,
    },
    FolderDeleted {
        id: String,
        name: String,
    },
    FolderMoved {
        id: String,
        from_parent: Option<String>,
        to_parent: Option<String>,
    },
    ContextNameSet {
        name: String,
    },
    FolderRegistered {
        context_id: String,
        name: String,
    },
    FolderNameUpdated {
        context_id: String,
        name: String,
    },
    FolderUnregistered {
        context_id: String,
    },
    FileCreated {
        id: String,
        name: String,
        uploaded_by: String,
    },
    FileDeleted {
        id: String,
        name: String,
    },
    FileMoved {
        id: String,
        from_folder: Option<String>,
        to_folder: Option<String>,
    },
}

fn extract_tags(tags: &UnorderedSet<String>) -> Result<Vec<String>, String> {
    let iter = tags
        .iter()
        .map_err(|e| format!("Failed to iterate tags: {:?}", e))?;
    Ok(iter.collect())
}

fn rga_from_html(html: &str) -> Result<ReplicatedGrowableArray, String> {
    let mut content = ReplicatedGrowableArray::new();
    content
        .insert_str(0, html)
        .map_err(|e| format!("Failed to seed document content: {:?}", e))?;
    Ok(content)
}

fn html_from_rga(content: &ReplicatedGrowableArray) -> Result<String, String> {
    content
        .get_text()
        .map_err(|e| format!("Failed to read document content: {:?}", e))
}

fn decode_html_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn visible_text_from_html(html: &str) -> String {
    let mut visible = String::with_capacity(html.len());
    let mut inside_tag = false;

    for ch in html.chars() {
        match ch {
            '<' => {
                inside_tag = true;
                visible.push(' ');
            }
            '>' => {
                inside_tag = false;
                visible.push(' ');
            }
            _ if !inside_tag => visible.push(ch),
            _ => {}
        }
    }

    decode_html_entities(&visible)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn preview_from_visible_text(visible_text: &str) -> String {
    if visible_text.len() > DOCUMENT_PREVIEW_LIMIT {
        format!("{}...", &visible_text[..DOCUMENT_PREVIEW_LIMIT])
    } else {
        visible_text.to_string()
    }
}

fn preview_from_html(html: &str) -> String {
    preview_from_visible_text(&visible_text_from_html(html))
}

fn visible_text_matches_query(html: &str, query: &str) -> bool {
    visible_text_from_html(html)
        .to_lowercase()
        .contains(&query.to_lowercase())
}

fn build_tags_set(tags: Vec<String>) -> Result<UnorderedSet<String>, String> {
    let mut tags_set = UnorderedSet::new();
    for tag in tags {
        tags_set
            .insert(tag)
            .map_err(|e| format!("Failed to add tag: {:?}", e))?;
    }
    Ok(tags_set)
}

fn create_document_record(
    doc_id: String,
    title: String,
    content: String,
    tags: Vec<String>,
    folder_id: Option<String>,
    author: String,
    timestamp: u64,
) -> Result<Document, String> {
    Ok(Document {
        id: LwwRegister::new(doc_id),
        title: LwwRegister::new(title),
        content: rga_from_html(&content)?,
        author: LwwRegister::new(author),
        created_at: LwwRegister::new(timestamp),
        updated_at: LwwRegister::new(timestamp),
        tags: build_tags_set(tags)?,
        archived: LwwRegister::new(false),
        folder_id: LwwRegister::new(folder_id),
    })
}

fn document_response_from_document(doc: &Document) -> Result<DocumentResponse, String> {
    Ok(DocumentResponse {
        id: doc.id.get().clone(),
        title: doc.title.get().clone(),
        content: html_from_rga(&doc.content)?,
        author: doc.author.get().clone(),
        created_at: *doc.created_at.get(),
        updated_at: *doc.updated_at.get(),
        tags: extract_tags(&doc.tags)?,
        archived: *doc.archived.get(),
        folder_id: doc.folder_id.get().clone(),
    })
}

fn document_summary_from_document(doc: &Document) -> Result<DocumentSummary, String> {
    let content = html_from_rga(&doc.content)?;

    Ok(DocumentSummary {
        id: doc.id.get().clone(),
        title: doc.title.get().clone(),
        author: doc.author.get().clone(),
        created_at: *doc.created_at.get(),
        updated_at: *doc.updated_at.get(),
        tags: extract_tags(&doc.tags)?,
        archived: *doc.archived.get(),
        preview: preview_from_html(&content),
        folder_id: doc.folder_id.get().clone(),
    })
}

fn document_content_len(doc: &Document) -> Result<usize, String> {
    doc.content
        .len()
        .map_err(|e| format!("Failed to read document length: {:?}", e))
}

fn apply_insert_text(
    document: &mut Document,
    position: usize,
    text: &str,
    timestamp: u64,
) -> Result<(), String> {
    if text.is_empty() {
        return Err("Inserted text cannot be empty".to_string());
    }

    let content_len = document_content_len(document)?;
    if position > content_len {
        return Err("Insert position out of bounds".to_string());
    }

    document
        .content
        .insert_str(position, text)
        .map_err(|e| format!("Failed to insert text: {:?}", e))?;
    document.updated_at = LwwRegister::new(timestamp);
    Ok(())
}

fn apply_delete_text(
    document: &mut Document,
    start: usize,
    end: usize,
    timestamp: u64,
) -> Result<(), String> {
    if start >= end {
        return Err("Delete range start must be less than end".to_string());
    }

    let content_len = document_content_len(document)?;
    if end > content_len {
        return Err("Delete range out of bounds".to_string());
    }

    document
        .content
        .delete_range(start, end)
        .map_err(|e| format!("Failed to delete text: {:?}", e))?;
    document.updated_at = LwwRegister::new(timestamp);
    Ok(())
}

fn apply_replace_text(
    document: &mut Document,
    start: usize,
    end: usize,
    text: &str,
    timestamp: u64,
) -> Result<(), String> {
    if start > end {
        return Err("Replace range start must be less than or equal to end".to_string());
    }

    let content_len = document_content_len(document)?;
    if end > content_len {
        return Err("Replace range out of bounds".to_string());
    }

    if start == end && text.is_empty() {
        return Err("Replace operation cannot be empty".to_string());
    }

    if start < end {
        document
            .content
            .delete_range(start, end)
            .map_err(|e| format!("Failed to delete text: {:?}", e))?;
    }

    if !text.is_empty() {
        document
            .content
            .insert_str(start, text)
            .map_err(|e| format!("Failed to insert text: {:?}", e))?;
    }

    document.updated_at = LwwRegister::new(timestamp);
    Ok(())
}

fn replace_document_content_from_snapshot(
    document: &mut Document,
    html: &str,
    timestamp: u64,
) -> Result<(), String> {
    document.content = rga_from_html(html)?;
    document.updated_at = LwwRegister::new(timestamp);
    Ok(())
}

fn validate_blob_upload_target(_name: &str, _mime_type: &str) -> Result<(), String> {
    Ok(())
}

#[app::logic]
impl DocsApp {
    #[app::init]
    pub fn init() -> DocsApp {
        let owner_id = env::executor_id();
        let owner = encode_identity(&owner_id);
        app::log!("Initializing Mero Drive app for owner: {}", owner);
        app::log!(
            "Docs storage layout v{} active. {}",
            STORAGE_LAYOUT_VERSION,
            STORAGE_LAYOUT_MIGRATION_STRATEGY
        );

        DocsApp {
            owner: owner.into(),
            documents: UnorderedMap::new(),
            folders: UnorderedMap::new(),
            files: UnorderedMap::new(),
            doc_counter: Counter::new(),
            folder_counter: Counter::new(),
            file_counter: Counter::new(),
            context_name: String::new().into(),
            folder_registry: UnorderedMap::new(),
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
            let folder_exists = self
                .folders
                .get(fid)
                .map_err(|e| format!("Failed to check folder: {:?}", e))?
                .is_some();
            if !folder_exists {
                return Err(format!("Folder not found: {}", fid));
            }
        }

        let counter_value = self
            .doc_counter
            .value()
            .map_err(|e| format!("Failed to get counter: {:?}", e))?;
        self.doc_counter
            .increment()
            .map_err(|e| format!("Failed to increment counter: {:?}", e))?;

        let doc_id = generate_doc_id(counter_value);
        let author_id = env::executor_id();
        let author = encode_identity(&author_id);
        let timestamp = env::time_now();
        let document = create_document_record(
            doc_id.clone(),
            title.clone(),
            content,
            tags,
            folder_id,
            author.clone(),
            timestamp,
        )?;

        self.documents
            .insert(doc_id.clone(), document)
            .map_err(|e| format!("Failed to store document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentCreated {
            id: doc_id.clone(),
            title: title.clone(),
            author,
        });

        app::log!("Document created: {} (ID: {})", title, doc_id);
        Ok(doc_id)
    }

    /// Compatibility snapshot API that reseeds the document's RGA from an HTML snapshot.
    pub fn set_content(&mut self, doc_id: String, content: String) -> Result<(), String> {
        let mut document = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);
        let timestamp = env::time_now();
        replace_document_content_from_snapshot(&mut document, &content, timestamp)?;

        let doc_title = document.title.get().clone();

        self.documents
            .insert(doc_id.clone(), document)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentUpdated {
            id: doc_id.clone(),
            title: doc_title,
            editor,
        });

        app::log!("HTML content updated for document {}", doc_id);
        Ok(())
    }

    /// Low-level RGA edit on stored HTML string positions.
    /// This can split tags or attributes, so the TipTap flow should prefer `set_content`.
    pub fn insert_text(
        &mut self,
        doc_id: String,
        position: usize,
        text: String,
    ) -> Result<(), String> {
        let mut document = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);
        let timestamp = env::time_now();

        apply_insert_text(&mut document, position, &text, timestamp)?;

        let doc_title = document.title.get().clone();

        self.documents
            .insert(doc_id.clone(), document)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentUpdated {
            id: doc_id.clone(),
            title: doc_title,
            editor,
        });

        app::log!("Inserted text into HTML document {}", doc_id);
        Ok(())
    }

    /// Low-level RGA delete on stored HTML string positions.
    /// This can split tags or attributes, so the TipTap flow should prefer `set_content`.
    pub fn delete_text(&mut self, doc_id: String, start: usize, end: usize) -> Result<(), String> {
        let mut document = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);
        let timestamp = env::time_now();

        apply_delete_text(&mut document, start, end, timestamp)?;

        let doc_title = document.title.get().clone();

        self.documents
            .insert(doc_id.clone(), document)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentUpdated {
            id: doc_id.clone(),
            title: doc_title,
            editor,
        });

        app::log!("Deleted text from HTML document {}", doc_id);
        Ok(())
    }

    /// Low-level RGA replace on stored HTML string positions.
    /// This can split tags or attributes, so the TipTap flow should prefer `set_content`.
    pub fn replace_text(
        &mut self,
        doc_id: String,
        start: usize,
        end: usize,
        text: String,
    ) -> Result<(), String> {
        let mut document = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);
        let timestamp = env::time_now();

        apply_replace_text(&mut document, start, end, &text, timestamp)?;

        let doc_title = document.title.get().clone();

        self.documents
            .insert(doc_id.clone(), document)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentUpdated {
            id: doc_id.clone(),
            title: doc_title,
            editor,
        });

        app::log!("Replaced text in HTML document {}", doc_id);
        Ok(())
    }

    /// Update metadata using pure insert() - no remove() first
    pub fn update_document_metadata(
        &mut self,
        doc_id: String,
        title: Option<String>,
        archived: Option<bool>,
    ) -> Result<(), String> {
        let old_doc = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);
        let timestamp = env::time_now();

        let new_title = title
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| old_doc.title.get().clone());
        let new_archived = archived.unwrap_or_else(|| *old_doc.archived.get());

        let Document {
            id,
            content,
            author,
            created_at,
            tags,
            folder_id,
            ..
        } = old_doc;

        let new_doc = Document {
            id,
            title: LwwRegister::new(new_title.clone()),
            content,
            author,
            created_at,
            updated_at: LwwRegister::new(timestamp),
            tags,
            archived: LwwRegister::new(new_archived),
            folder_id,
        };

        self.documents
            .insert(doc_id.clone(), new_doc)
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
        let old_doc = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let timestamp = env::time_now();

        let Document {
            id,
            title,
            content,
            author,
            created_at,
            mut tags,
            archived,
            folder_id,
            ..
        } = old_doc;

        let _ = tags
            .insert(tag.clone())
            .map_err(|e| format!("Failed to add tag: {:?}", e))?;

        let new_doc = Document {
            id,
            title,
            content,
            author,
            created_at,
            updated_at: LwwRegister::new(timestamp),
            tags,
            archived,
            folder_id,
        };

        self.documents
            .insert(doc_id.clone(), new_doc)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::log!("Tag '{}' added to document {}", tag, doc_id);
        Ok(())
    }

    pub fn set_tags(&mut self, doc_id: String, tags: Vec<String>) -> Result<(), String> {
        let old_doc = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let timestamp = env::time_now();

        let Document {
            id,
            title,
            content,
            author,
            created_at,
            archived,
            folder_id,
            ..
        } = old_doc;

        let mut new_tags = UnorderedSet::new();
        for tag in tags {
            if !tag.is_empty() {
                new_tags
                    .insert(tag)
                    .map_err(|e| format!("Failed to add tag: {:?}", e))?;
            }
        }

        let new_doc = Document {
            id,
            title,
            content,
            author,
            created_at,
            updated_at: LwwRegister::new(timestamp),
            tags: new_tags,
            archived,
            folder_id,
        };

        self.documents
            .insert(doc_id.clone(), new_doc)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::log!("Tags updated for document {}", doc_id);
        Ok(())
    }

    pub fn delete_document(&mut self, doc_id: String) -> Result<(), String> {
        let doc = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let title = doc.title.get().clone();

        self.documents
            .remove(&doc_id)
            .map_err(|e| format!("Failed to delete document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentDeleted {
            id: doc_id.clone(),
            title: title.clone(),
        });

        app::log!("Document deleted: {} (ID: {})", title, doc_id);
        Ok(())
    }

    pub fn set_archived(&mut self, doc_id: String, archived: bool) -> Result<(), String> {
        let old_doc = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let timestamp = env::time_now();

        let Document {
            id,
            title,
            content,
            author,
            created_at,
            tags,
            folder_id,
            ..
        } = old_doc;

        let new_doc = Document {
            id,
            title,
            content,
            author,
            created_at,
            updated_at: LwwRegister::new(timestamp),
            tags,
            archived: LwwRegister::new(archived),
            folder_id,
        };

        self.documents
            .insert(doc_id.clone(), new_doc)
            .map_err(|e| format!("Failed to save document: {:?}", e))?;

        app::emit!(DocsEvent::DocumentArchived {
            id: doc_id.clone(),
            archived,
        });

        app::log!(
            "Document {} archive status: {}",
            doc_id,
            if archived { "archived" } else { "unarchived" }
        );
        Ok(())
    }

    pub fn get_document(&self, doc_id: String) -> Result<DocumentResponse, String> {
        let doc = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;
        document_response_from_document(&doc)
    }

    pub fn get_content(&self, doc_id: String) -> Result<String, String> {
        let doc = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;
        html_from_rga(&doc.content)
    }

    pub fn get_content_length(&self, doc_id: String) -> Result<usize, String> {
        let doc = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;
        document_content_len(&doc)
    }

    pub fn list_documents(&self, include_archived: bool) -> Result<Vec<DocumentSummary>, String> {
        let mut documents = Vec::new();

        let entries = self
            .documents
            .entries()
            .map_err(|e| format!("Failed to list documents: {:?}", e))?;

        for (_, doc) in entries {
            let archived = *doc.archived.get();
            if include_archived || !archived {
                documents.push(document_summary_from_document(&doc)?);
            }
        }

        documents.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        app::log!("Listed {} documents", documents.len());
        Ok(documents)
    }

    pub fn search_documents(
        &self,
        query: String,
        include_archived: bool,
    ) -> Result<Vec<DocumentSummary>, String> {
        let mut results = Vec::new();
        let query_lower = query.to_lowercase();

        let entries = self
            .documents
            .entries()
            .map_err(|e| format!("Failed to search documents: {:?}", e))?;

        for (_, doc) in entries {
            if !include_archived && *doc.archived.get() {
                continue;
            }

            let content = html_from_rga(&doc.content)?;
            let title_match = doc.title.get().to_lowercase().contains(&query_lower);
            let content_match = visible_text_matches_query(&content, &query_lower);
            let tags = extract_tags(&doc.tags)?;
            let tags_match = tags
                .iter()
                .any(|tag| tag.to_lowercase().contains(&query_lower));

            if title_match || content_match || tags_match {
                results.push(document_summary_from_document(&doc)?);
            }
        }

        results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        app::log!("Search for '{}' found {} results", query, results.len());
        Ok(results)
    }

    pub fn get_documents_by_tag(
        &self,
        tag: String,
        include_archived: bool,
    ) -> Result<Vec<DocumentSummary>, String> {
        let mut results = Vec::new();
        let tag_lower = tag.to_lowercase();

        let entries = self
            .documents
            .entries()
            .map_err(|e| format!("Failed to filter documents: {:?}", e))?;

        for (_, doc) in entries {
            if !include_archived && *doc.archived.get() {
                continue;
            }

            let tags = extract_tags(&doc.tags)?;
            let has_tag = tags.iter().any(|t| t.to_lowercase() == tag_lower);

            if has_tag {
                results.push(document_summary_from_document(&doc)?);
            }
        }

        results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        app::log!("Filter by tag '{}' found {} results", tag, results.len());
        Ok(results)
    }

    pub fn get_all_tags(&self) -> Result<Vec<String>, String> {
        let mut tags_set = std::collections::BTreeSet::new();

        let entries = self
            .documents
            .entries()
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

        let entries = self
            .documents
            .entries()
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
            "Mero Drive Statistics:\n\
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
        self.documents
            .len()
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
            let parent_exists = self
                .folders
                .get(pid)
                .map_err(|e| format!("Failed to check parent folder: {:?}", e))?
                .is_some();
            if !parent_exists {
                return Err(format!("Parent folder not found: {}", pid));
            }
        }

        let counter_value = self
            .folder_counter
            .value()
            .map_err(|e| format!("Failed to get folder counter: {:?}", e))?;
        self.folder_counter
            .increment()
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

        self.folders
            .insert(folder_id.clone(), folder)
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

        let old_folder = self
            .folders
            .get(&folder_id)
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

        self.folders
            .insert(folder_id.clone(), new_folder)
            .map_err(|e| format!("Failed to save folder: {:?}", e))?;

        app::emit!(DocsEvent::FolderUpdated {
            id: folder_id.clone(),
            name: name.clone(),
        });

        app::log!("Folder renamed: {} (ID: {})", name, folder_id);
        Ok(())
    }

    /// Update folder color
    pub fn set_folder_color(
        &mut self,
        folder_id: String,
        color: Option<String>,
    ) -> Result<(), String> {
        let old_folder = self
            .folders
            .get(&folder_id)
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

        self.folders
            .insert(folder_id.clone(), new_folder)
            .map_err(|e| format!("Failed to save folder: {:?}", e))?;

        app::log!("Folder color updated (ID: {})", folder_id);
        Ok(())
    }

    /// Move a folder to a new parent (or root if parent_id is None)
    pub fn move_folder(
        &mut self,
        folder_id: String,
        new_parent_id: Option<String>,
    ) -> Result<(), String> {
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
                let parent = self
                    .folders
                    .get(&cid)
                    .map_err(|e| format!("Failed to check folder hierarchy: {:?}", e))?;
                current_id = parent.and_then(|f| f.parent_id.get().clone());
            }
        }

        let old_folder = self
            .folders
            .get(&folder_id)
            .map_err(|e| format!("Failed to access folder: {:?}", e))?
            .ok_or_else(|| format!("Folder not found: {}", folder_id))?;

        let from_parent = old_folder.parent_id.get().clone();

        // Verify new parent exists if specified
        if let Some(ref pid) = new_parent_id {
            let parent_exists = self
                .folders
                .get(pid)
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

        self.folders
            .insert(folder_id.clone(), new_folder)
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
        let folder = self
            .folders
            .get(&folder_id)
            .map_err(|e| format!("Failed to access folder: {:?}", e))?
            .ok_or_else(|| format!("Folder not found: {}", folder_id))?;

        let folder_name = folder.name.get().clone();

        // Check for subfolders
        let subfolder_ids: Vec<String> = self
            .folders
            .entries()
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
        let doc_ids: Vec<String> = self
            .documents
            .entries()
            .map_err(|e| format!("Failed to list documents: {:?}", e))?
            .filter_map(|(id, d)| {
                if d.folder_id.get().as_ref() == Some(&folder_id) {
                    Some(id)
                } else {
                    None
                }
            })
            .collect();

        // Check for files in folder
        let file_ids: Vec<String> = self
            .files
            .entries()
            .map_err(|e| format!("Failed to list files: {:?}", e))?
            .filter_map(|(id, f)| {
                if f.folder_id.get().as_ref() == Some(&folder_id) {
                    Some(id)
                } else {
                    None
                }
            })
            .collect();

        if !recursive && (!subfolder_ids.is_empty() || !doc_ids.is_empty() || !file_ids.is_empty())
        {
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

        // Move files to root
        for fid in file_ids {
            self.move_file(fid, None)?;
        }

        // Delete the folder
        self.folders
            .remove(&folder_id)
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
        let folder = self
            .folders
            .get(&folder_id)
            .map_err(|e| format!("Failed to access folder: {:?}", e))?
            .ok_or_else(|| format!("Folder not found: {}", folder_id))?;

        // Count documents in folder
        let document_count = self
            .documents
            .entries()
            .map_err(|e| format!("Failed to count documents: {:?}", e))?
            .filter(|(_, d)| d.folder_id.get().as_ref() == Some(&folder_id))
            .count();

        // Count subfolders
        let subfolder_count = self
            .folders
            .entries()
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

        let entries = self
            .folders
            .entries()
            .map_err(|e| format!("Failed to list folders: {:?}", e))?;

        for (folder_id, folder) in entries {
            // Count documents in folder
            let document_count = self
                .documents
                .entries()
                .map_err(|e| format!("Failed to count documents: {:?}", e))?
                .filter(|(_, d)| d.folder_id.get().as_ref() == Some(&folder_id))
                .count();

            // Count subfolders
            let subfolder_count = self
                .folders
                .entries()
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
        let all_folders: Vec<_> = self
            .folders
            .entries()
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
                    let document_count = documents
                        .entries()
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

        let entries = self
            .documents
            .entries()
            .map_err(|e| format!("Failed to list documents: {:?}", e))?;

        for (_, doc) in entries {
            let archived = *doc.archived.get();
            if !include_archived && archived {
                continue;
            }

            let doc_folder = doc.folder_id.get();
            let matches = match (&folder_id, doc_folder.as_ref()) {
                (None, None) => true,                   // Both root
                (Some(fid), Some(dfid)) => fid == dfid, // Same folder
                _ => false,
            };

            if matches {
                documents.push(document_summary_from_document(&doc)?);
            }
        }

        documents.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        app::log!("Found {} documents in folder", documents.len());
        Ok(documents)
    }

    /// Move a document to a different folder
    pub fn move_document(
        &mut self,
        doc_id: String,
        folder_id: Option<String>,
    ) -> Result<(), String> {
        let old_doc = self
            .documents
            .get(&doc_id)
            .map_err(|e| format!("Failed to access document: {:?}", e))?
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;

        let from_folder = old_doc.folder_id.get().clone();

        // Verify new folder exists if specified
        if let Some(ref fid) = folder_id {
            let folder_exists = self
                .folders
                .get(fid)
                .map_err(|e| format!("Failed to check folder: {:?}", e))?
                .is_some();
            if !folder_exists {
                return Err(format!("Folder not found: {}", fid));
            }
        }

        let timestamp = env::time_now();
        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);

        let Document {
            id,
            title,
            content,
            author,
            created_at,
            tags,
            archived,
            ..
        } = old_doc;

        let new_doc = Document {
            id,
            title,
            content,
            author,
            created_at,
            updated_at: LwwRegister::new(timestamp),
            tags,
            archived,
            folder_id: LwwRegister::new(folder_id.clone()),
        };

        self.documents
            .insert(doc_id.clone(), new_doc)
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
        self.folders
            .len()
            .map_err(|e| format!("Failed to get folder count: {:?}", e))
    }

    /// Set the display name for this context (workspace)
    pub fn set_context_name(&mut self, name: String) -> Result<(), String> {
        if name.is_empty() {
            return Err("Context name cannot be empty".to_string());
        }
        self.context_name = name.clone().into();
        app::emit!(DocsEvent::ContextNameSet { name });
        Ok(())
    }

    /// Get the display name for this context
    pub fn get_context_name(&self) -> Result<String, String> {
        Ok(self.context_name.get().clone())
    }

    /// Register a folder in the General context's folder registry
    pub fn register_folder(
        &mut self,
        context_id: String,
        name: String,
        color: Option<String>,
    ) -> Result<(), String> {
        if context_id.is_empty() {
            return Err("context_id cannot be empty".to_string());
        }
        if name.is_empty() {
            return Err("Folder name cannot be empty".to_string());
        }
        if self
            .folder_registry
            .get(&context_id)
            .map_err(|e| format!("Failed to check registry: {:?}", e))?
            .is_some()
        {
            return Err(format!("Folder already registered: {}", context_id));
        }
        let now = env::time_now();
        let meta = FolderMeta {
            context_id: context_id.clone().into(),
            name: name.clone().into(),
            color: color.into(),
            created_at: now.into(),
        };
        self.folder_registry
            .insert(context_id.clone(), meta)
            .map_err(|e| format!("Failed to register folder: {:?}", e))?;
        app::emit!(DocsEvent::FolderRegistered { context_id, name });
        Ok(())
    }

    /// Update the display name of a registered folder
    pub fn update_folder_name(&mut self, context_id: String, name: String) -> Result<(), String> {
        if name.is_empty() {
            return Err("Folder name cannot be empty".to_string());
        }
        let existing = self
            .folder_registry
            .get(&context_id)
            .map_err(|e| format!("Failed to access registry: {:?}", e))?
            .ok_or_else(|| format!("Folder not found in registry: {}", context_id))?;
        let updated = FolderMeta {
            context_id: existing.context_id.clone(),
            name: name.clone().into(),
            color: existing.color.clone(),
            created_at: existing.created_at.clone(),
        };
        self.folder_registry
            .insert(context_id.clone(), updated)
            .map_err(|e| format!("Failed to update registry: {:?}", e))?;
        app::emit!(DocsEvent::FolderNameUpdated { context_id, name });
        Ok(())
    }

    /// Remove a folder from the registry
    pub fn unregister_folder(&mut self, context_id: String) -> Result<(), String> {
        self.folder_registry
            .get(&context_id)
            .map_err(|e| format!("Failed to access registry: {:?}", e))?
            .ok_or_else(|| format!("Folder not found in registry: {}", context_id))?;
        self.folder_registry
            .remove(&context_id)
            .map_err(|e| format!("Failed to remove from registry: {:?}", e))?;
        app::emit!(DocsEvent::FolderUnregistered { context_id });
        Ok(())
    }

    /// Get all registered folders sorted alphabetically by name
    pub fn get_folder_registry(&self) -> Result<Vec<FolderRegistryEntry>, String> {
        let entries = self
            .folder_registry
            .entries()
            .map_err(|e| format!("Failed to read registry: {:?}", e))?;
        let mut result: Vec<FolderRegistryEntry> = Vec::new();
        for (_, meta) in entries {
            result.push(FolderRegistryEntry {
                context_id: meta.context_id.get().clone(),
                name: meta.name.get().clone(),
                color: meta.color.get().clone(),
                created_at: *meta.created_at.get(),
            });
        }
        result.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(result)
    }

    // ========== FILE METHODS ==========

    /// Create a new file entry after blob upload completes
    pub fn create_file(
        &mut self,
        name: String,
        blob_id: String,
        mime_type: String,
        size: u64,
        folder_id: Option<String>,
    ) -> Result<String, String> {
        if name.trim().is_empty() {
            return Err("File name cannot be empty".to_string());
        }
        if blob_id.trim().is_empty() {
            return Err("Blob ID cannot be empty".to_string());
        }
        validate_blob_upload_target(&name, &mime_type)?;

        if let Some(ref fid) = folder_id {
            let exists = self
                .folders
                .get(fid)
                .map_err(|e| format!("Failed to check folder: {:?}", e))?
                .is_some();
            if !exists {
                return Err(format!("Folder not found: {}", fid));
            }
        }

        let counter_value = self
            .file_counter
            .value()
            .map_err(|e| format!("Failed to get file counter: {:?}", e))?;
        self.file_counter
            .increment()
            .map_err(|e| format!("Failed to increment file counter: {:?}", e))?;

        let file_id = generate_file_id(counter_value);
        let uploader_id = env::executor_id();
        let uploaded_by = encode_identity(&uploader_id);
        let timestamp = env::time_now();

        let file = FileEntry {
            id: LwwRegister::new(file_id.clone()),
            name: LwwRegister::new(name.clone()),
            blob_id: LwwRegister::new(blob_id),
            mime_type: LwwRegister::new(mime_type),
            size: LwwRegister::new(size),
            folder_id: LwwRegister::new(folder_id),
            created_at: LwwRegister::new(timestamp),
            updated_at: LwwRegister::new(timestamp),
            uploaded_by: LwwRegister::new(uploaded_by.clone()),
        };

        self.files
            .insert(file_id.clone(), file)
            .map_err(|e| format!("Failed to store file: {:?}", e))?;

        app::emit!(DocsEvent::FileCreated {
            id: file_id.clone(),
            name: name.clone(),
            uploaded_by,
        });

        app::log!("File created: {} (ID: {})", name, file_id);
        Ok(file_id)
    }

    /// Get a single file by ID
    pub fn get_file(&self, file_id: String) -> Result<FileEntryResponse, String> {
        let file = self
            .files
            .get(&file_id)
            .map_err(|e| format!("Failed to access file: {:?}", e))?
            .ok_or_else(|| format!("File not found: {}", file_id))?;

        Ok(FileEntryResponse {
            id: file.id.get().clone(),
            name: file.name.get().clone(),
            blob_id: file.blob_id.get().clone(),
            mime_type: file.mime_type.get().clone(),
            size: *file.size.get(),
            folder_id: file.folder_id.get().clone(),
            created_at: *file.created_at.get(),
            updated_at: *file.updated_at.get(),
            uploaded_by: file.uploaded_by.get().clone(),
        })
    }

    /// List all files, sorted by most recently updated
    pub fn list_files(&self) -> Result<Vec<FileEntryResponse>, String> {
        let mut files = Vec::new();

        let entries = self
            .files
            .entries()
            .map_err(|e| format!("Failed to list files: {:?}", e))?;

        for (_, file) in entries {
            files.push(FileEntryResponse {
                id: file.id.get().clone(),
                name: file.name.get().clone(),
                blob_id: file.blob_id.get().clone(),
                mime_type: file.mime_type.get().clone(),
                size: *file.size.get(),
                folder_id: file.folder_id.get().clone(),
                created_at: *file.created_at.get(),
                updated_at: *file.updated_at.get(),
                uploaded_by: file.uploaded_by.get().clone(),
            });
        }

        files.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        app::log!("Listed {} files", files.len());
        Ok(files)
    }

    /// List files in a specific folder (or root if folder_id is None)
    pub fn list_files_in_folder(
        &self,
        folder_id: Option<String>,
    ) -> Result<Vec<FileEntryResponse>, String> {
        let mut files = Vec::new();

        let entries = self
            .files
            .entries()
            .map_err(|e| format!("Failed to list files: {:?}", e))?;

        for (_, file) in entries {
            let file_folder = file.folder_id.get();
            let matches = match (&folder_id, file_folder.as_ref()) {
                (None, None) => true,
                (Some(fid), Some(ffid)) => fid == ffid,
                _ => false,
            };

            if matches {
                files.push(FileEntryResponse {
                    id: file.id.get().clone(),
                    name: file.name.get().clone(),
                    blob_id: file.blob_id.get().clone(),
                    mime_type: file.mime_type.get().clone(),
                    size: *file.size.get(),
                    folder_id: file.folder_id.get().clone(),
                    created_at: *file.created_at.get(),
                    updated_at: *file.updated_at.get(),
                    uploaded_by: file.uploaded_by.get().clone(),
                });
            }
        }

        files.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        app::log!("Found {} files in folder", files.len());
        Ok(files)
    }

    /// Delete a file entry (does not remove the blob itself)
    pub fn delete_file(&mut self, file_id: String) -> Result<(), String> {
        let file = self
            .files
            .get(&file_id)
            .map_err(|e| format!("Failed to access file: {:?}", e))?
            .ok_or_else(|| format!("File not found: {}", file_id))?;

        let name = file.name.get().clone();

        self.files
            .remove(&file_id)
            .map_err(|e| format!("Failed to delete file: {:?}", e))?;

        app::emit!(DocsEvent::FileDeleted {
            id: file_id.clone(),
            name: name.clone(),
        });

        app::log!("File deleted: {} (ID: {})", name, file_id);
        Ok(())
    }

    /// Move a file to a different folder (or root if folder_id is None)
    pub fn move_file(&mut self, file_id: String, folder_id: Option<String>) -> Result<(), String> {
        let old_file = self
            .files
            .get(&file_id)
            .map_err(|e| format!("Failed to access file: {:?}", e))?
            .ok_or_else(|| format!("File not found: {}", file_id))?;

        let from_folder = old_file.folder_id.get().clone();

        if let Some(ref fid) = folder_id {
            let exists = self
                .folders
                .get(fid)
                .map_err(|e| format!("Failed to check folder: {:?}", e))?
                .is_some();
            if !exists {
                return Err(format!("Folder not found: {}", fid));
            }
        }

        let timestamp = env::time_now();

        let new_file = FileEntry {
            id: LwwRegister::new(old_file.id.get().clone()),
            name: LwwRegister::new(old_file.name.get().clone()),
            blob_id: LwwRegister::new(old_file.blob_id.get().clone()),
            mime_type: LwwRegister::new(old_file.mime_type.get().clone()),
            size: LwwRegister::new(*old_file.size.get()),
            folder_id: LwwRegister::new(folder_id.clone()),
            created_at: LwwRegister::new(*old_file.created_at.get()),
            updated_at: LwwRegister::new(timestamp),
            uploaded_by: LwwRegister::new(old_file.uploaded_by.get().clone()),
        };

        self.files
            .insert(file_id.clone(), new_file)
            .map_err(|e| format!("Failed to save file: {:?}", e))?;

        app::emit!(DocsEvent::FileMoved {
            id: file_id.clone(),
            from_folder,
            to_folder: folder_id,
        });

        app::log!("File moved (ID: {})", file_id);
        Ok(())
    }

    /// Get the total number of files
    pub fn get_file_count(&self) -> Result<usize, String> {
        self.files
            .len()
            .map_err(|e| format!("Failed to get file count: {:?}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_file_id() {
        assert_eq!(generate_file_id(0), "file_0");
        assert_eq!(generate_file_id(1), "file_1");
        assert_eq!(generate_file_id(999), "file_999");
    }

    #[test]
    fn test_generate_doc_id() {
        assert_eq!(generate_doc_id(0), "doc_0");
        assert_eq!(generate_doc_id(5), "doc_5");
    }

    #[test]
    fn test_generate_folder_id() {
        assert_eq!(generate_folder_id(0), "folder_0");
        assert_eq!(generate_folder_id(3), "folder_3");
    }

    #[test]
    fn test_encode_identity() {
        let id: [u8; IDENTITY_SIZE] = [0u8; IDENTITY_SIZE];
        let encoded = encode_identity(&id);
        assert!(!encoded.is_empty());
        assert_eq!(encoded, bs58::encode([0u8; 32]).into_string());
    }

    #[test]
    fn test_file_entry_response_fields() {
        let resp = FileEntryResponse {
            id: "file_0".to_string(),
            name: "photo.jpg".to_string(),
            blob_id: "blob_abc123".to_string(),
            mime_type: "image/jpeg".to_string(),
            size: 1024,
            folder_id: None,
            created_at: 100,
            updated_at: 100,
            uploaded_by: "alice".to_string(),
        };
        assert_eq!(resp.id, "file_0");
        assert_eq!(resp.name, "photo.jpg");
        assert_eq!(resp.blob_id, "blob_abc123");
        assert_eq!(resp.mime_type, "image/jpeg");
        assert_eq!(resp.size, 1024);
        assert!(resp.folder_id.is_none());
    }

    #[test]
    fn test_file_entry_response_with_folder() {
        let resp = FileEntryResponse {
            id: "file_1".to_string(),
            name: "report.pdf".to_string(),
            blob_id: "blob_def456".to_string(),
            mime_type: "application/pdf".to_string(),
            size: 2048,
            folder_id: Some("folder_0".to_string()),
            created_at: 200,
            updated_at: 300,
            uploaded_by: "bob".to_string(),
        };
        assert_eq!(resp.folder_id, Some("folder_0".to_string()));
        assert_eq!(resp.uploaded_by, "bob");
        assert!(resp.updated_at > resp.created_at);
    }

    #[test]
    fn test_file_entry_response_sorting() {
        let mut files = vec![
            FileEntryResponse {
                id: "file_0".to_string(),
                name: "old.txt".to_string(),
                blob_id: "b1".to_string(),
                mime_type: "text/plain".to_string(),
                size: 10,
                folder_id: None,
                created_at: 100,
                updated_at: 100,
                uploaded_by: "u".to_string(),
            },
            FileEntryResponse {
                id: "file_1".to_string(),
                name: "new.txt".to_string(),
                blob_id: "b2".to_string(),
                mime_type: "text/plain".to_string(),
                size: 20,
                folder_id: None,
                created_at: 200,
                updated_at: 200,
                uploaded_by: "u".to_string(),
            },
        ];

        files.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        assert_eq!(files[0].id, "file_1");
        assert_eq!(files[1].id, "file_0");
    }

    #[test]
    fn test_file_entry_response_folder_matching() {
        let files = vec![
            FileEntryResponse {
                id: "file_0".to_string(),
                name: "root.txt".to_string(),
                blob_id: "b1".to_string(),
                mime_type: "text/plain".to_string(),
                size: 10,
                folder_id: None,
                created_at: 100,
                updated_at: 100,
                uploaded_by: "u".to_string(),
            },
            FileEntryResponse {
                id: "file_1".to_string(),
                name: "in_folder.txt".to_string(),
                blob_id: "b2".to_string(),
                mime_type: "text/plain".to_string(),
                size: 20,
                folder_id: Some("folder_0".to_string()),
                created_at: 200,
                updated_at: 200,
                uploaded_by: "u".to_string(),
            },
            FileEntryResponse {
                id: "file_2".to_string(),
                name: "also_in_folder.txt".to_string(),
                blob_id: "b3".to_string(),
                mime_type: "text/plain".to_string(),
                size: 30,
                folder_id: Some("folder_0".to_string()),
                created_at: 300,
                updated_at: 300,
                uploaded_by: "u".to_string(),
            },
        ];

        let target_folder = Some("folder_0".to_string());
        let in_folder: Vec<_> = files
            .iter()
            .filter(|f| match (&target_folder, f.folder_id.as_ref()) {
                (None, None) => true,
                (Some(fid), Some(ffid)) => fid == ffid,
                _ => false,
            })
            .collect();
        assert_eq!(in_folder.len(), 2);

        let at_root: Vec<_> = files.iter().filter(|f| f.folder_id.is_none()).collect();
        assert_eq!(at_root.len(), 1);
        assert_eq!(at_root[0].id, "file_0");
    }

    #[test]
    fn test_file_entry_crdt_construction() {
        let file = FileEntry {
            id: LwwRegister::new("file_0".to_string()),
            name: LwwRegister::new("test.png".to_string()),
            blob_id: LwwRegister::new("blob_xyz".to_string()),
            mime_type: LwwRegister::new("image/png".to_string()),
            size: LwwRegister::new(4096u64),
            folder_id: LwwRegister::new(Some("folder_0".to_string())),
            created_at: LwwRegister::new(1000u64),
            updated_at: LwwRegister::new(1000u64),
            uploaded_by: LwwRegister::new("uploader".to_string()),
        };

        assert_eq!(file.id.get(), "file_0");
        assert_eq!(file.name.get(), "test.png");
        assert_eq!(file.blob_id.get(), "blob_xyz");
        assert_eq!(file.mime_type.get(), "image/png");
        assert_eq!(*file.size.get(), 4096);
        assert_eq!(*file.folder_id.get(), Some("folder_0".to_string()));
        assert_eq!(*file.created_at.get(), 1000);
        assert_eq!(*file.updated_at.get(), 1000);
        assert_eq!(file.uploaded_by.get(), "uploader");
    }

    #[test]
    fn test_file_entry_merge() {
        let mut file_a = FileEntry {
            id: LwwRegister::new("file_0".to_string()),
            name: LwwRegister::new("original.txt".to_string()),
            blob_id: LwwRegister::new("blob_1".to_string()),
            mime_type: LwwRegister::new("text/plain".to_string()),
            size: LwwRegister::new(100u64),
            folder_id: LwwRegister::new(None),
            created_at: LwwRegister::new(1000u64),
            updated_at: LwwRegister::new(1000u64),
            uploaded_by: LwwRegister::new("alice".to_string()),
        };

        let file_b = FileEntry {
            id: LwwRegister::new("file_0".to_string()),
            name: LwwRegister::new("renamed.txt".to_string()),
            blob_id: LwwRegister::new("blob_1".to_string()),
            mime_type: LwwRegister::new("text/plain".to_string()),
            size: LwwRegister::new(100u64),
            folder_id: LwwRegister::new(Some("folder_1".to_string())),
            created_at: LwwRegister::new(1000u64),
            updated_at: LwwRegister::new(2000u64),
            uploaded_by: LwwRegister::new("alice".to_string()),
        };

        file_a.merge(&file_b).expect("merge should succeed");
    }

    #[test]
    fn test_rga_html_helpers_round_trip() {
        let html = "<h1>Heading</h1><p><strong>Item</strong> body</p>";

        let rga = rga_from_html(html).expect("HTML should seed an RGA");

        assert_eq!(
            html_from_rga(&rga).expect("RGA should serialize back to HTML"),
            html
        );
    }

    #[test]
    fn test_document_content_round_trips_through_rga() {
        let document = Document {
            id: LwwRegister::new("doc_0".to_string()),
            title: LwwRegister::new("Doc".to_string()),
            content: rga_from_html("<p>Hello</p><p>World</p>")
                .expect("document body should use RGA"),
            author: LwwRegister::new("author".to_string()),
            created_at: LwwRegister::new(1),
            updated_at: LwwRegister::new(1),
            tags: UnorderedSet::new(),
            archived: LwwRegister::new(false),
            folder_id: LwwRegister::new(None),
        };

        assert_eq!(
            html_from_rga(&document.content).expect("document content should read as HTML"),
            "<p>Hello</p><p>World</p>"
        );
    }

    #[test]
    fn test_document_rebuild_preserves_rga_body() {
        let content =
            rga_from_html("<p>Alpha</p><p>Beta</p>").expect("document body should use RGA");
        let original_html = html_from_rga(&content).expect("seeded RGA should serialize to HTML");

        let original = Document {
            id: LwwRegister::new("doc_1".to_string()),
            title: LwwRegister::new("Original".to_string()),
            content,
            author: LwwRegister::new("author".to_string()),
            created_at: LwwRegister::new(10),
            updated_at: LwwRegister::new(10),
            tags: UnorderedSet::new(),
            archived: LwwRegister::new(false),
            folder_id: LwwRegister::new(Some("folder_0".to_string())),
        };

        let updated = Document {
            id: original.id,
            title: LwwRegister::new("Renamed".to_string()),
            content: original.content,
            author: original.author,
            created_at: original.created_at,
            updated_at: LwwRegister::new(11),
            tags: original.tags,
            archived: original.archived,
            folder_id: original.folder_id,
        };

        assert_eq!(
            html_from_rga(&updated.content).expect("rebuilt document should preserve RGA body"),
            original_html
        );
    }

    #[test]
    fn test_document_response_derives_html_content_from_rga() {
        let document = Document {
            id: LwwRegister::new("doc_7".to_string()),
            title: LwwRegister::new("Rendered".to_string()),
            content: rga_from_html("<h1>Hello</h1><p>world</p>")
                .expect("document body should use RGA"),
            author: LwwRegister::new("author".to_string()),
            created_at: LwwRegister::new(10),
            updated_at: LwwRegister::new(20),
            tags: UnorderedSet::new(),
            archived: LwwRegister::new(false),
            folder_id: LwwRegister::new(Some("folder_1".to_string())),
        };

        let response =
            document_response_from_document(&document).expect("document response should serialize");

        assert_eq!(response.id, "doc_7");
        assert_eq!(response.title, "Rendered");
        assert_eq!(response.content, "<h1>Hello</h1><p>world</p>");
        assert_eq!(response.folder_id, Some("folder_1".to_string()));
    }

    #[test]
    fn test_create_document_record_seeds_html_rga_and_preserves_metadata() {
        let document = create_document_record(
            "doc_9".to_string(),
            "Seeded".to_string(),
            "<p>alpha</p><p>beta</p>".to_string(),
            vec!["rust".to_string(), "notes".to_string()],
            Some("folder_2".to_string()),
            "author".to_string(),
            77,
        )
        .expect("document should be built from HTML");

        assert_eq!(
            html_from_rga(&document.content).expect("seeded body should serialize"),
            "<p>alpha</p><p>beta</p>"
        );
        assert_eq!(document.title.get(), "Seeded");
        assert_eq!(document.author.get(), "author");
        assert_eq!(*document.created_at.get(), 77);
        assert_eq!(*document.updated_at.get(), 77);
        assert_eq!(document.folder_id.get(), &Some("folder_2".to_string()));

        let tags = extract_tags(&document.tags).expect("tags should be readable");
        assert_eq!(tags.len(), 2);
        assert!(tags.contains(&"rust".to_string()));
        assert!(tags.contains(&"notes".to_string()));
    }

    #[test]
    fn test_apply_insert_text_updates_html_and_timestamp() {
        let mut document = create_document_record(
            "doc_insert".to_string(),
            "Insert".to_string(),
            "<p>Hello world</p>".to_string(),
            Vec::new(),
            None,
            "author".to_string(),
            1,
        )
        .expect("document should be built");

        apply_insert_text(&mut document, 9, "brave ", 2).expect("insert should succeed");

        assert_eq!(
            html_from_rga(&document.content).expect("inserted content should serialize"),
            "<p>Hello brave world</p>"
        );
        assert_eq!(*document.updated_at.get(), 2);
    }

    #[test]
    fn test_apply_insert_text_rejects_out_of_bounds_position() {
        let mut document = create_document_record(
            "doc_insert_bounds".to_string(),
            "Insert".to_string(),
            "Hello".to_string(),
            Vec::new(),
            None,
            "author".to_string(),
            1,
        )
        .expect("document should be built");

        assert_eq!(
            apply_insert_text(&mut document, 99, "!", 2)
                .expect_err("out-of-bounds insert should be rejected"),
            "Insert position out of bounds"
        );
    }

    #[test]
    fn test_apply_delete_text_rejects_invalid_ranges() {
        let mut document = create_document_record(
            "doc_delete".to_string(),
            "Delete".to_string(),
            "Hello world".to_string(),
            Vec::new(),
            None,
            "author".to_string(),
            1,
        )
        .expect("document should be built");

        assert_eq!(
            apply_delete_text(&mut document, 8, 3, 2).expect_err("range should be rejected"),
            "Delete range start must be less than end"
        );
        assert_eq!(
            apply_delete_text(&mut document, 0, 50, 2).expect_err("out-of-bounds delete"),
            "Delete range out of bounds"
        );
    }

    #[test]
    fn test_apply_delete_text_removes_range_at_end() {
        let mut document = create_document_record(
            "doc_delete_end".to_string(),
            "Delete".to_string(),
            "Hello world".to_string(),
            Vec::new(),
            None,
            "author".to_string(),
            1,
        )
        .expect("document should be built");

        apply_delete_text(&mut document, 5, 11, 3).expect("delete should succeed");

        assert_eq!(
            html_from_rga(&document.content).expect("deleted content should serialize"),
            "Hello"
        );
        assert_eq!(*document.updated_at.get(), 3);
    }

    #[test]
    fn test_apply_replace_text_updates_html_snapshot() {
        let mut document = create_document_record(
            "doc_replace".to_string(),
            "Replace".to_string(),
            "<h1>Title</h1><p>Hello world</p>".to_string(),
            Vec::new(),
            None,
            "author".to_string(),
            1,
        )
        .expect("document should be built");

        apply_replace_text(
            &mut document,
            14,
            32,
            "<p>Updated list</p><ul><li>item</li></ul>",
            3,
        )
        .expect("replace should succeed");

        assert_eq!(
            html_from_rga(&document.content).expect("replaced content should serialize"),
            "<h1>Title</h1><p>Updated list</p><ul><li>item</li></ul>"
        );
        assert_eq!(*document.updated_at.get(), 3);
    }

    #[test]
    fn test_incremental_html_operations_can_split_markup() {
        let mut document = create_document_record(
            "doc_html_split".to_string(),
            "HTML".to_string(),
            "<p>Hello</p>".to_string(),
            Vec::new(),
            None,
            "author".to_string(),
            1,
        )
        .expect("document should be built");

        apply_insert_text(&mut document, 2, "!", 2)
            .expect("raw string insert should allow splitting HTML");

        assert_eq!(
            html_from_rga(&document.content).expect("content should serialize"),
            "<p!>Hello</p>"
        );
    }

    #[test]
    fn test_apply_replace_text_rejects_invalid_ranges_and_empty_noop() {
        let mut document = create_document_record(
            "doc_replace_invalid".to_string(),
            "Replace".to_string(),
            "Hello world".to_string(),
            Vec::new(),
            None,
            "author".to_string(),
            1,
        )
        .expect("document should be built");

        assert_eq!(
            apply_replace_text(&mut document, 8, 3, "!", 2)
                .expect_err("reversed range should be rejected"),
            "Replace range start must be less than or equal to end"
        );
        assert_eq!(
            apply_replace_text(&mut document, 0, 50, "!", 2)
                .expect_err("out-of-bounds replace should be rejected"),
            "Replace range out of bounds"
        );
        assert_eq!(
            apply_replace_text(&mut document, 4, 4, "", 2)
                .expect_err("empty no-op replace should be rejected"),
            "Replace operation cannot be empty"
        );
    }

    #[test]
    fn test_replace_document_content_from_snapshot_reseeds_html_rga() {
        let mut document = create_document_record(
            "doc_snapshot".to_string(),
            "Snapshot".to_string(),
            "<p>Alpha</p><p>Beta</p>".to_string(),
            Vec::new(),
            None,
            "author".to_string(),
            1,
        )
        .expect("document should be built");

        replace_document_content_from_snapshot(
            &mut document,
            "<h1>Heading</h1><p data-note=\"Gamma\">Gamma</p>",
            4,
        )
        .expect("snapshot update should reseed the content");

        assert_eq!(
            html_from_rga(&document.content).expect("snapshot content should serialize"),
            "<h1>Heading</h1><p data-note=\"Gamma\">Gamma</p>"
        );
        assert_eq!(*document.updated_at.get(), 4);
    }

    #[test]
    fn test_replace_document_content_from_snapshot_preserves_non_content_metadata() {
        let mut document = create_document_record(
            "doc_snapshot_meta".to_string(),
            "Snapshot".to_string(),
            "<p>Alpha</p>".to_string(),
            vec!["notes".to_string()],
            Some("folder_9".to_string()),
            "author".to_string(),
            1,
        )
        .expect("document should be built");

        replace_document_content_from_snapshot(&mut document, "<p>Beta</p>", 4)
            .expect("snapshot update should reseed the content");

        assert_eq!(
            html_from_rga(&document.content).expect("snapshot content should serialize"),
            "<p>Beta</p>"
        );
        assert_eq!(document.title.get(), "Snapshot");
        assert_eq!(document.author.get(), "author");
        assert_eq!(document.folder_id.get(), &Some("folder_9".to_string()));
        assert_eq!(extract_tags(&document.tags).expect("tags should be readable"), vec!["notes"]);
    }

    #[test]
    fn test_document_merge_preserves_concurrent_rga_edits() {
        let mut left = create_document_record(
            "doc_merge".to_string(),
            "Merge".to_string(),
            "AB".to_string(),
            Vec::new(),
            None,
            "author".to_string(),
            1,
        )
        .expect("left document should be built");
        let mut right = create_document_record(
            "doc_merge".to_string(),
            "Merge".to_string(),
            "AB".to_string(),
            Vec::new(),
            None,
            "author".to_string(),
            1,
        )
        .expect("right document should be built");

        apply_insert_text(&mut left, 1, "X", 2).expect("left edit should succeed");
        apply_insert_text(&mut right, 1, "Y", 2).expect("right edit should succeed");

        left.merge(&right).expect("merge should succeed");
        let merged = html_from_rga(&left.content).expect("merged content should serialize");

        assert_eq!(merged.len(), 6);
        assert!(merged.contains('X'));
        assert!(merged.contains('Y'));
    }

    #[test]
    fn test_metadata_only_rebuild_preserves_rga_body() {
        let original_body = "<h1>Title</h1><ul><li>alpha</li><li>beta</li></ul>";
        let original = create_document_record(
            "doc_metadata".to_string(),
            "Original".to_string(),
            original_body.to_string(),
            vec!["tag".to_string()],
            Some("folder_0".to_string()),
            "author".to_string(),
            10,
        )
        .expect("document should be built");

        let Document {
            id,
            content,
            author,
            created_at,
            tags,
            folder_id,
            ..
        } = original;

        let updated = Document {
            id,
            title: LwwRegister::new("Renamed".to_string()),
            content,
            author,
            created_at,
            updated_at: LwwRegister::new(11),
            tags,
            archived: LwwRegister::new(true),
            folder_id,
        };

        assert_eq!(
            html_from_rga(&updated.content).expect("metadata-only rebuild should preserve body"),
            original_body
        );
        assert_eq!(updated.title.get(), "Renamed");
        assert!(*updated.archived.get());
    }

    #[test]
    fn test_visible_text_from_html_strips_tags_attributes_and_normalizes_spacing() {
        assert_eq!(
            visible_text_from_html(
                "<h1 data-note=\"secret\">Heading</h1><p>Hello&nbsp;<strong>world</strong></p>"
            ),
            "Heading Hello world"
        );
    }

    #[test]
    fn test_preview_from_html_uses_visible_text_not_raw_tags() {
        assert_eq!(
            preview_from_html("<p>Hello <strong>world</strong></p>"),
            "Hello world"
        );
    }

    #[test]
    fn test_preview_from_html_truncates_visible_text_only() {
        let long_html = format!("<p>{}</p>", "a".repeat(DOCUMENT_PREVIEW_LIMIT + 10));
        assert!(
            preview_from_html(&long_html).ends_with("..."),
            "preview should be truncated after visible text extraction"
        );
        assert!(
            !preview_from_html(&long_html).contains('<'),
            "preview should not include raw HTML tags"
        );
    }

    #[test]
    fn test_search_uses_visible_text_not_raw_html_attributes() {
        let html = "<p data-hidden=\"secret-token\">Visible text only</p>";

        assert!(visible_text_matches_query(html, "visible"));
        assert!(!visible_text_matches_query(html, "secret-token"));
    }

    #[test]
    fn test_markdown_files_are_allowed_on_blob_upload_path() {
        assert!(
            validate_blob_upload_target("notes.md", "text/markdown").is_ok(),
            "markdown files should no longer be forced through a document import API"
        );
        assert!(
            validate_blob_upload_target("photo.png", "image/png").is_ok(),
            "non-markdown uploads should remain on the blob file path"
        );
    }

    #[test]
    fn test_storage_layout_migration_strategy_requires_fresh_state() {
        assert_eq!(STORAGE_LAYOUT_VERSION, 2);
        assert!(
            STORAGE_LAYOUT_MIGRATION_STRATEGY.contains("fresh app state"),
            "migration strategy should document the required reset"
        );
    }
}
