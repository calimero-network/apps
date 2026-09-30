// A refused contract call reaches the client as `{ kind, data }` (the contract's
// DriveError). Core renders those JSON bytes into the RPC error's `data` as a
// decimal list behind this prefix.
const CORE_PREFIX = 'the method call returned an error: ';
const KINDS = ['NotFound', 'Invalid', 'Forbidden', 'AlreadyExists', 'Conflict', 'Internal'] as const;

export type ContractErrorKind = (typeof KINDS)[number];
export interface ContractError {
  kind: ContractErrorKind;
  data: string;
}

/** The contract's refusal carried by `err`, or null when `err` is anything else. */
export function parseContractError(err: unknown): ContractError | null {
  const raw = (err as { data?: unknown } | null)?.data;
  if (typeof raw !== 'string' || !raw.startsWith(CORE_PREFIX)) return null;
  try {
    const bytes: unknown = JSON.parse(raw.slice(CORE_PREFIX.length));
    if (!Array.isArray(bytes)) return null;
    const body: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes as number[])));
    const { kind, data } = body as Partial<ContractError>;
    if (!KINDS.includes(kind as ContractErrorKind) || typeof data !== 'string') return null;
    return { kind: kind as ContractErrorKind, data };
  } catch {
    return null;
  }
}
