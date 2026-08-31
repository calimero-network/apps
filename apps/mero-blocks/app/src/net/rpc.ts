// JSON-RPC contract calls. Wire shape (locked by mero-design's rpc tests):
//   POST {node}/jsonrpc  { jsonrpc, id, method: "execute",
//                          params: { contextId, method, argsJson } }
// - envelope params are camelCase (contextId, argsJson)
// - argsJson is a raw object, NOT a JSON string
// - output may be a JSON string, a parsed value, or a legacy u8[] byte array

export interface RpcTarget {
  nodeUrl: string;
  contextId: string;
  getToken: () => string | null;
  executorPublicKey?: string | null;
}

let rpcId = 0;

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

export function extractRpcError(body: Record<string, unknown>): string | null {
  const err = body?.error as Record<string, unknown> | undefined;
  if (!err) return null;
  if (typeof err.data === "string" && err.data) return err.data;
  if (err.data != null && typeof err.data === "object") return JSON.stringify(err.data);
  if (typeof err.message === "string" && err.message) return err.message;
  return JSON.stringify(err);
}

export async function rpcExecute<T = unknown>(
  target: RpcTarget,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const token = target.getToken();
  const res = await fetch(`${target.nodeUrl}/jsonrpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "execute",
      params: {
        contextId: target.contextId,
        method,
        argsJson: args,
        ...(target.executorPublicKey ? { executorPublicKey: target.executorPublicKey } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`rpc ${method}: HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const err = extractRpcError(body);
  if (err) throw new Error(`rpc ${method}: ${err}`);
  const result = body.result as Record<string, unknown> | undefined;
  return decodeOutput(result?.output) as T;
}
