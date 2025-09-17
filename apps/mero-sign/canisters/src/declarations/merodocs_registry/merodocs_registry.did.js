export const idlFactory = ({ IDL }) => {
  const Error = IDL.Variant({
    'UpdateConflict' : IDL.Text,
    'DocumentNotReady' : IDL.Null,
    'ContextNotFound' : IDL.Null,
    'InvalidInput' : IDL.Text,
    'NotFound' : IDL.Null,
    'ConsentRequired' : IDL.Null,
    'Unauthorized' : IDL.Null,
    'AlreadyExists' : IDL.Null,
  });
  const Result = IDL.Variant({ 'Ok' : IDL.Null, 'Err' : Error });
  const CreateContextRequest = IDL.Record({
    'context_id' : IDL.Text,
    'title' : IDL.Opt(IDL.Text),
    'participants' : IDL.Vec(IDL.Text),
    'description' : IDL.Opt(IDL.Text),
    'agreement_type' : IDL.Opt(IDL.Text),
    'expires_at' : IDL.Opt(IDL.Nat64),
  });
  const AuditAction = IDL.Variant({
    'DocumentUploaded' : IDL.Null,
    'ContextCreated' : IDL.Null,
    'ContextCompleted' : IDL.Null,
    'ConsentGiven' : IDL.Null,
    'ParticipantAdded' : IDL.Null,
    'SignatureApplied' : IDL.Null,
    'DocumentCompleted' : IDL.Null,
  });
  const AuditEntry = IDL.Record({
    'context_id' : IDL.Text,
    'action' : AuditAction,
    'document_id' : IDL.Opt(IDL.Text),
    'metadata' : IDL.Opt(IDL.Text),
    'user_id' : IDL.Text,
    'consent_given' : IDL.Opt(IDL.Bool),
    'document_hash_after_action' : IDL.Opt(IDL.Text),
    'timestamp' : IDL.Nat64,
    'entry_id' : IDL.Text,
  });
  const Result_1 = IDL.Variant({ 'Ok' : IDL.Vec(AuditEntry), 'Err' : Error });
  const ContextMetadata = IDL.Record({
    'title' : IDL.Opt(IDL.Text),
    'description' : IDL.Opt(IDL.Text),
    'agreement_type' : IDL.Opt(IDL.Text),
    'expires_at' : IDL.Opt(IDL.Nat64),
  });
  const ContextStatus = IDL.Variant({
    'Active' : IDL.Null,
    'Completed' : IDL.Null,
    'Expired' : IDL.Null,
  });
  const ContextRecord = IDL.Record({
    'context_id' : IDL.Text,
    'participants' : IDL.Vec(IDL.Text),
    'document_ids' : IDL.Vec(IDL.Text),
    'admin_id' : IDL.Text,
    'metadata' : ContextMetadata,
    'context_status' : ContextStatus,
    'created_at' : IDL.Nat64,
  });
  const Result_2 = IDL.Variant({ 'Ok' : ContextRecord, 'Err' : Error });
  const DocumentMetadata = IDL.Record({ 'created_at' : IDL.Nat64 });
  const DocumentStatus = IDL.Variant({
    'PartiallySigned' : IDL.Null,
    'FullySigned' : IDL.Null,
    'Pending' : IDL.Null,
  });
  const DocumentRecord = IDL.Record({
    'context_id' : IDL.Text,
    'document_id' : IDL.Text,
    'metadata' : DocumentMetadata,
    'document_status' : DocumentStatus,
    'current_signers' : IDL.Vec(IDL.Text),
    'timestamp_final' : IDL.Opt(IDL.Nat64),
    'final_hash' : IDL.Opt(IDL.Text),
    'original_hash' : IDL.Text,
    'timestamp_original' : IDL.Nat64,
  });
  const Result_3 = IDL.Variant({
    'Ok' : IDL.Vec(DocumentRecord),
    'Err' : Error,
  });
  const Result_4 = IDL.Variant({
    'Ok' : IDL.Tuple(
      IDL.Vec(IDL.Text),
      IDL.Vec(IDL.Text),
      IDL.Vec(IDL.Tuple(IDL.Text, DocumentStatus)),
    ),
    'Err' : Error,
  });
  const Result_5 = IDL.Variant({ 'Ok' : DocumentRecord, 'Err' : Error });
  const SigningRequest = IDL.Record({
    'document_id' : IDL.Text,
    'consent_acknowledged' : IDL.Bool,
  });
  const DocumentUploadRequest = IDL.Record({
    'context_id' : IDL.Text,
    'document_hash' : IDL.Text,
    'document_id' : IDL.Text,
  });
  const VerificationStatus = IDL.Variant({
    'Unrecorded' : IDL.Null,
    'FinalMatch' : IDL.Null,
    'NoMatch' : IDL.Null,
    'OriginalMatch' : IDL.Null,
  });
  return IDL.Service({
    'add_participant_to_context' : IDL.Func([IDL.Text, IDL.Text], [Result], []),
    'create_context' : IDL.Func([CreateContextRequest], [Result], []),
    'get_audit_trail' : IDL.Func([IDL.Text], [Result_1], ['query']),
    'get_audit_trail_for_document' : IDL.Func(
        [IDL.Text, IDL.Text],
        [Result_1],
        ['query'],
      ),
    'get_context' : IDL.Func([IDL.Text], [Result_2], ['query']),
    'get_context_documents' : IDL.Func([IDL.Text], [Result_3], ['query']),
    'get_context_signing_progress' : IDL.Func(
        [IDL.Text],
        [Result_4],
        ['query'],
      ),
    'get_document' : IDL.Func([IDL.Text], [Result_5], ['query']),
    'has_user_consented' : IDL.Func(
        [IDL.Text, IDL.Text, IDL.Text],
        [IDL.Bool],
        ['query'],
      ),
    'is_user_context_participant' : IDL.Func(
        [IDL.Text, IDL.Text],
        [IDL.Bool],
        ['query'],
      ),
    'record_consent_for_context' : IDL.Func([IDL.Text, IDL.Text], [Result], []),
    'record_final_hash' : IDL.Func([IDL.Text, IDL.Text], [Result], []),
    'sign_document' : IDL.Func([SigningRequest], [Result], []),
    'upload_document_to_context' : IDL.Func(
        [DocumentUploadRequest],
        [Result],
        [],
      ),
    'verify_document_hash' : IDL.Func(
        [IDL.Text, IDL.Text],
        [VerificationStatus],
        ['query'],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
