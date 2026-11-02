import { beforeEach, describe, expect, it } from 'vitest';

import { ClientApiDataSource, errorOf, toContextDetails, toDocumentInfo } from './ClientApiDataSource';
import { fakeConn } from '../../test/fakeClient';

const HASH = 'ab'.repeat(32);

describe('the adapter converts the component answers to the screens shapes', () => {
  it('documents: snake_case, numbers, milliseconds', () => {
    expect(
      toDocumentInfo({
        id: 'doc_1',
        name: 'nda.pdf',
        hash: HASH,
        uploadedBy: 'acct-a',
        uploadedAt: '1700000000000',
        status: 'PartiallySigned',
        pdfBlobId: HASH,
        size: '2048',
        requiredSigners: ['acct-a'],
        originalHash: HASH,
      }),
    ).toEqual({
      id: 'doc_1',
      name: 'nda.pdf',
      hash: HASH,
      uploaded_by: 'acct-a',
      uploaded_at: 1_700_000_000_000,
      status: 'PartiallySigned',
      pdf_blob_id: HASH,
      size: 2048,
    });
  });

  it('details: counts as numbers, participants as rows', () => {
    const d = toContextDetails({
      contextId: 'app-1',
      contextName: 'NDA',
      owner: 'acct-a',
      isPrivate: false,
      participantCount: '2',
      participants: [
        { userId: 'acct-a', permissionLevel: 'Admin' },
        { userId: 'acct-b', permissionLevel: 'Read' },
      ],
      documentCount: '1',
      createdAt: '5',
    });
    expect(d.participant_count).toBe(2);
    expect(d.document_count).toBe(1);
    expect(d.participants[1]).toEqual({ user_id: 'acct-b', permission_level: 'Read' });
  });

  it("errors: the contract's message, else the client's description", () => {
    expect(errorOf({ appCode: 'Forbidden', fields: { message: 'Admin permissions required' } })).toEqual({
      code: 'Forbidden',
      message: 'Admin permissions required',
    });
    expect(errorOf(new Error('offline')).message).toContain('offline');
  });
});

describe('ClientApiDataSource', () => {
  let library: string[];
  beforeEach(() => {
    library = [];
  });

  it('follows the pages of a list into one answer', async () => {
    const conn = fakeConn({
      listDocuments: (args: Record<string, unknown>) =>
        args.cursor
          ? { items: [], next: null }
          : {
              items: [
                {
                  id: 'doc_1',
                  name: 'a',
                  hash: HASH,
                  uploadedBy: 'x',
                  uploadedAt: '1',
                  status: 'Pending',
                  pdfBlobId: HASH,
                  size: '1',
                  requiredSigners: [],
                  originalHash: HASH,
                },
              ],
              next: 'c2',
            },
    });
    const api = new ClientApiDataSource(conn);
    const res = await api.listDocuments('app-1');
    expect(res.error).toBeNull();
    expect(res.data?.map((d) => d.id)).toEqual(['doc_1']);
    expect(conn.fake.view).toHaveBeenCalledTimes(2);
  });

  it('signs through the passkey step-up, sizes as decimal strings', async () => {
    const conn = fakeConn({ signDocument: null });
    const api = new ClientApiDataSource(conn);
    const res = await api.signDocument('app-1', 'doc_1', 'old', HASH, 10, HASH, 'app-1');
    expect(res.error).toBeNull();
    expect(conn.fake.callConfirmed).toHaveBeenCalledWith(
      'app-1',
      'signDocument',
      { documentId: 'doc_1', baseHash: 'old', pdfBlobIdStr: HASH, fileSize: '10', newHash: HASH },
      expect.anything(),
    );
  });

  it('turns a refusal into an error envelope, never an empty answer', async () => {
    const refusal = Object.assign(new Error('refused'), {
      appCode: 'Forbidden',
      fields: { message: 'You are not a participant in this agreement' },
    });
    const api = new ClientApiDataSource(fakeConn({ listDocuments: refusal }));
    const res = await api.listDocuments('app-1');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('You are not a participant in this agreement');
  });

  it('runs library methods in the personal library, made on first use', async () => {
    const conn = fakeConn({
      setup: (args: Record<string, unknown>, app: string) => {
        library.push(`${app}:${String(args.contextName)}`);
        return null;
      },
      listSignatures: { items: [{ id: '1', name: 'Initials', blobId: HASH, size: '3', createdAt: '7' }], next: null },
    });
    conn.fake.createApp.mockResolvedValue('app-library');
    const api = new ClientApiDataSource(conn);
    const res = await api.listSignatures();
    expect(res.data).toEqual([{ id: 1, name: 'Initials', blob_id: HASH, size: 3, created_at: 7 }]);
    expect(library).toEqual(['app-library:default']);
    expect(conn.fake.createApp).toHaveBeenCalledWith('Mero Sign library', 'bundle-hash', {});
    expect(conn.fake.view).toHaveBeenCalledWith('app-library', 'listSignatures', { limit: 1000 });
  });

  it('answers with an error when nobody is signed in', async () => {
    const res = await new ClientApiDataSource(null).listDocuments('app-1');
    expect(res.error?.message).toMatch(/Sign in/);
  });
});
