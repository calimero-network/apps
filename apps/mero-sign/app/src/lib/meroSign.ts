import type { CalimeroClient, PasskeyProvider } from '@calimero-network/mero-js';

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = 'com.calimero.mero-sign';

/**
 * The contract's methods by their ABI names (camelCase), split the way the node
 * runs them: a call goes through the app's log, a view is answered by a node
 * without writing. `meroSign.test.ts` asserts these lists, and the parameter
 * names each wrapper sends, are exactly the committed `logic/res/abi.json`'s.
 */
export const CALLS = [
  'setup',
  'createSignature',
  'deleteSignature',
  'joinSharedContext',
  'leaveSharedContext',
  'registerSelfAsParticipant',
  'addParticipant',
  'removeParticipant',
  'setParticipantPermission',
  'uploadDocument',
  'deleteDocument',
  'setConsent',
  'signDocument',
] as const;

export const VIEWS = [
  'isDefaultPrivateContext',
  'listSignatures',
  'listJoinedContexts',
  'getContextDetails',
  'whoami',
  'listParticipants',
  'getUserPermission',
  'getContextId',
  'listDocuments',
  'hasConsented',
  'getDocumentStatus',
  'getDocumentSignatures',
  'markParticipantSigned',
  'documentDownload',
  'searchDocumentByEmbedding',
] as const;

/** Calls that need a passkey confirmation (`#[app::confirm]`). */
export const CONFIRMED: ReadonlySet<string> = new Set(['signDocument']);

export type Level = 'Read' | 'Sign' | 'Admin';
export type Status = 'Pending' | 'PartiallySigned' | 'FullySigned';

/** One page of a growing list; `next` is the cursor of the following page. */
export interface Page<T> {
  items: T[];
  next: string | null;
}

// ── the answers as the wire carries them (u64 as decimal strings) ──────────

export interface WireSignature {
  id: string;
  name: string;
  blobId: string;
  size: string;
  createdAt: string;
}

export interface WireJoined {
  contextId: string;
  contextName: string;
  role: string;
  joinedAt: string;
}

export interface WireDetails {
  contextId: string;
  contextName: string;
  owner: string;
  isPrivate: boolean;
  participantCount: string;
  participants: Array<{ userId: string; permissionLevel: Level }>;
  documentCount: string;
  createdAt: string;
}

export interface WireDocument {
  id: string;
  name: string;
  hash: string;
  uploadedBy: string;
  uploadedAt: string;
  status: Status;
  pdfBlobId: string;
  size: string;
  requiredSigners: string[];
  originalHash: string;
}

export interface WireDocumentState {
  status: Status;
  hash: string;
  signatures: string;
}

export interface WireDownload {
  blobId: string;
  hash: string;
  size: string;
  grant: string;
}

export interface WireChunk {
  text: string;
  embedding: number[];
  startPosition: number;
  endPosition: number;
}

export interface UploadArgs {
  name: string;
  hash: string;
  pdfBlobIdStr: string;
  fileSize: string;
  embeddings?: number[] | null;
  extractedText?: string | null;
  chunks?: WireChunk[] | null;
}

export interface SignArgs {
  documentId: string;
  baseHash: string;
  pdfBlobIdStr: string;
  fileSize: string;
  newHash: string;
}

export interface MeroSign {
  setup(isPrivate: boolean, contextName: string): Promise<null>;
  isDefaultPrivateContext(): Promise<boolean>;
  createSignature(name: string, blobIdStr: string, dataSize: string): Promise<string>;
  deleteSignature(signatureId: string): Promise<null>;
  listSignatures(cursor?: string | null, limit?: number): Promise<Page<WireSignature>>;
  joinSharedContext(contextIdStr: string, contextName: string): Promise<null>;
  leaveSharedContext(contextIdStr: string): Promise<null>;
  listJoinedContexts(cursor?: string | null, limit?: number): Promise<Page<WireJoined>>;
  getContextDetails(): Promise<WireDetails>;
  whoami(): Promise<string>;
  listParticipants(): Promise<string[]>;
  getUserPermission(userIdStr: string): Promise<Level>;
  getContextId(): Promise<string>;
  registerSelfAsParticipant(): Promise<null>;
  addParticipant(userIdStr: string, permission: Level): Promise<null>;
  removeParticipant(userIdStr: string): Promise<null>;
  setParticipantPermission(userIdStr: string, permission: Level): Promise<null>;
  uploadDocument(args: UploadArgs): Promise<string>;
  deleteDocument(documentId: string): Promise<null>;
  listDocuments(cursor?: string | null, limit?: number): Promise<Page<WireDocument>>;
  setConsent(documentId: string): Promise<null>;
  hasConsented(userIdStr: string, documentId: string): Promise<boolean>;
  /** A passkey step-up: the node answers 412 and `passkey` approves this exact call. */
  signDocument(args: SignArgs): Promise<null>;
  getDocumentStatus(documentId: string): Promise<WireDocumentState>;
  getDocumentSignatures(documentId: string): Promise<Array<{ signer: string; signedAt: string }>>;
  markParticipantSigned(documentId: string): Promise<null>;
  documentDownload(documentId: string): Promise<WireDownload>;
  searchDocumentByEmbedding(queryEmbedding: number[], documentId: string): Promise<string>;
}

