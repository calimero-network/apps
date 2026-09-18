// The service layer, replaced for the harness. Everything the pages RENDER is
// production code; only the modules that reach a node are swapped.
import {
  AGREEMENTS,
  CONTEXT_DETAILS,
  DOCUMENTS,
  PARTICIPANTS,
  SIGNATURE_ROWS,
  ALICE,
  BOB,
  current,
} from './fixtures';

const ok = <T>(data: T) => ({ data, error: null });
const fail = (message: string) => ({
  data: null,
  error: { code: 500, message },
});

export class AgreementService {
  async listAgreements() {
    if (current.agreements === 'error') {
      return fail('This node is not reachable. Check that merod is running.');
    }
    return ok(current.agreements === 'none' ? [] : AGREEMENTS);
  }
  async resolveSharedNames(rows: unknown[]) {
    return rows;
  }
  async createAgreement() {
    return ok(AGREEMENTS[0]);
  }
}

export class ClientApiDataSource {
  async getContextDetails() {
    return ok(CONTEXT_DETAILS);
  }
  // The harness's "me": an admin sees the role controls, a signer does not.
  async whoami() {
    return ok(current.me === 'admin' ? ALICE : BOB);
  }
  async listSignatures() {
    return ok(current.signatures === 'none' ? [] : SIGNATURE_ROWS);
  }
  async createSignature() {
    return ok(1);
  }
  async deleteSignature() {
    return ok(undefined);
  }
  async deleteDocument() {
    return ok(undefined);
  }
  async setParticipantPermission() {
    return ok(undefined);
  }
  async removeParticipant() {
    return ok(undefined);
  }
  async addParticipant() {
    return ok(undefined);
  }
}

export class ContextApiDataSource {
  async inviteToContext() {
    return ok('3vQB7B6MrGQZaxCuFg4ohTestPayload');
  }
}

export class DocumentService {
  async listDocuments() {
    return ok(current.documents === 'none' ? [] : DOCUMENTS);
  }
  async uploadDocument() {
    return ok('doc-4');
  }
}

export async function redeemInvitation() {
  return { contextId: 'ctx-1', memberPublicKey: BOB, name: 'NDA with Acme' };
}
export function parseInvitation() {
  return null;
}
export const PARTICIPANT_FIXTURE = PARTICIPANTS;
