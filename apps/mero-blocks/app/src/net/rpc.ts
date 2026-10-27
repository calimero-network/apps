// Decoding what a contract call answers. The call itself goes through the
// cloud transport (cloudTransport.ts); v1's raw `/jsonrpc` POST is gone.
// An output may be a parsed value, a JSON string, or a legacy u8[] byte array.

export function decodeOutput(output: unknown): unknown {
  if (output == null) return null;
  if (Array.isArray(output) && output.every((v) => typeof v === "number")) {
    const text = new TextDecoder().decode(new Uint8Array(output as number[]));
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (typeof output === "string") {
    try {
      return JSON.parse(output);
    } catch {
      return output;
    }
  }
  return output;
}
