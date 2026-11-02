import { useState } from "react";

/** A button's call: whether it is running, and what came back (shown by `ResultBox`). */
export function useCall() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  async function run(fn: () => Promise<unknown>) {
    setLoading(true);
    try {
      setResult(await fn());
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }
  return { loading, result, run };
}
