// An image block's picture. The bytes are read through the folder's docs
// context, so the node can find them on a peer, and checked again on the way
// in: a member writing to the contract directly can name any blob.

import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { classifyError } from '@calimero-network/mero-js';
import { parseBlobRef, sniffImageType } from '@/lib/images';

export type BlobImage =
  | { status: 'loading' }
  | { status: 'loaded'; url: string }
  /** No peer served it, or not in time; asking again can work. */
  | { status: 'unavailable' }
  /** This session may not read blobs, such as one signed in through a relay. */
  | { status: 'denied' }
  /** Not a blob reference, or not an image this app shows. */
  | { status: 'broken' };

class NotAnImage extends Error {}

interface Entry {
  key: string;
  users: number;
  url: Promise<string>;
}

// One object URL per blob, shared by every block showing it.
const entries = new Map<string, Entry>();

function acquire(key: string, load: () => Promise<string>): Entry {
  let entry = entries.get(key);
  if (!entry) {
    const created: Entry = { key, users: 0, url: load() };
    created.url.catch(() => {
      if (entries.get(key) === created) entries.delete(key);
    });
    entries.set(key, created);
    entry = created;
  }
  entry.users += 1;
  return entry;
}

function release(entry: Entry): void {
  entry.users -= 1;
  if (entry.users > 0) return;
  if (entries.get(entry.key) === entry) entries.delete(entry.key);
  entry.url.then(URL.revokeObjectURL, () => {});
}

function failure(cause: unknown): BlobImage {
  if (cause instanceof NotAnImage) return { status: 'broken' };
  if (classifyError(cause).kind === 'forbidden') return { status: 'denied' };
  return { status: 'unavailable' };
}

export function useBlobImage(
  ref: string,
  contextId: string | null,
): { image: BlobImage; retry: () => void } {
  const { mero } = useMero();
  const blobId = parseBlobRef(ref);
  const [image, setImage] = useState<BlobImage>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!blobId) return;
    if (!mero || !contextId) {
      setImage({ status: 'loading' });
      return;
    }
    setImage({ status: 'loading' });
    const entry = acquire(`${contextId}/${blobId}`, async () => {
      const bytes = new Uint8Array(await mero.admin.getBlob(blobId, { contextId }));
      const type = sniffImageType(bytes);
      if (!type) throw new NotAnImage();
      return URL.createObjectURL(new Blob([bytes], { type }));
    });
    let live = true;
    entry.url.then(
      (url) => live && setImage({ status: 'loaded', url }),
      (cause: unknown) => live && setImage(failure(cause)),
    );
    return () => {
      live = false;
      release(entry);
    };
  }, [mero, blobId, contextId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { image: blobId ? image : { status: 'broken' }, retry };
}
