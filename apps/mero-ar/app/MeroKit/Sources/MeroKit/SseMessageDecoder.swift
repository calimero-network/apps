import Foundation

/// One decoded SSE control/event message. Mirrors web `sse.ts:handleMessage`.
public enum SseMessage: Equatable {
    case connect(sessionId: String)
    /// `data` is normalised JSON (byte arrays already decoded to JSON text).
    case event(contextId: String, data: Data)
    case ignored
}

/// Pure decoder for the JSON payload of a `data:` SSE line — unit-testable
/// without any network.
public enum SseMessageDecoder {
    public static func decode(_ jsonString: String) -> SseMessage {
        let trimmed = jsonString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let obj = (try? JSONSerialization.jsonObject(with: Data(trimmed.utf8))) as? [String: Any]
        else { return .ignored }

        // Connection handshake.
        if (obj["type"] as? String) == "connect",
           let sessionId = obj["session_id"] as? String {
            return .connect(sessionId: sessionId)
        }

        // Context event: { result: { contextId, data } }.
        if let result = obj["result"] as? [String: Any],
           let contextId = result["contextId"] as? String {
            let data = (try? OutputParser.normalize(result["data"])) ?? nil
            return .event(contextId: contextId, data: data ?? Data())
        }

        return .ignored
    }
}
