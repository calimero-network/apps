import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { PermissionLevel } from '../api/clientApi';
import {
  CALLS,
  MeroSignApp,
  VIEWS,
  toContextDetails,
  toDocumentInfo,
  toSignature,
} from './meroSign';
import { withRoutes } from '@calimero-apps/connect/testing';

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(
  readFileSync(resolve(__dirname, '../../../logic/res/abi.json'), 'utf8'),
) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

const HEX = 'ab'.repeat(32);

const WIRE_DOC = {
  id: 'doc_1',
  name: 'NDA.pdf',
  hash: 'h1',
  uploadedBy: 'acct-alice',
  uploadedAt: '1700000000000',
  status: 'PartiallySigned',
  pdfBlobId: HEX,
  size: '2048',
  requiredSigners: ['acct-alice', 'acct-bob'],
  embeddings: null,
  extractedText: null,
  chunks: null,
};

const WIRE_DETAILS = {
  contextId: 'app-1',
  contextName: 'Series A',
  owner: 'acct-alice',
  isPrivate: false,
  participantCount: '2',
  participants: [
    { userId: 'acct-alice', permissionLevel: 'Admin' },
    { userId: 'acct-bob', permissionLevel: 'Sign' },
  ],
  documentCount: '1',
  createdAt: '1700000000000',
};

function answering(method: string): unknown {
  switch (method) {
    case 'listDocuments':
      return [WIRE_DOC];
    case 'getContextDetails':
      return WIRE_DETAILS;
    case 'listSignatures':
    case 'listJoinedContexts':
    case 'listParticipants':
    case 'getDocumentSignatures':
      return [];
    case 'getIdentityMapping':
      return {
        privateIdentity: 'a',
        sharedIdentity: 'a',
        contextId: 'c',
        createdAt: '1',
      };
    case 'createSignature':
      return '42';
    default:
      return null;
  }
}

describe('the client covers the contract', () => {
  it('calls exactly the contract calls, and views exactly its views', () => {
    expect([...CALLS].sort()).toEqual(byKind('call'));
    expect([...VIEWS].sort()).toEqual(byKind('view'));
    expect(byKind('init')).toEqual(['init']);
  });

  it('sends each method the parameter names the ABI declares', async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      return Promise.resolve({ index: 1, result: answering(method), events: [] });
    };
    const m = new MeroSignApp(withRoutes({ call: vi.fn(record), view: vi.fn(record) }) as never, 'app-1');
    await Promise.all([
      m.setup({ is_private: false, context_name: 'n' }),
      m.isDefaultPrivateContext(),
      m.createSignature({ name: 'n', blob_id_str: HEX, data_size: 1 }),
      m.deleteSignature({ signature_id: 1 }),
      m.listSignatures(),
      m.joinSharedContext({ context_id_str: 'c', shared_identity_str: 's', context_name: 'n' }),
      m.leaveSharedContext({ context_id_str: 'c' }),
      m.listJoinedContexts(),
      m.getIdentityMapping({ context_id_str: 'c' }),
      m.getSharedIdentity({ context_id_str: 'c' }),
      m.resolvePrivateIdentity({ shared_identity_str: 's' }),
      m.whoami(),
      m.getContextId(),
      m.getContextDetails({ context_id_str: 'c' }),
      m.listParticipants(),
      m.getUserPermission({ user_id_str: 'u' }),
      m.registerSelfAsParticipant(),
      m.addParticipant({ user_id_str: 'u', permission: PermissionLevel.Sign }),
      m.removeParticipant({ user_id_str: 'u' }),
      m.setParticipantPermission({ user_id_str: 'u', permission: PermissionLevel.Read }),
      m.uploadDocument({
        name: 'n',
        hash: 'h',
        pdf_blob_id_str: HEX,
        file_size: 1,
        embeddings: null,
        extracted_text: null,
        chunks: null,
      }),
      m.deleteDocument({ document_id: 'd' }),
      m.listDocuments(),
      m.setConsent({ document_id: 'd' }),
      m.hasConsented({ user_id_str: 'u', document_id: 'd' }),
      m.signDocument({
        document_id: 'd',
        base_hash: 'b',
        pdf_blob_id_str: HEX,
        file_size: 1,
        new_hash: 'n',
      }),
      m.getDocumentSignatures({ document_id: 'd' }),
      m.markParticipantSigned({ document_id: 'd' }),
      m.searchDocumentByEmbedding({ query_embedding: [0.1], document_id: 'd' }),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === 'init') continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });
});

describe('the adapter', () => {
  it('turns the contract answers into the shapes the screens use', () => {
    expect(toDocumentInfo(WIRE_DOC)).toEqual({
      id: 'doc_1',
      name: 'NDA.pdf',
      hash: 'h1',
      uploaded_by: 'acct-alice',
      uploaded_at: 1700000000000,
      status: 'PartiallySigned',
      pdf_blob_id: HEX,
      size: 2048,
      required_signers: ['acct-alice', 'acct-bob'],
      embeddings: undefined,
      extracted_text: undefined,
    });
    expect(toContextDetails(WIRE_DETAILS)).toMatchObject({
      context_id: 'app-1',
      context_name: 'Series A',
      participant_count: 2,
      document_count: 1,
      participants: [
        { user_id: 'acct-alice', permission_level: 'Admin' },
        { user_id: 'acct-bob', permission_level: 'Sign' },
      ],
    });
    expect(
      toSignature({ id: '9007199254740991', name: 's', blobId: HEX, size: '10', createdAt: '5' }),
    ).toEqual({ id: 9007199254740991, name: 's', blob_id: HEX, size: 10, created_at: 5 });
  });

  it('sends 64-bit integers as decimal strings, through the log for calls and to a node for views', async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: '7', events: [] });
    const view = vi.fn().mockResolvedValue({ index: 3, result: [WIRE_DOC] });
    const after = vi.fn();
    const m = new MeroSignApp(withRoutes({ call, view }) as never, 'app-1', after);

    expect(await m.createSignature({ name: 's', blob_id_str: HEX, data_size: 10 })).toBe(7);
    expect(call).toHaveBeenCalledWith('app-1', 'createSignature', {
      name: 's',
      blobIdStr: HEX,
      dataSize: '10',
    });
    await m.uploadDocument({
      name: 'n',
      hash: 'h',
      pdf_blob_id_str: HEX,
      file_size: 5,
      embeddings: [0.5],
      extracted_text: 't',
      chunks: [{ text: 'c', embedding: [0.5], start_position: 0, end_position: 1 }],
    });
    expect(call).toHaveBeenLastCalledWith('app-1', 'uploadDocument', {
      name: 'n',
      hash: 'h',
      pdfBlobIdStr: HEX,
      fileSize: '5',
      embeddings: [0.5],
      extractedText: 't',
      chunks: [{ text: 'c', embedding: [0.5], startPosition: 0, endPosition: 1 }],
    });
    const docs = await m.listDocuments();
    expect(view).toHaveBeenCalledWith('app-1', 'listDocuments', {});
    expect(docs[0]?.size).toBe(2048);
    expect(after).toHaveBeenCalledTimes(3);
  });

  it('runs `after` when a request fails too', async () => {
    const after = vi.fn();
    const m = new MeroSignApp(
      withRoutes({ call: vi.fn(), view: vi.fn().mockRejectedValue(new Error('boom')) }) as never,
      'a',
      after,
    );
    await expect(m.whoami()).rejects.toThrow('boom');
    expect(after).toHaveBeenCalledTimes(1);
  });
});
