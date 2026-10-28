import Foundation
import MeroKit
import MeroKitTestSupport

@testable import CalendarCore

enum Fixture {
    static let me = String(repeating: "ab", count: 32)
    static let bob = String(repeating: "b0", count: 32)
    static let carol = String(repeating: "c0", count: 32)
    static let utc = TimeZone(identifier: "UTC")!
    static let math = CalendarMath(timeZone: utc, locale: Locale(identifier: "en_US_POSIX"))

    /// 2026-10-28 (a Wednesday) at `hour`:`minute` UTC.
    static func date(_ day: Int = 28, _ hour: Int = 0, _ minute: Int = 0, month: Int = 10) -> Date {
        var c = DateComponents()
        c.year = 2026
        c.month = month
        c.day = day
        c.hour = hour
        c.minute = minute
        return math.calendar.date(from: c)!
    }

    /// A `get_events` row the way the contract writes it.
    static func eventJSON(
        id: String, title: String, owner: String, start: String, end: String, peers: [String] = [],
        type: String = "event", color: String = "#2aa775", isPrivate: Bool = false
    ) -> JSONValue {
        .object([
            "id": .string(id), "title": .string(title), "description": .string(""), "owner": .string(owner),
            "start": .string(start), "end": .string(end), "event_type": .string(type), "color": .string(color),
            "peers": .array(peers.map { .string($0) }), "private": .bool(isPrivate),
        ])
    }

    static func member(_ id: String, _ name: String) -> JSONValue {
        .object([
            "id": .string(id), "username": .string(name), "joinedAt": .number(1), "usernameUpdatedAt": .number(1),
        ])
    }

    /// A backend with one team and one calendar in it, the contract scripted by `answer`.
    static func backend(
        answer: @escaping @Sendable (RecordedContractCall) -> JSONValue? = { _ in nil }
    ) -> InMemoryAppBackend {
        let backend = InMemoryAppBackend(account: me)
        backend.namespaces = [AppNamespace(id: teamId, name: "Design", applicationId: backend.applicationId)]
        backend.subgroups = [teamId: [AppSubgroup(groupId: groupId, name: "Launches", contextIds: [contextId])]]
        backend.members = [contextId]
        backend.recording.setHandler { call in
            if let value = answer(call) { return value }
            switch call.method {
            case "get_events", "get_private_events", "get_members": return .array([])
            case "create_event", "update_event", "delete_event": return .string("evt-new")
            default: return .null
            }
        }
        return backend
    }

    static let teamId = String(repeating: "aa", count: 32)
    static let groupId = String(repeating: "bb", count: 32)
    static let contextId = String(repeating: "cc", count: 32)
    static var team: Team { Team(id: teamId, name: "Design", applicationId: String(repeating: "ap", count: 32)) }
    static var calendar: TeamCalendar { TeamCalendar(id: contextId, name: "Launches", groupId: groupId) }
}

extension RecordedContractCall {
    /// The arguments exactly as sent, parsed.
    var sent: [String: Any] {
        guard let data = argsJSON, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return object
    }
}
