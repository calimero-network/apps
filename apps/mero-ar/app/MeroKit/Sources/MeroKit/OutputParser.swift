import Foundation

/// Normalises the polymorphic `result.output` of a Calimero `execute` response
/// into canonical JSON `Data` ready for `JSONDecoder`. Returns `nil` for an
/// empty/null result.
///
/// Calimero nodes vary in how they encode output (see web `rpc.ts:78-95`):
///   • legacy nodes: `output` is a `[u8]` byte array → decode → JSON text
///   • modern nodes: `output` is already-parsed JSON (object / array / string / scalar)
public enum OutputParser {

    public static func normalize(_ output: Any?) throws -> Data? {
        guard let output, !(output is NSNull) else { return nil }

        // Arrays: either a legacy byte array or an array of JSON objects.
        if let array = output as? [Any] {
            if array.isEmpty { return nil }
            // rpc.ts heuristic: if first element is a number → byte array; else JSON.
            if array.allSatisfy({ isNumber($0) }) {
                let bytes = array.compactMap { ($0 as? NSNumber)?.uint8Value }
                guard bytes.count == array.count else {
                    return try JSONSerialization.data(withJSONObject: array)
                }
                return Data(bytes) // raw bytes ARE the JSON text
            }
            return try JSONSerialization.data(withJSONObject: array)
        }

        // Object → re-serialize as JSON.
        if let dict = output as? [String: Any] {
            return try JSONSerialization.data(withJSONObject: dict)
        }

        // String: may itself be JSON text, or a bare scalar string value.
        if let s = output as? String {
            let raw = Data(s.utf8)
            if let parsed = try? JSONSerialization.jsonObject(with: raw),
               (parsed is [Any] || parsed is [String: Any]) {
                return raw
            }
            return try JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed])
        }

        // Number / Bool scalar.
        return try JSONSerialization.data(withJSONObject: output, options: [.fragmentsAllowed])
    }

    /// NSNumber covers both numbers and booleans in JSONSerialization output;
    /// a byte array never contains booleans, so treating bools as "number" here
    /// is harmless for the heuristic above.
    private static func isNumber(_ value: Any) -> Bool {
        value is NSNumber
    }
}