type Transport = Pick<CalimeroClient, 'call' | 'view' | 'callConfirmed'>;
type Args = Record<string, unknown>;

/** Drops `undefined` members: the contract refuses unknown keys, not absent ones. */
function defined(args: Args): Args {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
}

/**
 * The contract at instance `app` through `client`. `after` runs after every
 * request (the session store syncs a refreshed session there); `passkey`
 * answers the signing call's confirmation.
 */
export function meroSign(
  client: Transport,
  app: string,
  passkey: () => PasskeyProvider,
  after: () => void = () => {},
): MeroSign {
  const call = async <T>(method: (typeof CALLS)[number], args: Args = {}): Promise<T> => {
    try {
      const sent = defined(args);
      const res = CONFIRMED.has(method)
        ? await client.callConfirmed(app, method, sent, passkey())
        : await client.call(app, method, sent);
      return res.result as T;
    } finally {
      after();
    }
  };
  const view = async <T>(method: (typeof VIEWS)[number], args: Args = {}): Promise<T> => {
    try {
      return (await client.view(app, method, defined(args))).result as T;
    } finally {
      after();
    }
  };
  const page = (cursor?: string | null, limit?: number) => ({
    cursor: cursor ?? undefined,
    limit,
  });
  return {
    setup: (isPrivate, contextName) => call('setup', { isPrivate, contextName }),
    isDefaultPrivateContext: () => view('isDefaultPrivateContext'),
    createSignature: (name, blobIdStr, dataSize) =>
      call('createSignature', { name, blobIdStr, dataSize }),
    deleteSignature: (signatureId) => call('deleteSignature', { signatureId }),
    listSignatures: (cursor, limit) => view('listSignatures', page(cursor, limit)),
    joinSharedContext: (contextIdStr, contextName) =>
      call('joinSharedContext', { contextIdStr, contextName }),
    leaveSharedContext: (contextIdStr) => call('leaveSharedContext', { contextIdStr }),
    listJoinedContexts: (cursor, limit) => view('listJoinedContexts', page(cursor, limit)),
    getContextDetails: () => view('getContextDetails'),
    whoami: () => view('whoami'),
    listParticipants: () => view('listParticipants'),
    getUserPermission: (userIdStr) => view('getUserPermission', { userIdStr }),
    getContextId: () => view('getContextId'),
    registerSelfAsParticipant: () => call('registerSelfAsParticipant'),
    addParticipant: (userIdStr, permission) => call('addParticipant', { userIdStr, permission }),
    removeParticipant: (userIdStr) => call('removeParticipant', { userIdStr }),
    setParticipantPermission: (userIdStr, permission) =>
      call('setParticipantPermission', { userIdStr, permission }),
    uploadDocument: (args) => call('uploadDocument', { ...args }),
    deleteDocument: (documentId) => call('deleteDocument', { documentId }),
    listDocuments: (cursor, limit) => view('listDocuments', page(cursor, limit)),
    setConsent: (documentId) => call('setConsent', { documentId }),
    hasConsented: (userIdStr, documentId) => view('hasConsented', { userIdStr, documentId }),
    signDocument: (args) => call('signDocument', { ...args }),
    getDocumentStatus: (documentId) => view('getDocumentStatus', { documentId }),
    getDocumentSignatures: (documentId) => view('getDocumentSignatures', { documentId }),
    markParticipantSigned: (documentId) => view('markParticipantSigned', { documentId }),
    documentDownload: (documentId) => view('documentDownload', { documentId }),
    searchDocumentByEmbedding: (queryEmbedding, documentId) =>
      view('searchDocumentByEmbedding', { queryEmbedding, documentId }),
  };
}

/**
 * Every item of a paged list, following `next`. For the screens that show a
 * whole list (a library, an agreement's documents): the contract answers one
 * page at a time, and this asks for the next until there is none.
 */
export async function allPages<T>(
  read: (cursor: string | null) => Promise<Page<T>>,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i += 1) {
    const page: Page<T> = await read(cursor);
    out.push(...page.items);
    if (!page.next) break;
    cursor = page.next;
  }
  return out;
}
