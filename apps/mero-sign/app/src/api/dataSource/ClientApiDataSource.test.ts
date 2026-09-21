// ── The translation layer, and the four defects it removes ──────────────────
//
// `ClientApiDataSource` no longer writes RPC by hand: every call goes through
// the generated `MeroSignClient`, and this file's job is what is left — WHICH
// context a call runs in, and turning the ABI's types into the app's.
//
// ⚠️ These tests assert the EXACT ARGUMENT OBJECT handed to the client, not
// merely that a method was reached. Three of the four bugs recorded at the top
// of `ClientApiDataSource.ts` were argument bugs that a "was it called" test
// passes straight through: a misspelled key, an `undefined` that
// `JSON.stringify` drops, and an id in the wrong encoding.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import bs58 from 'bs58';

const calls: Array<{ method: string; args: unknown }> = [];
let contextsSeen: string[] = [];
let nextResult: unknown = undefined;
let nextThrow: unknown = null;

// One recording double standing in for the whole generated client. Every
// method records its name and its argument object and answers `nextResult`.
const client = new Proxy(
  {},
  {
    get(_t, method: string) {
      return (args: unknown) => {
        calls.push({ method, args });
        if (nextThrow) throw nextThrow;
        return Promise.resolve(nextResult);
      };
    },
  },
);

vi.mock('../../lib/signClient', () => ({
  clientFor: (contextId: string) => {
    contextsSeen.push(contextId);
    return client;
  },
}));

vi.mock('../../lib/node', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/node')>('../../lib/node');
  return { ...actual, getContextId: () => STORED_CONTEXT };
});

const STORED_CONTEXT = 'c'.repeat(64);
const OTHER_CONTEXT = 'd'.repeat(64);

const BYTES = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const HEX = Array.from(BYTES)
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');

import { ClientApiDataSource } from './ClientApiDataSource';

let api: ClientApiDataSource;

// The suite runs on `environment: 'node'`, which has no `localStorage`; the
// app reads the private context id out of it.
let store: Record<string, string> = {};

beforeEach(() => {
  calls.length = 0;
  contextsSeen = [];
  nextResult = undefined;
  nextThrow = null;
  api = new ClientApiDataSource();
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  });
});

describe('the argument names the contract actually takes', () => {
  it('leaveSharedContext sends `context_id_str`, never `context_id`', async () => {
    // ⚠️ THE REGRESSION. It sent `{context_id}`, which the ABI has never had.
    // Every core request body is `deny_unknown_fields`, so leaving a shared
    // agreement answered 400 every single time it was called. Its one caller
    // is commented out, which is the only reason nobody reported it.
    localStorage.setItem('defaultContextId', STORED_CONTEXT);
    await api.leaveSharedContext(OTHER_CONTEXT);

    expect(calls).toEqual([
      { method: 'leaveSharedContext', args: { context_id_str: OTHER_CONTEXT } },
    ]);
  });

  it('uploadDocument sends explicit nulls, never undefined', async () => {
    // ⚠️ `JSON.stringify` DROPS an undefined value. Passing `undefined` for the
    // three optional arguments made the contract see three MISSING fields
    // rather than three absent values.
    nextResult = 'doc-1';
    await api.uploadDocument(
      STORED_CONTEXT,
      'Lease.pdf',
      'deadbeef',
      HEX,
      1024,
    );

    expect(calls[0].args).toEqual({
      name: 'Lease.pdf',
      hash: 'deadbeef',
      pdf_blob_id_str: HEX,
      file_size: 1024,
      embeddings: null,
      extracted_text: null,
      chunks: null,
    });
    // The assertion that matters is that the keys EXIST with a null value —
    // `toEqual` alone treats a missing key and an undefined one as equal.
    expect(Object.keys(calls[0].args as object)).toContain('embeddings');
    expect(JSON.parse(JSON.stringify(calls[0].args))).toHaveProperty(
      'extracted_text',
      null,
    );
  });

  it('deleteDocument takes the DOCUMENT id first', async () => {
    // The `ClientApi` interface used to declare `(contextId, documentId, …)`
    // while the implementation took `(documentId, …)`. Both are strings, so
    // the disagreement type-checked and only the argument ORDER revealed it.
    await api.deleteDocument('doc-7', STORED_CONTEXT);
    expect(calls[0]).toEqual({
      method: 'deleteDocument',
      args: { document_id: 'doc-7' },
    });
  });
});

