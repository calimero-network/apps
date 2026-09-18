// Fixture data for the screenshot harness. Kept in step with ../shots.mjs by
// hand — that driver is plain node and this is TypeScript, so importing it
// would need a loader hook for a list of string literals.
import { PermissionLevel } from '../../src/api/clientApi';

export const ALICE = 'a0'.repeat(32);
export const BOB = 'b0'.repeat(32);
export const CARE = 'c0'.repeat(32);

export type ScenarioId =
  | 'landing'
  | 'agreements'
  | 'agreements-empty'
  | 'agreements-error'
  | 'documents'
  | 'documents-empty'
  | 'documents-upload'
  | 'people'
  | 'people-member'
  | 'invite'
  | 'invite-minted'
  | 'signatures'
  | 'signatures-empty'
  | 'signatures-delete'
  | 'connect'
  | 'not-found';

export interface Scenario {
  id: ScenarioId;
  path: string;
  authed: boolean;
  agreements: 'some' | 'none' | 'error';
  documents: 'mixed' | 'none';
  /** Whose eyes: an admin sees the role controls, a signer does not. */
  me: 'admin' | 'member';
  /** A modal or minted state to force open. */
  open?: 'upload' | 'delete-signature' | 'invite';
  signatures: 'some' | 'none';
  tab?: 'documents' | 'people' | 'invite';
}

const base: Omit<Scenario, 'id' | 'path'> = {
  authed: true,
  agreements: 'some',
  documents: 'mixed',
  me: 'admin',
  signatures: 'some',
};

export const SCENARIOS: Scenario[] = [
  { ...base, id: 'landing', path: '/landing', authed: false },
  { ...base, id: 'agreements', path: '/agreements' },
  { ...base, id: 'agreements-empty', path: '/agreements', agreements: 'none' },
  { ...base, id: 'agreements-error', path: '/agreements', agreements: 'error' },
  { ...base, id: 'documents', path: '/agreements/ctx-1', tab: 'documents' },
  {
    ...base,
    id: 'documents-empty',
    path: '/agreements/ctx-1',
    tab: 'documents',
    documents: 'none',
  },
  {
    ...base,
    id: 'documents-upload',
    path: '/agreements/ctx-1',
    tab: 'documents',
    open: 'upload',
  },
  { ...base, id: 'people', path: '/agreements/ctx-1', tab: 'people' },
  {
    ...base,
    id: 'people-member',
    path: '/agreements/ctx-1',
    tab: 'people',
    me: 'member',
  },
  { ...base, id: 'invite', path: '/agreements/ctx-1', tab: 'invite' },
  {
    ...base,
    id: 'invite-minted',
    path: '/agreements/ctx-1',
    tab: 'invite',
    open: 'invite',
  },
  { ...base, id: 'signatures', path: '/signatures' },
  { ...base, id: 'signatures-empty', path: '/signatures', signatures: 'none' },
  {
    ...base,
    id: 'signatures-delete',
    path: '/signatures',
    open: 'delete-signature',
  },
  { ...base, id: 'connect', path: '/agreements', authed: false },
  { ...base, id: 'not-found', path: '/nope/nowhere', authed: true },
];

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[1];
}

export const current: Scenario = scenarioById(
  new URLSearchParams(location.search).get('s') ?? 'agreements',
);

export const AGREEMENTS = [
  {
    id: 'ctx-1',
    name: 'NDA with Acme',
    contextId: 'ctx-1',
    memberPublicKey: ALICE,
    role: 'Admin',
    joinedAt: 1,
    privateIdentity: ALICE,
    sharedIdentity: ALICE,
  },
  {
    id: 'ctx-2',
    name: 'Series A term sheet',
    contextId: 'ctx-2',
    memberPublicKey: ALICE,
    role: 'Signer',
    joinedAt: 2,
    privateIdentity: ALICE,
    sharedIdentity: ALICE,
  },
  {
    id: 'ctx-3',
    name: 'Contractor agreement — R. Patel',
    contextId: 'ctx-3',
    memberPublicKey: ALICE,
    role: 'Signer',
    joinedAt: 3,
    privateIdentity: ALICE,
    sharedIdentity: ALICE,
  },
  {
    id: 'ctx-4',
    name: 'Office sublease 2026',
    contextId: 'ctx-4',
    memberPublicKey: ALICE,
    role: 'Admin',
    joinedAt: 4,
    privateIdentity: ALICE,
    sharedIdentity: ALICE,
  },
];

export const DOCUMENTS = [
  {
    id: 'doc-1',
    name: 'nda-acme-2026.pdf',
    size: '184 KB',
    uploadedAt: '12 Mar',
    status: 'FullySigned',
    uploadedBy: ALICE,
    hash: 'deadbeef',
    pdfBlobId: 'blob-1',
  },
  {
    id: 'doc-2',
    name: 'schedule-a.pdf',
    size: '42 KB',
    uploadedAt: '12 Mar',
    status: 'PartiallySigned',
    uploadedBy: ALICE,
    hash: 'deadbeef',
    pdfBlobId: 'blob-2',
  },
  {
    id: 'doc-3',
    name: 'side-letter.pdf',
    size: '18 KB',
    uploadedAt: '14 Mar',
    status: 'Pending',
    uploadedBy: BOB,
    hash: 'deadbeef',
    pdfBlobId: 'blob-3',
  },
];

export const PARTICIPANTS = [
  { user_id: ALICE, permission_level: PermissionLevel.Admin },
  { user_id: BOB, permission_level: PermissionLevel.Sign },
  { user_id: CARE, permission_level: PermissionLevel.Read },
];

export const CONTEXT_DETAILS = {
  context_id: 'ctx-1',
  context_name: 'NDA with Acme',
  owner: ALICE,
  is_private: false,
  participant_count: PARTICIPANTS.length,
  participants: PARTICIPANTS,
  document_count: DOCUMENTS.length,
  created_at: 0,
};

/** A drawn squiggle, so a signature card shows something shaped like a
 *  signature rather than a coloured rectangle standing in for one. */
const PIXEL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 70">' +
      '<path d="M8 50 C 40 8, 58 62, 84 36 S 126 6, 150 40 C 166 62, 186 30, 212 22" ' +
      'fill="none" stroke="#131215" stroke-width="3.5" stroke-linecap="round"/>' +
      '</svg>',
  );

export const SIGNATURE_ROWS = [
  {
    id: 1,
    name: 'Signature 1',
    blob_id: 'blob-sig-1',
    created_at: 1_700_000_000_000_000_000,
  },
  {
    id: 2,
    name: 'Signature 2',
    blob_id: 'blob-sig-2',
    created_at: 1_700_600_000_000_000_000,
  },
];

export const SIGNATURE_PNG = PIXEL;
