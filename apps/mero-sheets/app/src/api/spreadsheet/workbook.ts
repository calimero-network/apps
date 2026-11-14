/**
 * A workbook (an app instance) through `MeroSheetsClient`
 * (`src/generated/client.ts`, which `meroctl app codegen` writes from
 * `logic/res/abi.json`), plus what the contract cannot do itself.
 *
 * The hooks call the generated class with the contract's arguments
 * (camelCase; 64-bit integers, `size` and `since`, as the decimal strings
 * `u64` makes). The hooks read the answers as `./types` declares them (`read`):
 * v1's field names (snake_case, which the contract keeps) and numbers. `workbook`'s transport turns the 64-bit fields of every answer back
 * into numbers on the way (`fromWire`).
 *
 * It also relays linked ranges. Core 1.0.0-rc.7 has no cross-app call
 * (`xcall`) for components, so the contract cannot push a range to another
 * workbook itself. This browser does: it reads the range from this workbook
 * (`pushPublication`) and hands it to the target (`receiveLink`), when the
 * link is made (`publishRange`), on "push now" (`relay`), and after its own
 * edits to a linked sheet. The person relaying must be an editor in both
 * workbooks. A failed relay never fails the edit that triggered it.
 */
import { MeroSheetsClient, type AppTransport, type PublishRangeArgs } from '../../generated/client';
import type { Publication } from './types';

export * from './types';
export { MeroSheetsClient };

/** A linked range's current values, as the source workbook hands them out. */
export interface LinkPush {
  publication_id: string;
  /** The receiving workbook (app instance id). */
  target_context: string;
  name: string;
  source_name: string;
  rows: number;
  cols: number;
  values: string[];
}

/** Answer fields that are 64-bit integers: decimal strings on the wire. */
const U64_FIELDS = new Set(['created_at', 'updated_at', 'joined_at', 'at', 'last_edited_at', 'size']);

/** A 64-bit integer argument as the decimal string the contract takes. */
export function u64(n: number): string {
  return BigInt(Math.max(0, Math.trunc(n))).toString();
}

/** An answer with its 64-bit integer fields back as numbers, as v1 answered. */
export function fromWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromWire);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = U64_FIELDS.has(k) && typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : fromWire(v);
    }
    return out;
  }
  return value;
}

/**
 * An answer as `./types` declares it. The generated types are the wire's
 * (64-bit integers as decimal strings); this workbook's transport has already
 * turned those into numbers (`fromWire`), which is what the hooks read.
 */
export function read<T>(answer: Promise<unknown>): Promise<T> {
  return answer as Promise<T>;
}

/** The methods whose writes can change a sheet a link reads from. */
const EDITS = new Set(['setCell', 'setCellFormat', 'clearCell', 'applyCellOps', 'applyAxisOps']);

/** A workbook: its contract, and the link relay around it. */
export interface Workbook {
  /** The contract, every answer's 64-bit fields as numbers, linked sheets relayed after an edit. */
  sheets: MeroSheetsClient;
  /** This workbook's links out; remembered for the relay after an edit. */
  getPublications(): Promise<Publication[]>;
  /** Link a range to another workbook, and hand it its first values. */
  publishRange(args: PublishRangeArgs): Promise<string>;
  /** Hand one link's current values to its workbook ("push now"). Throws on failure. */
  relay(id: string): Promise<void>;
  /** Stop a link, and take its sheet out of the other workbook (best effort). */
  unpublish(id: string): Promise<void>;
}

/**
 * The workbook `app` through the signed-in `client`. `after` runs after every
 * request (keeps the stored session current).
 */
export function workbook(client: AppTransport, app: string, after?: () => void): Workbook {
  const options = after ? { after } : {};
  /** This workbook's links out, as last read; null until read. */
  let publications: Publication[] | null = null;

  const transport: AppTransport = {
    apps: {
      async call(request, callOptions) {
        const answer = await client.apps.call(request, callOptions);
        const sheetId = (request.args as { sheetId?: unknown } | undefined)?.sheetId;
        if (request.app === app && EDITS.has(request.method) && typeof sheetId === 'string') void relaySheet(sheetId);
        return { ...answer, result: fromWire(answer.result) };
      },
      async view(request, viewOptions) {
        const answer = await client.apps.view(request, viewOptions);
        return { ...answer, result: fromWire(answer.result) };
      },
    },
    events: (instance, from, signal) => client.events(instance, from, signal),
  };
  const sheets = new MeroSheetsClient(transport, app, options);
  /** Another workbook, for the relay's writes there. */
  const other = (target: string) => new MeroSheetsClient(client, target, options);

  async function getPublications(): Promise<Publication[]> {
    const pubs = await read<Publication[]>(sheets.getPublications());
    publications = pubs;
    return pubs;
  }

  async function relay(id: string): Promise<void> {
    const push = await read<LinkPush>(sheets.pushPublication({ id }));
    await other(push.target_context).receiveLink({
      fromContext: app,
      publicationId: push.publication_id,
      name: push.name,
      sourceName: push.source_name,
      rows: push.rows,
      cols: push.cols,
      values: push.values,
    });
  }

  /** Relay every link from `sheetId`, after an edit to it. Never throws. */
  async function relaySheet(sheetId: string): Promise<void> {
    try {
      const pubs = publications ?? (await getPublications());
      await Promise.all(pubs.filter((p) => p.sheet_id === sheetId).map((p) => relay(p.id).catch(() => {})));
    } catch {
      // The edit stands; the link catches up on the next edit or "push now".
    }
  }

  return {
    sheets,
    getPublications,
    async publishRange(args) {
      const id = (await sheets.publishRange(args)) as string;
      publications = null;
      await relay(id);
      return id;
    },
    relay,
    async unpublish(id) {
      const pub = (publications ?? (await getPublications())).find((p) => p.id === id);
      await sheets.unpublish({ id });
      publications = null;
      if (pub) {
        try {
          await other(pub.target_context).dropLink({ fromContext: app, publicationId: pub.id });
        } catch {
          // The other workbook is out of reach: its sheet stays until someone there unlinks it.
        }
      }
    },
  };
}
