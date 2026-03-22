import { getAppEndpointKey, getAuthConfig } from '@calimero-network/calimero-client';

const DEFAULT_NODE_ENDPOINT = 'http://localhost:2428';
export const DEFAULT_CONTEXT_PROTOCOL = 'near';

export type AdminErrorKind = 'transport' | 'auth' | 'validation' | 'server' | 'unknown';

export class AdminApiError extends Error {
  readonly status: number | null;
  readonly kind: AdminErrorKind;
  readonly details?: unknown;

  constructor(message: string, status: number | null, kind: AdminErrorKind, details?: unknown) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.kind = kind;
    this.details = details;
  }
}

type AdminRequestOptions = Omit<RequestInit, 'headers' | 'body'> & {
  headers?: Record<string, string>;
  body?: unknown;
};

export function getNodeEndpoint(): string {
  return (getAppEndpointKey() || DEFAULT_NODE_ENDPOINT).replace(/\/+$/, '');
}

export function getAdminHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const authConfig = getAuthConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  if (authConfig?.jwtToken) {
    headers.Authorization = `Bearer ${authConfig.jwtToken}`;
  }

  return headers;
}

export function encodeInitializationParams(value: unknown): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)));
}

function classifyError(status: number | null): AdminErrorKind {
  if (status === null) {
    return 'transport';
  }
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status >= 400 && status < 500) {
    return 'validation';
  }
  if (status >= 500) {
    return 'server';
  }
  return 'unknown';
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const typedPayload = payload as { error?: unknown; message?: unknown };

  if (typeof typedPayload.error === 'string' && typedPayload.error.trim()) {
    return typedPayload.error;
  }

  if (typeof typedPayload.message === 'string' && typedPayload.message.trim()) {
    return typedPayload.message;
  }

  return fallback;
}

export async function adminRequest<T>(
  path: string,
  options: AdminRequestOptions = {},
): Promise<T> {
  const { body, headers, ...init } = options;
  const response = await fetch(`${getNodeEndpoint()}/admin-api${path}`, {
    ...init,
    headers: getAdminHeaders(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((error) => {
    throw new AdminApiError(
      error instanceof Error ? error.message : 'Failed to reach the Calimero node.',
      null,
      'transport',
      error,
    );
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new AdminApiError(
      extractErrorMessage(payload, response.statusText || 'Admin API request failed'),
      response.status,
      classifyError(response.status),
      payload,
    );
  }

  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}

/**
 * Like {@link adminRequest} but returns the full JSON body without
 * unwrapping the `data` field.  Use when the response contains
 * sibling fields (e.g. `selfIdentity`) alongside `data`.
 */
export async function adminRequestFull<T>(
  path: string,
  options: AdminRequestOptions = {},
): Promise<T> {
  const { body, headers, ...init } = options;
  const response = await fetch(`${getNodeEndpoint()}/admin-api${path}`, {
    ...init,
    headers: getAdminHeaders(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((error) => {
    throw new AdminApiError(
      error instanceof Error ? error.message : 'Failed to reach the Calimero node.',
      null,
      'transport',
      error,
    );
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new AdminApiError(
      extractErrorMessage(payload, response.statusText || 'Admin API request failed'),
      response.status,
      classifyError(response.status),
      payload,
    );
  }

  return payload as T;
}

type CreateGroupContextPayload = {
  applicationId: string;
  protocol: string;
  alias?: string;
  initializationParams: number[];
};

/**
 * Prefer group-scoped context creation when available.
 * Falls back to legacy /contexts endpoint for older nodes.
 */
export async function createContextForGroup(
  groupId: string,
  payload: CreateGroupContextPayload,
): Promise<{ contextId: string }> {
  try {
    return await adminRequest<{ contextId: string }>(`/groups/${groupId}/contexts`, {
      method: 'POST',
      body: payload,
    });
  } catch (error) {
    if (
      error instanceof AdminApiError &&
      (error.status === 404 || error.status === 405 || error.status === 501)
    ) {
      return adminRequest<{ contextId: string }>('/contexts', {
        method: 'POST',
        body: {
          ...payload,
          groupId,
        },
      });
    }
    throw error;
  }
}
