import { createBackendActor } from './backendActor';

export const backendService = async (identity?: any) => {
  const actor = await createBackendActor(identity);

  return {
    getHashes: (documentId: string) => actor.get_hashes(documentId),
    recordFinalHash: (documentId: string, hash: string) =>
      actor.record_final_hash(documentId, hash),
    recordOriginalHash: (documentId: string, hash: string) =>
      actor.record_original_hash(documentId, hash),
    verifyHash: (documentId: string, hash: string) =>
      actor.verify_hash(documentId, hash),
  };
};
