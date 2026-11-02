// A refused contract call reaches the client as an `AppError` (422 APP_ERROR):
// the contract's error code (`NotFound`, `Invalid`, `Forbidden`) and its
// `message` field. v1 carried the same `{ kind, data }` inside the RPC
// error's text; the shape callers read is kept.

import { appErrorOf } from '@/calimero/errors';

const KINDS = ['NotFound', 'Invalid', 'Forbidden', 'AlreadyExists', 'Conflict', 'Internal'] as const;

export type ContractErrorKind = (typeof KINDS)[number];
export interface ContractError {
  kind: ContractErrorKind;
  data: string;
}

/** The contract's refusal carried by `err`, or null when `err` is anything else. */
export function parseContractError(err: unknown): ContractError | null {
  const app = appErrorOf(err);
  if (!app || !KINDS.includes(app.code as ContractErrorKind)) return null;
  return { kind: app.code as ContractErrorKind, data: app.message };
}
