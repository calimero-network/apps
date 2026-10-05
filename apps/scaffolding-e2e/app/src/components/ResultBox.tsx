// Decodes Calimero's byte-array contract errors, the shape nodes before core
// rc.81 send: "the method call returned an error: [34, 78, ...]" → the text
// those bytes spell. From rc.81 the node renders that text itself, so a
// message with no byte list behind the prefix is already readable and is left
// as it is. Only a run of decimal numbers is decoded; a text message that
// happens to carry brackets ("layer [3, 4] is locked") is not touched.
//
// Exported for tests.
export function decodeByteArrayErrors(json: string): string {
  return json.replace(
    /the method call returned an error: \[(\s*\d+(?:\s*,\s*\d+)*\s*)\]/g,
    (original, byteList) => {
      try {
        const bytes = byteList.split(",").map((s: string) => parseInt(s.trim(), 10));
        if (bytes.some((b: number) => b < 0 || b > 255)) return original;
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
