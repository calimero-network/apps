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
        "day": .string(day), "author": .string(author), "authorName": .string(name), "done": .string(done),
        "next": .string(next), "blockers": .string(blockers), "createdAt": 1, "editedAt": 1,
        "helpers": .array(helpers),
    ]
}

func decision(_ id: String, title: String, supersededBy: String = "", tags: [String] = []) -> JSONValue {
    [
        "id": .string(id), "author": .string(ana), "authorName": "Ana", "title": .string(title),
        "decision": "We do it", "rationale": "Because", "supersedes": "", "supersededBy": .string(supersededBy),
        "createdAt": 1_761_652_800_000_000_000, "tags": .array(tags.map { .string($0) }), "with": [],
        "fromDay": "",
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
        case "teamName": return .string(teamName)
        case "getName": return .string(names[call.args["account"]?.stringValue ?? ""] ?? "")
        case "members": return .array(members)
        case "getDay":
            let day = call.args["day"]?.stringValue ?? ""
            return ["day": .string(day), "updates": .array(days[day] ?? [])]
        case "getWeek":
            let start = call.args["start"]?.stringValue ?? ""
            return .array(
                Days.weekDays(start, calendar: utc).map { ["day": .string($0), "updates": .array(days[$0] ?? [])] })
        case "currentBlockers": return .array(blockers)
        case "listDecisions": return ["items": .array(decisions), "nextCursor": nextCursor]
        case "tags": return .array(tags)
        case "logDecision": return "new-decision"
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
