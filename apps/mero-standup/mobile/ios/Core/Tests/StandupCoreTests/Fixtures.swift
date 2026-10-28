import Foundation
import MeroKit
import MeroKitTestSupport
@testable import StandupCore

let me = "me-account-0000000000000000000000000000000000000000000000000000000001"
let ana = "ana-account-000000000000000000000000000000000000000000000000000000002"
let bo = "bo-account-0000000000000000000000000000000000000000000000000000000003"

/// A fixed "now" (Wed 2026-10-28, noon UTC) and a UTC Gregorian calendar, so
/// day maths do not depend on the machine running the tests.
let utc: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    c.locale = Locale(identifier: "en_US_POSIX")
    return c
}()
let fixedNow = utc.date(from: DateComponents(year: 2026, month: 10, day: 28, hour: 12))!

func update(
    _ author: String, day: String, name: String = "", done: String = "", next: String = "", blockers: String = "",
    helpers: [JSONValue] = []
) -> JSONValue {
    [
        "day": .string(day), "author": .string(author), "author_name": .string(name), "done": .string(done),
        "next": .string(next), "blockers": .string(blockers), "created_at": 1, "edited_at": 1,
        "helpers": .array(helpers),
    ]
}

func decision(_ id: String, title: String, supersededBy: String = "", tags: [String] = []) -> JSONValue {
    [
        "id": .string(id), "author": .string(ana), "author_name": "Ana", "title": .string(title),
        "decision": "We do it", "rationale": "Because", "supersedes": "", "superseded_by": .string(supersededBy),
        "created_at": 1_761_652_800_000_000_000, "tags": .array(tags.map { .string($0) }), "with": [],
        "from_day": "",
    ]
}

/// A scripted team: answers every view from these values, records every write.
final class FakeTeam: @unchecked Sendable {
    let backend = InMemoryAppBackend()
    var days: [String: [JSONValue]] = [:]
    var members: [JSONValue] = []
    var names: [String: String] = [:]
    var teamName = "Platform"
    var decisions: [JSONValue] = []
    var tags: [JSONValue] = []
    var blockers: [JSONValue] = []
    var nextCursor: JSONValue = .null

    init() {
        backend.recording.setHandler { [unowned self] call in self.answer(call) }
    }

    var recording: RecordingContextContract { backend.recording }

    func answer(_ call: RecordedContractCall) -> JSONValue? {
        switch call.method {
        case "whoami": return .string(me)
        case "team_name": return .string(teamName)
        case "get_name": return .string(names[call.args["account"]?.stringValue ?? ""] ?? "")
        case "members": return .array(members)
        case "get_day":
            let day = call.args["day"]?.stringValue ?? ""
            return ["day": .string(day), "updates": .array(days[day] ?? [])]
        case "get_week":
            let start = call.args["start"]?.stringValue ?? ""
            return .array(
                Days.weekDays(start, calendar: utc).map { ["day": .string($0), "updates": .array(days[$0] ?? [])] })
        case "current_blockers": return .array(blockers)
        case "list_decisions": return ["items": .array(decisions), "next_cursor": nextCursor]
        case "tags": return .array(tags)
        case "log_decision": return "new-decision"
        default: return .null
        }
    }

    @MainActor
    func teamModel() async -> TeamModel {
        let model = TeamModel(
            team: TeamSummary(namespaceId: "ns-1", contextId: "ctx-1", name: "Platform"), backend: backend)
        await model.load()
        return model
    }
}
