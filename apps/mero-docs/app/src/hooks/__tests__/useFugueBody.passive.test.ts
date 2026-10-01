// A reader that never types must never write, whatever order a peer's
// writes reach its node in, and must end on the node's document.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCreateBlockNote } from '@blocknote/react';
import type { DocsClient } from '@/generated/docs/DocsClient';
import { useFugueBody, type BodyEditor } from '../useFugueBody';
import { schema } from '@/components/editor/blocknote/schema';

let deliver: ((event: unknown) => void) | null = null;
const events = { on: () => {}, off: () => {} };
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: (_ids: string[], handler: (event: unknown) => void) => {
    deliver = handler;
  },
  useMero: () => ({ mero: { events } }),
}));

const DOC = 'doc-1';
const CTX = 'ctx-1';
const LEFT = { textAlignment: 'left' };

interface NodeBlock {
  id: string;
  kind: string;
  depth: number;
  attrs: Record<string, string>;
  spans: { text: string }[];
}

type Op =
  | { op: 'text'; block: string; text: string }
  | { op: 'insert'; block: string; after: string }
  | { op: 'attr'; block: string };

const INITIAL = ['intro', 'f1', 'f2', 'f3', 'c1'];
const INITIAL_TEXT: Record<string, string> = {
  intro: 'Intro',
  f1: 'Filler 1',
  f2: 'Filler 2',
  f3: 'Filler 3',
  c1: 'Closing',
};

/** Bob's writes for typing five lines at the start of Intro, in order. */
function bobOps(): Op[] {
  const ops: Op[] = [];
  let prev = 'intro';
  for (let k = 1; k <= 5; k++) {
    const next = `n${k}`;
    ops.push({ op: 'text', block: prev, text: `Bob line ${k}` });
    ops.push({ op: 'insert', block: next, after: prev });
    ops.push({ op: 'attr', block: next });
    ops.push({ op: 'text', block: next, text: 'Intro' });
    prev = next;
  }
  return ops;
}

/** The node's document with only `applied` of `ops` in it; an insert whose
 *  predecessor has not arrived lands at the end when `orphansLast`. */
function stateOf(
  ops: Op[],
  applied: Set<number>,
  orphansLast: boolean,
): NodeBlock[] {
  let order = [...INITIAL];
  const present = new Set(INITIAL);
  const orphans: string[] = [];
  const text: Record<string, string> = { ...INITIAL_TEXT };
  const attrs: Record<string, Record<string, string>> = Object.fromEntries(
    INITIAL.map((id) => [id, LEFT]),
  );
  ops.forEach((op, i) => {
    if (!applied.has(i)) return;
    if (op.op === 'text') text[op.block] = op.text;
    else if (op.op === 'attr') attrs[op.block] = LEFT;
  });
  // The full order, then filtered to what is present.
  const full = [...INITIAL];
  for (const op of ops) {
    if (op.op !== 'insert') continue;
    full.splice(full.indexOf(op.after) + 1, 0, op.block);
  }
  ops.forEach((op, i) => {
    if (op.op === 'insert' && applied.has(i)) present.add(op.block);
  });
  const reachable = new Set(INITIAL);
  for (const op of ops) {
    if (
      op.op === 'insert' &&
      present.has(op.block) &&
      reachable.has(op.after)
    ) {
      reachable.add(op.block);
    }
  }
  order = full.filter(
    (id) => present.has(id) && (!orphansLast || reachable.has(id)),
  );
  if (orphansLast) {
    for (const id of full)
      if (present.has(id) && !reachable.has(id)) orphans.push(id);
    order.push(...orphans);
  }
  return order.map((id) => ({
    id,
    kind: 'paragraph',
    depth: 0,
    attrs: attrs[id] ?? {},
    spans: text[id] ? [{ text: text[id] }] : [],
  }));
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const KINDS = ['TextChanged', 'BlockInserted', 'BlockChanged'];
const peerEvent = (kind: string, block: string) => ({
  contextId: CTX,
  type: 'StateMutation',
  data: {
    events: [
      {
        kind,
        data: Array.from(
          new TextEncoder().encode(JSON.stringify({ doc: DOC, block })),
        ),
      },
    ],
  },
});

const emit = (kind: string, block: string) =>
  act(() => deliver?.(peerEvent(kind, block)));

const settle = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  deliver = null;
});
afterEach(() => {
  vi.useRealTimers();
});

