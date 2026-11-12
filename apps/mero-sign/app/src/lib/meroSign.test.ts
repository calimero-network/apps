import { describe, expect, it, vi } from 'vitest';

import { MeroSignClient, type ContextDetails, type DocumentInfo } from '../generated/client';
import {
  toContextDetails,
  toDocumentInfo,
  toDocuments,
  toNumber,
  toSignature,
  toWireChunk,
} from './meroSign';
import { withRoutes } from '@calimero-apps/connect/testing';

const HEX = 'ab'.repeat(32);

const WIRE_DOC: DocumentInfo = {
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

const WIRE_DETAILS: ContextDetails = {
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

describe('the adapter, over the generated client', () => {
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
    const m = new MeroSignClient(withRoutes({ call, view }), 'app-1', { after });

    expect(toNumber(await m.createSignature({ name: 's', blobIdStr: HEX, dataSize: String(10) }))).toBe(7);
    expect(call).toHaveBeenCalledWith('app-1', 'createSignature', {
      name: 's',
      blobIdStr: HEX,
      dataSize: '10',
    });
    await m.uploadDocument({
      name: 'n',
      hash: 'h',
      pdfBlobIdStr: HEX,
      fileSize: String(5),
      embeddings: [0.5],
      extractedText: 't',
      chunks: [{ text: 'c', embedding: [0.5], start_position: 0, end_position: 1 }].map(toWireChunk),
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
    const docs = toDocuments(await m.listDocuments());
    expect(view).toHaveBeenCalledWith('app-1', 'listDocuments', {});
    expect(docs[0]?.size).toBe(2048);
    expect(after).toHaveBeenCalledTimes(3);
  });

  it('runs `after` when a request fails too', async () => {
    const after = vi.fn();
    const m = new MeroSignClient(
      withRoutes({ call: vi.fn(), view: vi.fn().mockRejectedValue(new Error('boom')) }),
      'a',
      { after },
    );
    await expect(m.whoami()).rejects.toThrow('boom');
    expect(after).toHaveBeenCalledTimes(1);
  });
});
