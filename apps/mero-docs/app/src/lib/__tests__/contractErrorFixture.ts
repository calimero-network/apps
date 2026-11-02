import { AppError, UnavailableError, errorFrom } from '@calimero-network/mero-js';

/** The error mero-js throws for the contract's own refusal: `422 APP_ERROR`, its code and `message`. */
export function contractErrorFixture(code: string, message: string): Error {
  return new AppError('the app refused the call', { code, fields: { message } });
}

const CODES: Record<number, string> = {
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'ARGS_TOO_LARGE',
  500: 'INTERNAL',
};

/** The error mero-js throws for a node's answer with `status`; 0 is no answer at all. */
export function nodeError(status: number): Error {
  if (status === 0) return new UnavailableError('NETWORK', 'fetch failed');
  return errorFrom(status, { error: CODES[status] ?? 'ERROR', message: 'refused' });
}