const WRITES = [
  'applyDeltaOn',
  'insertBlock',
  'splitBlock',
  'deleteBlock',
  'mergeBlocks',
  'moveBlock',
  'setKind',
  'setDepth',
  'setAttr',
];

async function replay(seed: number, orphansLast: boolean) {
  const random = rng(seed);
  const ops = bobOps();
  let state = stateOf(ops, new Set(), orphansLast);
  const client: Record<string, Mock> = {
    getDocument: vi.fn(async () => structuredClone(state)),
    getBlock: vi.fn(async ({ block }: { block: string }) =>
      structuredClone(state.find((b) => b.id === block) ?? null),
    ),
  };
  for (const name of WRITES)
    client[name] = vi.fn().mockRejectedValue(new Error(`wrote ${name}`));

  const { result: created, unmount: unmountEditor } = renderHook(() =>
    useCreateBlockNote({ schema }),
  );
  const editor = created.current;
  const host = document.body.appendChild(document.createElement('div'));
  editor.mount(host);
  const view = renderHook(() =>
    useFugueBody({
      client: client as unknown as DocsClient,
      docId: DOC,
      contextId: CTX,
      editor: editor as unknown as BodyEditor,
    }),
  );
  await settle(200);
  // EditorShell's one-time content, then every change reaches the binding.
  editor.replaceBlocks(
    editor.document,
    JSON.parse(view.result.current.content ?? '[]'),
  );
  editor.onChange(() => view.result.current.onContentChange(''));
  await settle(200);

  const applied = new Set<number>();
  while (applied.size < ops.length) {
    // Mostly in order, sometimes a later write first.
    const pending = ops.map((_, i) => i).filter((i) => !applied.has(i));
    const pick =
      random() < 0.7
        ? pending[0]
        : pending[Math.floor(random() * pending.length)];
    applied.add(pick);
    state = stateOf(ops, applied, orphansLast);
    const op = ops[pick];
    const kind =
      op.op === 'text' ? 'TextChanged' : KINDS[1 + Math.floor(random() * 2)];
    emit(kind, op.block);
    await settle(Math.floor(random() * 120));
  }
  emit('BlockInserted', 'n5');
  await settle(10_000);

  const writes = WRITES.flatMap((name) =>
    client[name].mock.calls.map((c) => [name, c[0]]),
  );
  const texts = editor.document.map((b) =>
    (Array.isArray(b.content) ? b.content : [])
      .map((c) => ('text' in c ? c.text : ''))
      .join(''),
  );
  view.unmount();
  editor.unmount();
  unmountEditor();
  host.remove();
  return {
    writes,
    texts,
    want: state.map((b) => b.spans.map((s) => s.text).join('')),
  };
}

describe('useFugueBody, a reader that never types', () => {
  for (const orphansLast of [false, true]) {
    it(`never writes and ends on the node's document (orphans ${orphansLast ? 'last' : 'hidden'})`, async () => {
      const failures: string[] = [];
      for (let seed = 1; seed <= 12; seed++) {
        const { writes, texts, want } = await replay(seed, orphansLast);
        if (writes.length > 0 || texts.join('|') !== want.join('|')) {
          failures.push(
            `seed ${seed}: writes ${JSON.stringify(writes).slice(0, 300)}\n  got  ${texts.join('|')}\n  want ${want.join('|')}`,
          );
        }
      }
      expect(failures).toEqual([]);
    }, 120_000);
  }
});
