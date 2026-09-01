// Decodes Calimero's byte-array contract errors:
// "the method call returned an error: [34, 78, ...]" → human-readable string
function decodeByteArrayErrors(json: string): string {
  return json.replace(
    /the method call returned an error: \[([^\]]+)\]/g,
    (original, byteList) => {
      try {
        const bytes = byteList.split(",").map((s: string) => parseInt(s.trim(), 10));
        const decoded = new TextDecoder().decode(new Uint8Array(bytes));
        return `the method call returned an error: ${decoded}`;
      } catch {
        return original;
      }
    },
  );
}

export function ResultBox({ result }: { result: unknown }) {
  if (result === undefined) return null;
  const isError =
    result !== null &&
    typeof result === "object" &&
    "error" in result &&
    (result as { error: unknown }).error !== null;
  const text = decodeByteArrayErrors(JSON.stringify(result, null, 2));
  return (
    <pre className={`result-box${isError ? " error" : ""}`}>{text}</pre>
  );
}
