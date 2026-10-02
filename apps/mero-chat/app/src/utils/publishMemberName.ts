type Write = (
  groupId: string,
  identity: string,
  request: { name: string },
) => Promise<{ error?: { message: string } | null }>;

/**
 * Publish this member's name to the workspace, and wait for it.
 *
 * Waited for because entry ends in a full page load, which cancels anything
 * still in flight. On a node the write is one quick call and usually won that
 * race; on an account it is a nonce, a signature and a relay round trip, and
 * usually lost it — the member then stayed nameless for everyone. Bounded so a
 * slow relay cannot hold entry hostage: the name is retried on the next entry.
 */
export async function publishMemberName(
  write: Write,
  groupId: string,
  identity: string,
  name: string,
  timeoutMs = 5_000,
): Promise<"ok" | "timeout" | `refused: ${string}`> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const written = write(groupId, identity, { name })
    .then((res): "ok" | `refused: ${string}` => (res.error ? `refused: ${res.error.message}` : "ok"))
    .catch((err: unknown): `refused: ${string}` => `refused: ${err instanceof Error ? err.message : String(err)}`);
  try {
    return await Promise.race([written, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
