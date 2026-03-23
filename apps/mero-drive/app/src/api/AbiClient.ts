/**
 * AbiClient — typed frontend wrapper around the Mero Drive JSON-RPC app methods.
 *
 * The backend stores document bodies as HTML strings inside a
 * ReplicatedGrowableArray (RGA).  This client exposes two tiers of document
 * APIs that map directly to the backend's `#[app::logic]` methods:
 *
 * **Active editor flow (snapshot):**
 *   createDocument, getDocument, getContent, setContent, updateDocumentMetadata
 *   — These are the methods the TipTap editor uses today.  `setContent`
 *     reseeds the entire RGA from an HTML snapshot and is the sole
 *     persistence path for the current editor.
 *
 * **Low-level RGA operations (future incremental sync — not used by TipTap):**
 *   insertText, deleteText, replaceText
 *   — Fully implemented backend methods that edit the RGA at raw HTML-string
 *     character offsets.  They are intentionally excluded from the TipTap
 *     save path because TipTap positions are ProseMirror-tree-relative, not
 *     HTML-byte-relative.  Calling them without a DOM-to-HTML position
 *     mapping will corrupt tags.  See the section comment above those
 *     methods for what a future incremental-sync agent needs to build.
 *
 * Every public method maps 1:1 to a backend JSON-RPC app method exposed via
 * `this.execute(methodName, params)`.
 */

import {
  CalimeroApp,
  Context,
  ExecutionResponse,
} from '@calimero-network/calimero-client';
import { adminRequest } from './AdminApi';
import { getApplicationId } from '@/constants/config';
import { buildContextIdCandidates } from './contextIdJoin';

export interface Document {
  id: string;
  title: string;
  /** HTML string derived from the backend's RGA. */
  content: string;
  author: string;
  created_at: number;
  updated_at: number;
  tags: string[];
  archived: boolean;
  folder_id: string | null;
}

export interface DocumentSummary {
  id: string;
  title: string;
  author: string;
  created_at: number;
  updated_at: number;
  tags: string[];
  archived: boolean;
  /** Visible-text preview extracted server-side from the stored HTML (no raw tags). */
  preview: string;
  folder_id: string | null;
}

export interface FolderResponse {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: number;
  updated_at: number;
  color: string | null;
  document_count: number;
  subfolder_count: number;
}

export interface FolderTreeItem {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  document_count: number;
  children: FolderTreeItem[];
}

export interface FolderRegistryEntry {
  context_id: string;
  name: string;
  color: string | null;
  created_at: number;
}

export interface FileEntryResponse {
  id: string;
  name: string;
  blob_id: string;
  mime_type: string;
  size: number;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
  uploaded_by: string;
}

export type AbiEvent =
  | { name: 'DocumentCreated'; id: string; title: string; author: string }
  | { name: 'DocumentUpdated'; id: string; title: string; editor: string }
  | { name: 'DocumentDeleted'; id: string; title: string }
  | { name: 'DocumentArchived'; id: string; archived: boolean }
  | {
      name: 'DocumentMoved';
      id: string;
      from_folder: string | null;
      to_folder: string | null;
    }
  | {
      name: 'FolderCreated';
      id: string;
      folder_name: string;
      parent_id: string | null;
    }
  | { name: 'FolderUpdated'; id: string; folder_name: string }
  | { name: 'FolderDeleted'; id: string; folder_name: string }
  | {
      name: 'FolderMoved';
      id: string;
      from_parent: string | null;
      to_parent: string | null;
    }
  | { name: 'ContextNameSet'; contextName: string }
  | { name: 'FolderRegistered'; context_id: string; folderName: string }
  | { name: 'FolderNameUpdated'; context_id: string; folderName: string }
  | { name: 'FolderUnregistered'; context_id: string }
  | { name: 'FileCreated'; id: string; file_name: string; uploaded_by: string }
  | { name: 'FileDeleted'; id: string; file_name: string }
  | {
      name: 'FileMoved';
      id: string;
      from_folder: string | null;
      to_folder: string | null;
    };

