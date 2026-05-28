import axios from "axios";
import { useAuthStore } from "../store/authStore";

interface RpcResponse<T> {
  data: T;
  error?: string;
}

export async function rpcCall<T>(
  contextId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { nodeUrl, accessToken } = useAuthStore.getState();
  const res = await axios.post<RpcResponse<T>>(
    `${nodeUrl}/jsonrpc`,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "call",
      params: {
        context_id: contextId,
        method,
        args_json: JSON.stringify(args),
      },
    },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (res.data.error) throw new Error(res.data.error);
  return res.data.data;
}

export async function adminGet<T>(path: string): Promise<T> {
  const { nodeUrl, accessToken } = useAuthStore.getState();
  const res = await axios.get<RpcResponse<T>>(`${nodeUrl}/admin-api${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data.data ?? (res.data as T);
}

export async function adminPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { nodeUrl, accessToken } = useAuthStore.getState();
  const res = await axios.post<RpcResponse<T>>(
    `${nodeUrl}/admin-api${path}`,
    body,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  return res.data.data ?? (res.data as T);
}

export async function adminPut<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { nodeUrl, accessToken } = useAuthStore.getState();
  const res = await axios.put<RpcResponse<T>>(
    `${nodeUrl}/admin-api${path}`,
    body,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  return res.data.data ?? (res.data as T);
}
