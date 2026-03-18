import {
  AbiClient,
  AbiEvent,
  Document,
  DocumentSummary,
} from '../../../api/AbiClient';
import { CalimeroApp } from '@calimero-network/calimero-client';

export { AbiClient };
export type { AbiEvent, Document, DocumentSummary };

export type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: number; message: string } };

export function isOk<T>(
  result: ApiResult<T>,
): result is { data: T; error: null } {
  return result.error === null;
}

export function createDocsClient(app: CalimeroApp): AbiClient {
  console.log('Creating Docs client');
  return new AbiClient(app);
}