/**
 * Utility class for handling byte conversions in Calimero
 */
export class CalimeroBytes {
  private data: Uint8Array;

  constructor(input: string | number[] | Uint8Array) {
    if (typeof input === 'string') {
      // Hex string
      this.data = new Uint8Array(
        input.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
      );
    } else if (Array.isArray(input)) {
      // Number array
      this.data = new Uint8Array(input);
    } else {
      // Uint8Array
      this.data = input;
    }
  }

  toArray(): number[] {
    return Array.from(this.data);
  }

  toUint8Array(): Uint8Array {
    return this.data;
  }

  static fromHex(hex: string): CalimeroBytes {
    return new CalimeroBytes(hex);
  }

  static fromArray(arr: number[]): CalimeroBytes {
    return new CalimeroBytes(arr);
  }

  static fromUint8Array(bytes: Uint8Array): CalimeroBytes {
    return new CalimeroBytes(bytes);
  }
}

export class AbiClient {
  private app: CalimeroApp;
  private context: Context | null = null;
  private contextId: string | undefined;

  constructor(app: CalimeroApp, contextId?: string) {
    this.app = app;
    this.contextId = contextId;
  }

  private async getContext(): Promise<Context> {
    if (this.context) return this.context;

    // When a specific contextId is known, resolve it directly instead of
    // fetching ALL contexts.  fetchContexts() fails entirely if any other
    // context on the node lacks an identity, so the direct path is both
    // faster and more robust.
    if (this.contextId) {
      const direct = await this.resolveContextDirectly(this.contextId);
      if (direct) {
        this.context = direct;
        return this.context;
      }

      // Fallback: maybe the direct admin call isn't available; try the
      // full list so older nodes still work.
      try {
        const contexts = await this.app.fetchContexts();
        const found = contexts.find((c) => c.contextId === this.contextId);
        if (found) {
          this.context = found;
          return this.context;
        }
      } catch {
        // fetchContexts can throw when other contexts lack identities
      }

      throw new Error(`Context not found: ${this.contextId}`);
    }

    const contexts = await this.app.fetchContexts();
    if (contexts.length === 0) {
      this.context = await this.app.createContext();
    } else {
      this.context = contexts[0];
    }
    return this.context;
  }

  /**
   * Resolve a single context by fetching only its identity from the admin API.
   * Avoids the fragile fetchContexts() which fails if ANY context lacks an identity.
   */
  private async resolveContextDirectly(
    contextId: string,
  ): Promise<Context | null> {
    const candidateIds = buildContextIdCandidates(contextId);
    for (const candidateId of candidateIds) {
      try {
        const result = await adminRequest<{ identities: string[] }>(
          `/contexts/${candidateId}/identities-owned`,
        );
        const identities = result?.identities;
        if (!identities?.length) continue;
        return {
          // Use the ID form accepted by the node for subsequent execute calls.
          contextId: candidateId,
          executorId: identities[0],
          applicationId: getApplicationId(),
        };
      } catch {
        // Try the next candidate format.
      }
    }
    return null;
  }

  private async execute(
    method: string,
    params: Record<string, unknown>,
  ): Promise<ExecutionResponse> {
    const context = await this.getContext();
    console.log(
      `[AbiClient.execute] method: ${method}, context:`,
      context,
      'params:',
      JSON.stringify(params).substring(0, 200),
    );
    const result = await this.app.execute(context, method, params);
    console.log(`[AbiClient.execute] ${method} result:`, result);
    return result;
  }

  // ========== ACTIVE EDITOR FLOW (snapshot HTML) ==========
  //
  // These methods form the supported TipTap save path:
  //   createDocument  → first save (creates backend document with HTML body)
  //   getDocument     → load document (returns HTML from RGA)
  //   setContent      → subsequent saves (reseeds RGA from HTML snapshot)
  //   getContent      → load content only (returns HTML string, no metadata)
  //   updateDocumentMetadata → title / archived changes (no content)
  //
  // The editor calls editor.getHTML() and passes the result to setContent.
  // The backend reseeds the RGA each time, so this is a full-replacement
  // snapshot — not incremental.

