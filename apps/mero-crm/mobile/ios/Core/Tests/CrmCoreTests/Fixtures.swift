import CrmCore
import Foundation
import MeroKit
import MeroKitTestSupport

/// UTC, so day arithmetic in the tests does not depend on the machine.
let utc: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    c.locale = Locale(identifier: "en_US_POSIX")
    return c
}()

/// Wednesday 28 October 2026, 10:00 UTC.
let now = Date(timeIntervalSince1970: 1_793_181_600)

func ms(daysFromNow days: Double) -> UInt64 { Days.ms(now.addingTimeInterval(days * 86_400)) }

let stages: [StageView] = [
    StageView(id: "lead", name: "Lead in", probability: 10, position: 0),
    StageView(id: "qualified", name: "Qualified", probability: 25, position: 1),
    StageView(id: "meeting", name: "Meeting", probability: 40, position: 2),
    StageView(id: "proposal", name: "Proposal", probability: 60, position: 3),
    StageView(id: "negotiation", name: "Negotiation", probability: 80, position: 4),
]

func deal(
    _ id: String, title: String = "Acme — 50 seats", value: UInt64 = 12_000, stage: String = "lead",
    status: String = "open", probability: UInt32 = 10, contactId: String? = "c1", owner: String? = "alice",
    organization: String = "Acme", close: UInt64? = ms(daysFromNow: 20), next: NextActivity? = nil,
    created: UInt64 = ms(daysFromNow: -2), lastTouch: UInt64? = nil, closedAt: UInt64? = nil, lostReason: String = ""
) -> DealView {
    DealView(
        id: id, title: title, value: value, organization: organization, contactId: contactId,
        contactName: contactId == nil ? nil : "Ana Diaz", owner: owner, stageId: stage, status: status,
        lostReason: lostReason, expectedClose: close, source: "Referral", probability: probability,
        stageEnteredAt: created, closedAt: closedAt, nextActivity: next, openActivities: next == nil ? 0 : 1,
        lastTouchAt: lastTouch, createdBy: "me", createdAt: created)
}

func next(_ days: Double, subject: String = "Call Ana") -> NextActivity {
    NextActivity(id: "a1", kind: "call", subject: subject, dueAt: ms(daysFromNow: days))
}

func contact(_ id: String, name: String, org: String = "Acme") -> ContactView {
    ContactView(
        id: id, name: name, email: "\(name.lowercased().prefix(3))@acme.test", phone: "", organization: org,
        jobTitle: "Head of Ops", openDeals: 1, wonValue: 0, createdBy: "me", createdAt: 1)
}

func activity(_ id: String, due: UInt64, done: Bool = false, doneAt: UInt64? = nil, kind: String = "call") -> ActivityView {
    ActivityView(
        id: id, dealId: "d1", dealTitle: "Acme", contactId: nil, kind: kind, subject: "Subject \(id)", dueAt: due,
        done: done, doneAt: doneAt, owner: nil, note: "", automationId: nil, createdBy: "me", createdAt: 1)
}

func encode<T: Encodable>(_ value: T) -> Data { try! JSONEncoder().encode(value) }

/// A scripted pipeline behind an `InMemoryAppBackend`: answers the reads from
/// these properties and records every call.
final class Script: @unchecked Sendable {
    var stages = CrmCoreTests.stages
    var deals: [DealView] = []
    var contacts: [ContactView] = []
    var activities: [ActivityView] = []
    var settings = Settings(currency: "EUR", rottingDays: 14)
    var failRead: Error?

    func answer(_ call: RecordedContractCall) throws -> Data? {
        if let failRead, call.path == .query { throw failRead }
        switch call.method {
        case "list_stages": return encode(stages)
        case "list_deals": return encode(deals)
        case "list_contacts": return encode(contacts)
        case "list_activities": return encode(activities)
        case "list_automations": return encode([AutomationView]())
        case "get_settings": return encode(settings)
        case "create_deal", "create_contact", "add_activity", "add_note", "add_stage": return encode("new-\(call.method)")
        default: return Data("null".utf8)
        }
    }
}

func backend(_ script: Script) -> InMemoryAppBackend {
    let backend = InMemoryAppBackend()
    backend.recording.setRawHandler { try script.answer($0) }
    return backend
}

let ref = PipelineRef(namespaceId: "ns", contextId: "ctx", name: "Sales", workspaceName: "Acme Inc")

final class MemoryStore: KeyValueStore {
    var values: [String: String] = [:]
    func string(forKey key: String) -> String? { values[key] }
    func set(_ value: Any?, forKey key: String) { values[key] = value as? String }
}

/// The JSON object a call sent.
func args(_ call: RecordedContractCall) -> [String: JSONValue] {
    guard case .object(let fields) = call.args else { return [:] }
    return fields
}
