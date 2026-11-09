// The message of a failed RPC envelope, without assuming its shape. The legacy
// envelope nests the node's message at `error.error.cause.info.message`, but
// any of those levels can be missing; reading through them blindly throws a
// TypeError that hides the real failure.

interface ErrorEnvelope {
  error?: {
    code?: number;
    message?: unknown;
    statusText?: unknown;
    error?: { cause?: { info?: unknown } } | null;
  } | null;
  statusText?: unknown;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function rpcErrorMessage(
  response: ErrorEnvelope | null | undefined,
  fallback = "The request failed.",
): string {
  const error = response?.error;
  const info = error?.error?.cause?.info;
  const infoMessage =
    info && typeof info === "object"
      ? (info as { message?: unknown }).message
      : undefined;
  return (
    nonEmpty(infoMessage) ??
    nonEmpty(error?.message) ??
    nonEmpty(error?.statusText) ??
    nonEmpty(response?.statusText) ??
    fallback
  );
}
