// A refused contract call reaches the client as `{ kind, data }` (the contract's
// DriveError). Core puts that JSON into the RPC error's `data` behind this
// prefix: as text from rc.81 on, as a decimal byte list from older nodes.
const CORE_PREFIX = 'the method call returned an error: ';
const KINDS = ['NotFound', 'Invalid', 'Forbidden', 'AlreadyExists', 'Conflict', 'Internal'] as const;

export type ContractErrorKind = (typeof KINDS)[number];
export interface ContractError {
  kind: ContractErrorKind;
  data: string;
}

function isByteList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
  );
}

/** The JSON behind the prefix, whichever way core rendered it; null when it is not JSON. */
function parseMethodError(rest: string): unknown {
  try {
    const parsed: unknown = JSON.parse(rest);
    if (!isByteList(parsed)) return parsed;
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(parsed)));
  } catch {
    return null;
  }
}

/** The contract's refusal carried by `err`, or null when `err` is anything else. */
export function parseContractError(err: unknown): ContractError | null {
  const raw = (err as { data?: unknown } | null)?.data;
  if (typeof raw !== 'string' || !raw.startsWith(CORE_PREFIX)) return null;
  const body = parseMethodError(raw.slice(CORE_PREFIX.length));
  if (!body || typeof body !== 'object') return null;
  const { kind, data } = body as Partial<ContractError>;
  if (!KINDS.includes(kind as ContractErrorKind) || typeof data !== 'string') return null;
  return { kind: kind as ContractErrorKind, data };
}
