import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export type AuditAction = { 'DocumentUploaded' : null } |
  { 'ConsentGiven' : null } |
  { 'SignerAdded' : null } |
  { 'SignatureApplied' : null } |
  { 'DocumentCompleted' : null };
export interface AuditEntry {
  'action' : AuditAction,
  'metadata' : [] | [string],
  'user_id' : string,
  'consent_given' : [] | [boolean],
  'document_hash_after_action' : [] | [string],
  'timestamp' : bigint,
  'entry_id' : string,
}
export interface DocumentMetadata {
  'title' : [] | [string],
  'document_type' : [] | [string],
  'description' : [] | [string],
  'created_at' : bigint,
  'expires_at' : [] | [bigint],
}
export interface DocumentRecord {
  'participants' : Array<string>,
  'admin_id' : string,
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
  'title' : [] | [string],
  'participants' : Array<string>,
  'document_hash' : string,
  'document_type' : [] | [string],
  'document_id' : string,
  'description' : [] | [string],
  'expires_at' : [] | [bigint],
}
export type Error = { 'UpdateConflict' : string } |
  { 'DocumentNotReady' : null } |
  { 'InvalidInput' : string } |
  { 'NotFound' : null } |
  { 'ConsentRequired' : null } |
  { 'Unauthorized' : null } |
  { 'AlreadyExists' : null };
export type Result = { 'Ok' : null } |
  { 'Err' : Error };
export type Result_1 = { 'Ok' : Array<AuditEntry> } |
  { 'Err' : Error };
export type Result_2 = { 'Ok' : DocumentRecord } |
  { 'Err' : Error };
export type Result_3 = { 'Ok' : DocumentStatus } |
  { 'Err' : Error };
export type Result_4 = { 'Ok' : [Array<string>, Array<string>] } |
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
  'add_participant' : ActorMethod<[string, string], Result>,
  'get_audit_trail' : ActorMethod<[string], Result_1>,
  'get_document_record' : ActorMethod<[string], Result_2>,
  'get_document_status' : ActorMethod<[string], Result_3>,
  'get_hashes' : ActorMethod<[string], Result_2>,
  'get_signing_progress' : ActorMethod<[string], Result_4>,
  'record_consent' : ActorMethod<[string], Result>,
  'record_final_hash' : ActorMethod<[string, string], Result>,
  'record_original_hash' : ActorMethod<[string, string], Result>,
  'sign_document' : ActorMethod<[SigningRequest], Result>,
  'upload_document' : ActorMethod<[DocumentUploadRequest], Result>,
  'verify_hash' : ActorMethod<[string, string], VerificationStatus>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
