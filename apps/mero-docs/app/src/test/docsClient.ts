// The real `MeroDocsClient` over a fake transport, for hook and screen tests.
import { withRoutes } from '@calimero-apps/connect/testing';

import { MeroDocsClient } from '@/generated/client';
import type { DocDto, DocSearchPage } from '@/lib/docsApi';

const made = new WeakMap<object, Map<string, MeroDocsClient>>();

/**
 * A `MeroDocsClient` for instance `app` whose every call and view is answered
 * by `fake`'s method of the same (ABI) name, given the ABI's arguments: what a
 * fake returns is the wire's answer, and what it throws is the node's refusal.
 * The same `fake` and `app` give the same client, so a hook that keys effects
 * on its client sees a stable one.
 */
export function docsOver(fake: object, app = 'ctx'): MeroDocsClient {
  let byApp = made.get(fake);
  if (!byApp) made.set(fake, (byApp = new Map()));
  let client = byApp.get(app);
  if (!client) {
    const answer = async (_app: string, method: string, args: unknown) => {
      const fn = (fake as Record<string, unknown>)[method];
      if (typeof fn !== 'function')
        throw new Error(`the fake client has no ${method}`);
      const result = await (fn as (a: unknown) => unknown).call(fake, args);
      return { index: 1, result: result ?? null, events: [] };
    };
    client = new MeroDocsClient(
      withRoutes({ call: answer, view: answer }),
      app,
    );
    byApp.set(app, client);
  }
  return client;
}

/** A v1 `DocDto` (nanoseconds) as the contract answers it: camelCase, milliseconds as decimal strings. */
export function wireDoc(
  d: Partial<DocDto> & { id: string },
): Record<string, unknown> {
  const ms = (ns: number | undefined) =>
    String(Math.round((ns ?? 0) / 1_000_000));
  return {
    id: d.id,
    title: d.title ?? '',
    tags: d.tags ?? [],
    archived: d.archived ?? false,
    createdAt: ms(d.created_at),
    updatedAt: ms(d.updated_at),
    createdBy: d.created_by ?? '',
    updatedBy: d.updated_by ?? '',
    canDelete: d.can_delete ?? false,
  };
}

/** A v1 search page as the contract answers it (`nextCursor`). */
export function wireSearchPage(page: DocSearchPage): Record<string, unknown> {
  return { hits: page.hits, total: page.total, nextCursor: page.next_cursor };
}
