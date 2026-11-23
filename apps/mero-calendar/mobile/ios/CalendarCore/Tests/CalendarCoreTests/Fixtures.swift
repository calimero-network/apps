import Foundation
import MeroKit
import MeroKitTestSupport

@testable import CalendarCore

enum Fixture {
    // Account ids, as a 1.0 node names them.
    static let me = "acc_me"
    static let bob = "acc_bob"
    static let carol = "acc_carol"
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

    /// A `getEvents` row the way the contract writes it.
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
            "id": .string(id), "username": .string(name), "joinedAt": .string("1761650000000000001"),
            "usernameUpdatedAt": .string("1"),
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
            case "getEvents", "getPrivateEvents", "getMembers": return .array([])
            case "createEvent", "createPrivateEvent": return .string("evt-new")
            case "updateEvent", "updatePrivateEvent", "deleteEvent", "deletePrivateEvent":
                return .string(call.sent["eventId"] as? String ?? "")
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