  /**
   * Create a new document from an HTML body snapshot.
   * Maps to backend: `create_document(title, content, tags, folder_id) -> doc_id`
   */
  public async createDocument(params: {
    title: string;
    content: string;
    tags: string[];
    folder_id?: string | null;
  }): Promise<string> {
    const response = await this.execute('create_document', {
      title: params.title,
      content: params.content,
      tags: params.tags,
      folder_id: params.folder_id ?? null,
    });
    if (response.success) {
      return response.result as string;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Reseed the document's RGA from a full HTML snapshot.
   * This is the primary save method for the TipTap editor flow.
   * Maps to backend: `set_content(doc_id, content)`
   */
  public async setContent(params: {
    id: string;
    content: string;
  }): Promise<void> {
    console.log(
      '[AbiClient.setContent] doc_id:',
      params.id,
      'content length:',
      params.content.length,
    );
    const response = await this.execute('set_content', {
      doc_id: params.id,
      content: params.content,
    });
    console.log('[AbiClient.setContent] response:', response);
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get only the stored HTML content string (without metadata).
   * Maps to backend: `get_content(doc_id) -> String`
   */
  public async getContent(params: { id: string }): Promise<string> {
    const response = await this.execute('get_content', { doc_id: params.id });
    if (response.success) {
      return response.result as string;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Update document metadata (title, archived status) without touching content.
   * Maps to backend: `update_document_metadata(doc_id, title?, archived?)`
   */
  public async updateDocumentMetadata(params: {
    id: string;
    title?: string | null;
    archived?: boolean | null;
  }): Promise<void> {
    const response = await this.execute('update_document_metadata', {
      doc_id: params.id,
      title: params.title,
      archived: params.archived,
    });
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  // ========== LOW-LEVEL RGA OPERATIONS (not used by TipTap) ==========
  //
  // These three methods — insertText, deleteText, replaceText — operate on
  // raw character positions in the stored HTML string inside the backend RGA.
  // They exist as fully implemented JSON-RPC app methods and are tested in
  // AbiClient.test.ts, but the TipTap editor MUST NOT call them today.
  //
  // WHY THEY ARE OUT OF SCOPE FOR THE ACTIVE EDITOR FLOW:
  //
  //   TipTap works with a ProseMirror document model.  Edits are expressed as
  //   ProseMirror transactions (steps) that reference positions in the DOM
  //   tree, not byte offsets in a serialised HTML string.  The backend RGA
  //   stores the serialised HTML, so a naïve position from TipTap would land
  //   inside an HTML tag or attribute, corrupting the document.
  //
  // WHAT A FUTURE INCREMENTAL-SYNC AGENT NEEDS TO BUILD:
  //
  //   1. A DOM-position-to-HTML-string-offset mapping layer that translates
  //      ProseMirror transaction positions into safe RGA character offsets,
  //      skipping over tag boundaries and attribute regions.
  //   2. Conflict resolution strategy for concurrent edits — the RGA handles
  //      character-level merge, but the mapping layer must stay consistent
  //      across peers.
  //   3. A round-trip test harness that verifies TipTap → mapping → RGA →
  //      HTML → TipTap produces the expected document for non-trivial
  //      formatting (nested lists, links with attributes, highlights).
  //
  // Until that mapping exists, the editor uses setContent (full HTML snapshot
  // reseed) as the sole persistence path.  These methods remain available so
  // the incremental-sync work can build on them without backend changes.

  /**
   * Insert text at a raw character offset in the stored HTML string.
   *
   * **OUT OF SCOPE for the active TipTap flow.** The offset is relative to
   * the serialised HTML, not the ProseMirror document tree, so calling this
   * from TipTap without a DOM-to-HTML position mapping will corrupt tags.
   *
   * Maps to backend: `insert_text(doc_id, position, text)`
   * @see setContent — the safe snapshot alternative used by the editor today.
   */
  public async insertText(params: {
    id: string;
    position: number;
    text: string;
  }): Promise<void> {
    const response = await this.execute('insert_text', {
      doc_id: params.id,
      position: params.position,
      text: params.text,
    });
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Delete a character range in the stored HTML string.
   *
   * **OUT OF SCOPE for the active TipTap flow.** `start` and `end` are raw
   * byte offsets in the serialised HTML.  Without a DOM-to-HTML mapping,
   * this can remove partial tags and produce invalid markup.
   *
   * Maps to backend: `delete_text(doc_id, start, end)`
   * @see setContent — the safe snapshot alternative used by the editor today.
   */
  public async deleteText(params: {
    id: string;
    start: number;
    end: number;
  }): Promise<void> {
    const response = await this.execute('delete_text', {
      doc_id: params.id,
      start: params.start,
      end: params.end,
    });
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Replace a character range in the stored HTML string with new text.
   *
   * **OUT OF SCOPE for the active TipTap flow.** Combines a delete and
   * insert at raw HTML byte offsets.  Same tag-corruption risk as
   * `insertText` and `deleteText`.
   *
   * Maps to backend: `replace_text(doc_id, start, end, text)`
   * @see setContent — the safe snapshot alternative used by the editor today.
   */
  public async replaceText(params: {
    id: string;
    start: number;
    end: number;
    text: string;
  }): Promise<void> {
    const response = await this.execute('replace_text', {
      doc_id: params.id,
      start: params.start,
      end: params.end,
      text: params.text,
    });
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  // ========== DOCUMENT QUERY METHODS ==========

  /**
   * Get the length of the stored HTML string.
   * Maps to backend: `get_content_length(doc_id) -> usize`
   */
  public async getContentLength(params: { id: string }): Promise<number> {
    const response = await this.execute('get_content_length', {
      doc_id: params.id,
    });
    if (response.success) {
      return response.result as number;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Add a tag to a document.
   * Maps to backend: `add_tag(doc_id, tag)`
   */
  public async addTag(params: { id: string; tag: string }): Promise<void> {
    const response = await this.execute('add_tag', {
      doc_id: params.id,
      tag: params.tag,
    });
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Replace the tag set for a document.
   * Maps to backend: `set_tags(doc_id, tags)`
   */
  public async setTags(params: { id: string; tags: string[] }): Promise<void> {
    const response = await this.execute('set_tags', {
      doc_id: params.id,
      tags: params.tags,
    });
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Convenience wrapper that combines updateDocumentMetadata + setContent + setTags.
   * Not called by the active editor flow (which calls setContent and
   * updateDocumentMetadata separately), but kept for backwards compatibility.
   */
  public async updateDocument(params: {
    id: string;
    title?: string | null;
    content?: string | null;
    tags?: string[] | null;
  }): Promise<void> {
    // Update metadata if title is provided
    if (params.title !== undefined && params.title !== null) {
      await this.updateDocumentMetadata({ id: params.id, title: params.title });
    }

    // Update content if provided
    if (params.content !== undefined && params.content !== null) {
      await this.setContent({ id: params.id, content: params.content });
    }

    // Update tags if provided
    if (params.tags !== undefined && params.tags !== null) {
      await this.setTags({ id: params.id, tags: params.tags });
    }
  }

  /**
   * Delete a document permanently.
   * Maps to backend: `delete_document(doc_id)`
   */
  public async deleteDocument(params: { id: string }): Promise<void> {
    const response = await this.execute('delete_document', {
      doc_id: params.id,
    });
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Archive or unarchive a document.
   * Maps to backend: `set_archived(doc_id, archived)`
   */
  public async setArchived(params: {
    id: string;
    archived: boolean;
  }): Promise<void> {
    const response = await this.execute('set_archived', {
      doc_id: params.id,
      archived: params.archived,
    });
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get a document with full metadata and HTML content.
   * The editor uses this to load a document: `editor.commands.setContent(doc.content)`.
   * Maps to backend: `get_document(doc_id) -> DocumentResponse`
   */
  public async getDocument(params: { id: string }): Promise<Document | null> {
    const response = await this.execute('get_document', { doc_id: params.id });
    if (response.success) {
      return response.result as Document | null;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * List all documents (summaries with visible-text previews, no full content).
   * Maps to backend: `list_documents(include_archived) -> Vec<DocumentSummary>`
   */
  public async listDocuments(params: {
    include_archived: boolean;
  }): Promise<DocumentSummary[]> {
    const response = await this.execute('list_documents', params);
    if (response.success) {
      return (response.result as DocumentSummary[]) || [];
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Search documents by title, visible text derived from HTML content, or tags.
   * Maps to backend: `search_documents(query, include_archived) -> Vec<DocumentSummary>`
   */
  public async searchDocuments(params: {
    query: string;
    include_archived: boolean;
  }): Promise<DocumentSummary[]> {
    const response = await this.execute('search_documents', params);
    if (response.success) {
      return (response.result as DocumentSummary[]) || [];
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Filter documents by tag.
   * Maps to backend: `get_documents_by_tag(tag, include_archived) -> Vec<DocumentSummary>`
   */
  public async getDocumentsByTag(params: {
    tag: string;
    include_archived: boolean;
  }): Promise<DocumentSummary[]> {
    const response = await this.execute('get_documents_by_tag', params);
    if (response.success) {
      return (response.result as DocumentSummary[]) || [];
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get all unique tags across documents.
   * Maps to backend: `get_all_tags() -> Vec<String>`
   */
  public async getAllTags(): Promise<string[]> {
    const response = await this.execute('get_all_tags', {});
    if (response.success) {
      return (response.result as string[]) || [];
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get aggregate document statistics.
   * Maps to backend: `get_stats() -> String`
   */
  public async getStats(): Promise<string> {
    const response = await this.execute('get_stats', {});
    if (response.success) {
      return response.result as string;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get the total number of documents.
   * Maps to backend: `get_document_count() -> usize`
   */
  public async getDocumentCount(): Promise<number> {
    const response = await this.execute('get_document_count', {});
    if (response.success) {
      return response.result as number;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  // ========== FOLDER METHODS ==========

  /**
   * Create a new folder
   */
  public async createFolder(params: {
    name: string;
    parent_id?: string | null;
    color?: string | null;
  }): Promise<string> {
    const response = await this.execute('create_folder', {
      name: params.name,
      parent_id: params.parent_id ?? null,
      color: params.color ?? null,
    });
    if (response.success) {
      return response.result as string;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Rename a folder
   */
  public async renameFolder(params: {
    folder_id: string;
    name: string;
  }): Promise<void> {
    const response = await this.execute('rename_folder', params);
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Set folder color
   */
  public async setFolderColor(params: {
    folder_id: string;
    color: string | null;
  }): Promise<void> {
    const response = await this.execute('set_folder_color', params);
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Move a folder to a new parent
   */
  public async moveFolder(params: {
    folder_id: string;
    new_parent_id: string | null;
  }): Promise<void> {
    const response = await this.execute('move_folder', params);
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Delete a folder
   */
  public async deleteFolder(params: {
    folder_id: string;
    recursive?: boolean;
  }): Promise<void> {
    const response = await this.execute('delete_folder', {
      folder_id: params.folder_id,
      recursive: params.recursive ?? false,
    });
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get a folder by ID
   */
  public async getFolder(params: {
    folder_id: string;
  }): Promise<FolderResponse | null> {
    const response = await this.execute('get_folder', params);
    if (response.success) {
      return response.result as FolderResponse | null;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * List all folders
   */
  public async listFolders(): Promise<FolderResponse[]> {
    const response = await this.execute('list_folders', {});
    if (response.success) {
      return (response.result as FolderResponse[]) || [];
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get folder tree structure
   */
  public async getFolderTree(): Promise<FolderTreeItem[]> {
    const response = await this.execute('get_folder_tree', {});
    if (response.success) {
      return (response.result as FolderTreeItem[]) || [];
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get documents in a specific folder (or root when folder_id is null).
   * Maps to backend: `get_documents_in_folder(folder_id, include_archived) -> Vec<DocumentSummary>`
   */
  public async getDocumentsInFolder(params: {
    folder_id: string | null;
    include_archived: boolean;
  }): Promise<DocumentSummary[]> {
    const response = await this.execute('get_documents_in_folder', params);
    if (response.success) {
      return (response.result as DocumentSummary[]) || [];
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Move a document to a different folder (or root when folder_id is null).
   * Maps to backend: `move_document(doc_id, folder_id)`
   */
  public async moveDocument(params: {
    doc_id: string;
    folder_id: string | null;
  }): Promise<void> {
    const response = await this.execute('move_document', params);
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get folder count
   */
  public async getFolderCount(): Promise<number> {
    const response = await this.execute('get_folder_count', {});
    if (response.success) {
      return response.result as number;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  // ========== CONTEXT GROUP METHODS ==========

  /**
   * Set the human-readable name for this context
   */
  public async setContextName(params: { name: string }): Promise<void> {
    const response = await this.execute('set_context_name', params);
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get the human-readable name for this context
   */
  public async getContextName(): Promise<string> {
    const response = await this.execute('get_context_name', {});
    if (response.success) {
      return response.result as string;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Register a folder context in the General context's registry
   */
  public async registerFolder(params: {
    context_id: string;
    name: string;
    color?: string | null;
  }): Promise<void> {
    const response = await this.execute('register_folder', {
      context_id: params.context_id,
      name: params.name,
      color: params.color ?? null,
    });
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Update the registered name of a folder context in the General registry
   */
  public async updateFolderName(params: {
    context_id: string;
    name: string;
  }): Promise<void> {
    const response = await this.execute('update_folder_name', params);
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Remove a folder context from the General context's registry
   */
  public async unregisterFolder(params: { context_id: string }): Promise<void> {
    const response = await this.execute('unregister_folder', params);
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get all folder contexts registered in the General context
   */
  public async getFolderRegistry(): Promise<FolderRegistryEntry[]> {
    const response = await this.execute('get_folder_registry', {});
    if (response.success) {
      return (response.result as FolderRegistryEntry[]) || [];
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  // ========== FILE METHODS ==========

  /**
   * Create a file entry after blob upload completes
   */
  public async createFile(params: {
    name: string;
    blob_id: string;
    mime_type: string;
    size: number;
    folder_id?: string | null;
  }): Promise<string> {
    const response = await this.execute('create_file', {
      name: params.name,
      blob_id: params.blob_id,
      mime_type: params.mime_type,
      size: params.size,
      folder_id: params.folder_id ?? null,
    });
    if (response.success) {
      return response.result as string;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get a single file by ID
   */
  public async getFile(params: {
    file_id: string;
  }): Promise<FileEntryResponse | null> {
    const response = await this.execute('get_file', params);
    if (response.success) {
      return response.result as FileEntryResponse | null;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * List all files
   */
  public async listFiles(): Promise<FileEntryResponse[]> {
    const response = await this.execute('list_files', {});
    if (response.success) {
      return (response.result as FileEntryResponse[]) || [];
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * List files in a specific folder (or root if folder_id is null)
   */
  public async listFilesInFolder(params: {
    folder_id: string | null;
  }): Promise<FileEntryResponse[]> {
    const response = await this.execute('list_files_in_folder', params);
    if (response.success) {
      return (response.result as FileEntryResponse[]) || [];
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Delete a file entry (does not remove the blob itself)
   */
  public async deleteFile(params: { file_id: string }): Promise<void> {
    const response = await this.execute('delete_file', params);
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Move a file to a different folder (or root if folder_id is null)
   */
  public async moveFile(params: {
    file_id: string;
    folder_id: string | null;
  }): Promise<void> {
    const response = await this.execute('move_file', params);
    if (response.success) {
      return response.result as void;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }

  /**
   * Get the total number of files
   */
  public async getFileCount(): Promise<number> {
    const response = await this.execute('get_file_count', {});
    if (response.success) {
      return response.result as number;
    } else {
      throw new Error(response.error || 'Execution failed');
    }
  }
}
