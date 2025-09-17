import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export type AuditAction = { 'DocumentUploaded' : null } |
  { 'ContextCreated' : null } |
  { 'ContextCompleted' : null } |
  { 'ConsentGiven' : null } |
  { 'ParticipantAdded' : null } |
  { 'SignatureApplied' : null } |
  { 'DocumentCompleted' : null };
export interface AuditEntry {
  'context_id' : string,
  'action' : AuditAction,
  'document_id' : [] | [string],
  'metadata' : [] | [string],
  'user_id' : string,
  'consent_given' : [] | [boolean],
  'document_hash_after_action' : [] | [string],
  'timestamp' : bigint,
  'entry_id' : string,
}
export interface ContextMetadata {
  'title' : [] | [string],
  'description' : [] | [string],
  'agreement_type' : [] | [string],
  'expires_at' : [] | [bigint],
}
export interface ContextRecord {
  'context_id' : string,
  'participants' : Array<string>,
  'document_ids' : Array<string>,
  'admin_id' : string,
  'metadata' : ContextMetadata,
  'context_status' : ContextStatus,
  'created_at' : bigint,
}
export type ContextStatus = { 'Active' : null } |
  { 'Completed' : null } |
  { 'Expired' : null };
export interface CreateContextRequest {
  'context_id' : string,
  'title' : [] | [string],
  'participants' : Array<string>,
  'description' : [] | [string],
  'agreement_type' : [] | [string],
  'expires_at' : [] | [bigint],
}
export interface DocumentMetadata { 'created_at' : bigint }
export interface DocumentRecord {
  'context_id' : string,
  'document_id' : string,
  'metadata' : DocumentMetadata,
  'document_status' : DocumentStatus,
  'current_signers' : Array<string>,
  'timestamp_final' : [] | [bigint],
  'final_hash' : [] | [string],
  'original_hash' : string,
  'timestamp_original' : bigint,
}
export type DocumentStatus = { 'PartiallySigned' : null } |
  { 'FullySigned' : null } |
  { 'Pending' : null };
export interface DocumentUploadRequest {
  'context_id' : string,
  'document_hash' : string,
  'document_id' : string,
}
export type Error = { 'UpdateConflict' : string } |
  { 'DocumentNotReady' : null } |
  { 'ContextNotFound' : null } |
  { 'InvalidInput' : string } |
  { 'NotFound' : null } |
  { 'ConsentRequired' : null } |
  { 'Unauthorized' : null } |
  { 'AlreadyExists' : null };
export type Result = { 'Ok' : null } |
  { 'Err' : Error };
export type Result_1 = { 'Ok' : Array<AuditEntry> } |
  { 'Err' : Error };
export type Result_2 = { 'Ok' : ContextRecord } |
  { 'Err' : Error };
export type Result_3 = { 'Ok' : Array<DocumentRecord> } |
  { 'Err' : Error };
export type Result_4 = {
    'Ok' : [Array<string>, Array<string>, Array<[string, DocumentStatus]>]
  } |
  { 'Err' : Error };
export type Result_5 = { 'Ok' : DocumentRecord } |
  { 'Err' : Error };
export interface SigningRequest {
  'document_id' : string,
  'consent_acknowledged' : boolean,
}
export type VerificationStatus = { 'Unrecorded' : null } |
  { 'FinalMatch' : null } |
  { 'NoMatch' : null } |
  { 'OriginalMatch' : null };
export interface _SERVICE {
  'add_participant_to_context' : ActorMethod<[string, string], Result>,
  'create_context' : ActorMethod<[CreateContextRequest], Result>,
  'get_audit_trail' : ActorMethod<[string], Result_1>,
  'get_audit_trail_for_document' : ActorMethod<[string, string], Result_1>,
  'get_context' : ActorMethod<[string], Result_2>,
  'get_context_documents' : ActorMethod<[string], Result_3>,
  'get_context_signing_progress' : ActorMethod<[string], Result_4>,
  'get_document' : ActorMethod<[string], Result_5>,
  'has_user_consented' : ActorMethod<[string, string, string], boolean>,
  'is_user_context_participant' : ActorMethod<[string, string], boolean>,
  'record_consent_for_context' : ActorMethod<[string, string], Result>,
  'record_final_hash' : ActorMethod<[string, string], Result>,
  'sign_document' : ActorMethod<[SigningRequest], Result>,
  'upload_document_to_context' : ActorMethod<[DocumentUploadRequest], Result>,
  'verify_document_hash' : ActorMethod<[string, string], VerificationStatus>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
