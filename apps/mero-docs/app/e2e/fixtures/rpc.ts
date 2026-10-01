import type { Request } from '@playwright/test';

/** The app method of a JSON-RPC `execute` call, or null for any other request. */
export function rpcMethod(req: Request): string | null {
  try {
    const body = JSON.parse(req.postData() ?? '') as {
      params?: { method?: unknown };
    };
    return typeof body.params?.method === 'string' ? body.params.method : null;
  } catch {
    return null;
  }
}
