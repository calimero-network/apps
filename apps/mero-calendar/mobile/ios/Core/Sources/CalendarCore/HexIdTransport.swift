import CalendarGenerated
import Foundation
import MeroKit

/// The generated client's transport over one context's contract, with the
/// one thing the generated code reads differently from the contract fixed.
///
/// The ABI declares `owner` and `peers` as 32-byte arrays, so the generated
/// `CalendarEvent` / `CreateCalendarEvent` / `UpdateCalendarEvent` hold them as
/// `[UInt8]`. The contract's `UserId` serialises as 64 hex characters
/// (`logic/src/types/id.rs`), which is also what the web app sends. So:
///
/// - `get_events` / `get_private_events` answers: hex strings become byte arrays
///   before the generated decoder sees them;
/// - `create_event` / `create_private_event` / `update_event` / `update_private_event`
///   arguments: `event_data.peers` byte arrays become hex strings.
///
/// Every other method passes through byte for byte (`u64` values such as
/// `joinedAt` are never re-encoded).
public struct HexIdTransport: CalendarGenerated.ContextContractCalling {
    public let inner: any MeroKit.ContextContractCalling

    public init(_ inner: any MeroKit.ContextContractCalling) {
        self.inner = inner
    }

    public func query(method: String, argsJSON: Data) async throws -> Data {
        let out = try await inner.query(method: method, argsJSON: HexIds.request(method, argsJSON))
        return HexIds.response(method, out)
    }

    public func execute(method: String, argsJSON: Data) async throws -> Data {
        let out = try await inner.execute(method: method, argsJSON: HexIds.request(method, argsJSON))
        return HexIds.response(method, out)
    }
}

/// The JSON rewriting `HexIdTransport` does, testable on its own.
public enum HexIds {
    static let eventLists: Set<String> = ["get_events", "get_private_events"]
    static let eventWrites: Set<String> = [
        "create_event", "create_private_event", "update_event", "update_private_event",
    ]

    /// Arguments on their way to the contract.
    public static func request(_ method: String, _ data: Data) -> Data {
        guard eventWrites.contains(method),
            var root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            var event = root["event_data"] as? [String: Any]
        else { return data }
        if let peers = event["peers"] as? [Any] {
            event["peers"] = peers.map { hex(fromBytes: $0) ?? $0 }
        }
        root["event_data"] = event
        return (try? JSONSerialization.data(withJSONObject: root)) ?? data
    }

    /// A method's answer on its way to the generated decoder.
    public static func response(_ method: String, _ data: Data) -> Data {
        guard eventLists.contains(method),
            let rows = (try? JSONSerialization.jsonObject(with: data)) as? [Any]
        else { return data }
        let fixed: [Any] = rows.map { row in
            guard var event = row as? [String: Any] else { return row }
            if let owner = event["owner"] as? String { event["owner"] = bytes(fromHex: owner) }
            if let peers = event["peers"] as? [Any] {
                event["peers"] = peers.map { ($0 as? String).map(bytes(fromHex:)) ?? $0 }
            }
            return event
        }
        return (try? JSONSerialization.data(withJSONObject: fixed)) ?? data
    }

    /// `"ab01…"` → `[171, 1, …]`. A string that is not hex becomes `[]`.
    public static func bytes(fromHex hex: String) -> [Int] {
        let chars = Array(hex.trimmingCharacters(in: .whitespaces).lowercased())
        guard chars.count % 2 == 0 else { return [] }
        var out: [Int] = []
        out.reserveCapacity(chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let byte = Int(String(chars[i...i + 1]), radix: 16) else { return [] }
            out.append(byte)
            i += 2
        }
        return out
    }

    /// A byte array (as JSON numbers) → lowercase hex, `nil` when it is not one.
    static func hex(fromBytes value: Any) -> String? {
        guard let numbers = value as? [Any] else { return nil }
        var bytes: [UInt8] = []
        for number in numbers {
            guard let n = (number as? NSNumber)?.intValue, (0...255).contains(n) else { return nil }
            bytes.append(UInt8(n))
        }
        return Hex.encode(bytes)
    }
}

extension Array where Element == UInt8 {
    /// Lowercase hex, as the contract writes a `UserId`.
    public var hexString: String { Hex.encode(self) }
}

extension String {
    /// The bytes of a hex `UserId` (empty when this is not hex).
    public var hexBytes: [UInt8] { HexIds.bytes(fromHex: self).map { UInt8($0) } }
}