describe('ids come back as hex, never base58', () => {
  it('getContextDetails hex-encodes the context id, owner and roster', async () => {
    // ⚠️ THE REGRESSION. This ran every id through `bs58.encode`, under a
    // comment claiming the contract wanted it. Core 0.11.0-rc.27 removed
    // base58 from the wire — the contract's `parse_public_key_hex` decodes
    // hex — so every id this returned was in an encoding the contract rejects,
    // rendered into the UI and copied out of it by hand.
    nextResult = {
      context_id: [...BYTES],
      context_name: 'Lease',
      owner: [...BYTES],
      is_private: false,
      participant_count: 1,
      participants: [{ user_id: [...BYTES], permission_level: 'Admin' }],
      document_count: 0,
      created_at: 1,
    };

    const res = await api.getContextDetails(STORED_CONTEXT);

    expect(res.error).toBeNull();
    expect(res.data?.context_id).toBe(HEX);
    expect(res.data?.owner).toBe(HEX);
    expect(res.data?.participants[0].user_id).toBe(HEX);
    // The specific thing that was wrong, named so a reintroduction is obvious.
    expect(res.data?.context_id).not.toBe(bs58.encode(BYTES));
  });

  it('listJoinedContexts hex-encodes both identities', async () => {
    nextResult = [
      {
        context_id: [...BYTES],
        context_name: 'Lease',
        role: 'Owner',
        joined_at: 2,
        private_identity: [...BYTES],
        shared_identity: [...BYTES],
      },
    ];
    localStorage.setItem('defaultContextId', STORED_CONTEXT);

    const res = await api.listJoinedContexts();

    expect(res.data?.[0].context_id).toBe(HEX);
    expect(res.data?.[0].private_identity).toBe(HEX);
    expect(res.data?.[0].shared_identity).toBe(HEX);
  });

  it('listDocuments hex-encodes the blob id the node is asked for', async () => {
    nextResult = [
      {
        id: 'doc-1',
        name: 'Lease.pdf',
        hash: 'h',
        uploaded_by: [...BYTES],
        uploaded_at: 3,
        status: 'Pending',
        pdf_blob_id: [...BYTES],
        size: 10,
        embeddings: null,
        extracted_text: null,
        chunks: null,
      },
    ];

    const res = await api.listDocuments(STORED_CONTEXT);

    // A blob id is what `GET /admin-api/blobs/:id` is called with; base58 here
    // is the "Failed to decode blob ID (expected hex)" the user reported.
    expect(res.data?.[0].pdf_blob_id).toBe(HEX);
    expect(res.data?.[0].uploaded_by).toBe(HEX);
    // `null` from the contract is `undefined` in the app's optional fields.
    expect(res.data?.[0].embeddings).toBeUndefined();
  });

  it('whoami returns the account as hex', async () => {
    nextResult = [...BYTES];
    const res = await api.whoami(STORED_CONTEXT);
    expect(res.data).toBe(HEX);
  });
});

describe('which context a call runs in', () => {
  it('prefers the agreement context over the stored one', async () => {
    await api.setConsent('doc-1', OTHER_CONTEXT);
    expect(contextsSeen).toEqual([OTHER_CONTEXT]);
  });

  it('falls back to the stored context', async () => {
    await api.setConsent('doc-1');
    expect(contextsSeen).toEqual([STORED_CONTEXT]);
  });

  it('runs the signature surface in the PRIVATE context', async () => {
    // Signatures live in this node's own context, not in the agreement — the
    // bug this replaced passed the whole context RECORD here and the node
    // answered `invalid type: map, expected a hex encoded hash`.
    const privateId = 'a'.repeat(64);
    localStorage.setItem('defaultContextId', privateId);
    nextResult = [];

    await api.listSignatures();

    expect(contextsSeen).toEqual([privateId]);
  });

  it('answers in words when there is no private context, rather than calling', async () => {
    const res = await api.listSignatures();
    expect(calls).toEqual([]);
    expect(res.error?.code).toBe(409);
    expect(res.error?.message).toMatch(/not ready on this node yet/);
  });
});

describe('a failure reports the node, not this repo', () => {
  it('surfaces the message the node sent', async () => {
    nextThrow = new Error('rpc sign_document: not a participant');
    const res = await api.signDocument(STORED_CONTEXT, 'doc-1', HEX, 1, 'hash');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('rpc sign_document: not a participant');
  });

  it('keeps a message that arrived as a bare string', async () => {
    // ⚠️ NOT `instanceof Error`. A rejected RPC arrives as a plain object or a
    // string as often as an Error, and an instanceof test replaced exactly the
    // reason the caller needed with a generic sentence.
    nextThrow = 'context not found';
    const res = await api.listDocuments(STORED_CONTEXT);
    expect(res.error?.message).toBe('context not found');
  });

  it("translates core's Uninitialized into retry advice", async () => {
    nextThrow = { type: 'Uninitialized' };
    const res = await api.listDocuments(STORED_CONTEXT);
    expect(res.error?.message).toMatch(/wait and retry/i);
  });

  it('names the action when the failure carries no message at all', async () => {
    nextThrow = {};
    const res = await api.listDocuments(STORED_CONTEXT);
    expect(res.error?.message).toBe('Could not list the documents.');
  });
});
