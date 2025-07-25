import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface DocumentHashes {
  'timestamp_final' : [] | [bigint],
  'final_hash' : [] | [string],
  'original_hash' : string,
  'timestamp_original' : bigint,
}
export type Error = { 'UpdateConflict' : string } |
  { 'InvalidInput' : string } |
  { 'NotFound' : null } |
  { 'AlreadyExists' : null };
export type Result = { 'Ok' : DocumentHashes } |
  { 'Err' : Error };
export type Result_1 = { 'Ok' : null } |
  { 'Err' : Error };
export type VerificationStatus = { 'Unrecorded' : null } |
  { 'FinalMatch' : null } |
  { 'NoMatch' : null } |
  { 'OriginalMatch' : null };
export interface _SERVICE {
  'get_hashes' : ActorMethod<[string], Result>,
  'record_final_hash' : ActorMethod<[string, string], Result_1>,
  'record_original_hash' : ActorMethod<[string, string], Result_1>,
  'verify_hash' : ActorMethod<[string, string], VerificationStatus>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
