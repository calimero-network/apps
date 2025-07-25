export const idlFactory = ({ IDL }) => {
  const DocumentHashes = IDL.Record({
    'timestamp_final' : IDL.Opt(IDL.Nat64),
    'final_hash' : IDL.Opt(IDL.Text),
    'original_hash' : IDL.Text,
    'timestamp_original' : IDL.Nat64,
  });
  const Error = IDL.Variant({
    'UpdateConflict' : IDL.Text,
    'InvalidInput' : IDL.Text,
    'NotFound' : IDL.Null,
    'AlreadyExists' : IDL.Null,
  });
  const Result = IDL.Variant({ 'Ok' : DocumentHashes, 'Err' : Error });
  const Result_1 = IDL.Variant({ 'Ok' : IDL.Null, 'Err' : Error });
  const VerificationStatus = IDL.Variant({
    'Unrecorded' : IDL.Null,
    'FinalMatch' : IDL.Null,
    'NoMatch' : IDL.Null,
    'OriginalMatch' : IDL.Null,
  });
  return IDL.Service({
    'get_hashes' : IDL.Func([IDL.Text], [Result], ['query']),
    'record_final_hash' : IDL.Func([IDL.Text, IDL.Text], [Result_1], []),
    'record_original_hash' : IDL.Func([IDL.Text, IDL.Text], [Result_1], []),
    'verify_hash' : IDL.Func(
        [IDL.Text, IDL.Text],
        [VerificationStatus],
        ['query'],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
