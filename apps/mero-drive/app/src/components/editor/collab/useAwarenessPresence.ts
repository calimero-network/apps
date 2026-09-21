// Carries Yjs awareness (live cursors and selections) over Calimero ephemeral
// presence: transient, signed, swept by the node, never on the DAG or the log.

import { useEffect, useRef } from 'react';
import { useEphemeral, useMero } from '@calimero-network/mero-react';
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
  type Awareness,
} from 'y-protocols/awareness';

const PUBLISH_THROTTLE_MS = 200; // bounds the burst while a selection is dragged
const REMOTE_ORIGIN = 'calimero-ephemeral'; // origin of the peer changes this hook applies
const LEAVE_SLICE: PresenceSlice = { d: '', u: [] }; // matches no document

/**
 * One device's slice: the doc it is on (one docs context serves a whole folder)
 * and its awareness state in the y-protocols update encoding.
 */
export interface PresenceSlice {
  d: string;
  u: number[];
}

/**
 * Publish this client's awareness to `contextId` and apply peers' slices for
 * `docId` to `awareness`. A peer is withdrawn once it is no longer on this doc.
 */
export function useAwarenessPresence(
  contextId: string | null,
  docId: string,
  awareness: Awareness | null,
): void {
  const { mero } = useMero();
  const { peers, setPresence, error } = useEphemeral<PresenceSlice>(contextId, {
    throttleMs: PUBLISH_THROTTLE_MS,
  });
  const publishRef = useRef({ setPresence, mero, contextId });
  publishRef.current = { setPresence, mero, contextId };

  useEffect(() => {
    if (error) console.warn('[useAwarenessPresence] live cursors off', error);
  }, [error]);

  useEffect(() => {
    if (!awareness) return;
    const publish = () =>
      publishRef.current.setPresence({
        d: docId,
        u: Array.from(encodeAwarenessUpdate(awareness, [awareness.clientID])),
      });
    // Peer slices never carry our client, so a change to it is always local.
    const onUpdate = ({
      added,
      updated,
      removed,
    }: Record<string, number[]>) => {
      if ([...added, ...updated, ...removed].includes(awareness.clientID)) {
        publish();
      }
    };
    publish();
    awareness.on('update', onUpdate);
    return () => {
      awareness.off('update', onUpdate);
      // A throttled publish is dropped on unmount and the node heartbeats the
      // last slice forever, so leave directly; best effort, peers time out at 30s.
      const { mero: m, contextId: ctx } = publishRef.current;
      if (ctx) void m?.ephemeral?.set(ctx, LEAVE_SLICE).catch(() => {});
    };
  }, [awareness, docId]);

  // author -> the Yjs client last applied for it, so a departure can be removed.
  const appliedRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!awareness) return;
    const applied = appliedRef.current;
    const stale: number[] = [];
    const apply = (slice: PresenceSlice) => {
      try {
        applyAwarenessUpdate(awareness, new Uint8Array(slice.u), REMOTE_ORIGIN);
        return true;
      } catch {
        return false;
      }
    };
    for (const [author, slice] of peers) {
      const client = slice?.d === docId ? clientOf(slice) : null;
      const prev = applied.get(author);
      if (client !== null && client !== awareness.clientID && apply(slice)) {
        if (prev !== undefined && prev !== client) stale.push(prev);
        applied.set(author, client);
      } else if (prev !== undefined) {
        stale.push(prev);
        applied.delete(author);
      }
    }
    for (const [author, client] of applied) {
      if (!peers.has(author)) {
        stale.push(client);
        applied.delete(author);
      }
    }
    if (stale.length > 0) {
      removeAwarenessStates(awareness, stale, REMOTE_ORIGIN);
    }
  }, [peers, awareness, docId]);
}

/** The single client a slice's update describes, or null if it is not one. */
function clientOf(slice: PresenceSlice): number | null {
  if (!Array.isArray(slice.u)) return null;
  const count = readVarUint(slice.u, 0);
  if (!count || count[0] !== 1) return null;
  const client = readVarUint(slice.u, count[1]);
  return client ? client[0] : null;
}

// lib0's unsigned varint: 7 bits per byte, little-endian, high bit continues.
function readVarUint(bytes: number[], pos: number): [number, number] | null {
  let value = 0;
  for (let i = pos, mult = 1; i < bytes.length && i < pos + 8; i++) {
    value += (bytes[i] & 0x7f) * mult;
    if (bytes[i] < 0x80) return [value, i + 1];
    mult *= 128;
  }
  return null;
}
