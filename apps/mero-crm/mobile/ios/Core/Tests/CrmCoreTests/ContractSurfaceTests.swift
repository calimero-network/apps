import CrmCore
import Foundation
import MeroKit
import XCTest

/// The client against the contract's component ABI (`logic/res/abi.json`):
/// every method by its camelCase name, sent the right way (view or call), with
/// exactly the ABI's parameters, `none` as an explicit null and a u64 as a
/// decimal string; answers with u64s as strings decode.
final class ContractSurfaceTests: XCTestCase {
    /// `methods` of the ABI, without `init`: name → parameter names.
    static let abi: [String: [String]] = [
        "addActivity": ["dealId", "contactId", "kind", "subject", "dueAt", "owner", "note"],
        "addAutomation": ["stageId", "kind", "subject", "dueInDays"],
        "addNote": ["dealId", "body"],
        "addStage": ["name", "probability"],
        "createContact": ["name", "email", "phone", "organization", "jobTitle"],
        "createDeal": ["title", "value", "organization", "contactId", "stageId", "owner", "expectedClose", "source"],
        "deleteActivity": ["activityId"],
        "deleteAutomation": ["automationId"],
        "deleteContact": ["contactId"],
        "deleteDeal": ["dealId"],
        "deleteNote": ["noteId"],
        "deleteStage": ["stageId"],
        "getDeal": ["dealId"],
        "getSettings": [],
        "listActivities": ["dealId", "done"],
        "listAutomations": [],
        "listContacts": [],
        "listDeals": ["status", "stageId", "owner"],
        "listStages": [],
        "markLost": ["dealId", "reason"],
        "markWon": ["dealId"],
        "moveDeal": ["dealId", "stageId"],
        "reopenDeal": ["dealId"],
        "reorderStages": ["stageIds"],
        "rescheduleActivity": ["activityId", "dueAt"],
        "setActivityDone": ["activityId", "done"],
        "setAutomationEnabled": ["automationId", "enabled"],
        "setCurrency": ["currency"],
        "setRottingDays": ["days"],
        "updateContact": ["contactId", "name", "email", "phone", "organization", "jobTitle"],
        "updateDeal": ["dealId", "title", "value", "organization", "contactId", "owner", "expectedClose", "source"],
        "updateStage": ["stageId", "name", "probability"],
    ]

    static let viewNames: Set<String> = [
        "getDeal", "getSettings", "listActivities", "listAutomations", "listContacts", "listDeals", "listStages",
    ]

    /// Records each request and answers with a canned result.
    final class Recorder: ContextContractCalling, @unchecked Sendable {
        var sent: [(method: String, view: Bool, args: [String: Any])] = []

        func query(method: String, argsJSON: Data) async throws -> Data {
            record(method, argsJSON, view: true)
            return Data(Self.answers[method, default: "null"].utf8)
        }

        func execute(method: String, argsJSON: Data) async throws -> Data {
            record(method, argsJSON, view: false)
            return Data(Self.answers[method, default: "null"].utf8)
        }

        private func record(_ method: String, _ args: Data, view: Bool) {
            let object = (try? JSONSerialization.jsonObject(with: args)) as? [String: Any] ?? [:]
            sent.append((method, view, object))
        }

        static let deal = """
            {"id":"d1","title":"Acme","value":"12500","organization":"Acme","contact_id":null,"contact_name":null,
            "owner":null,"stage_id":"lead","status":"open","lost_reason":"","expected_close":"1793181600000",
            "source":"","probability":10,"stage_entered_at":"1793181600000","closed_at":null,
            "next_activity":{"id":"a1","kind":"call","subject":"Call","due_at":"1793268000000"},
            "open_activities":1,"last_touch_at":null,"created_by":"me","created_at":"1793181600000"}
            """
        static let answers: [String: String] = [
            "listDeals": "[\(deal)]",
            "getDeal": #"{"deal":\#(deal),"contact":null,"activities":[],"notes":[]}"#,
            "listStages": "[]", "listContacts": "[]", "listActivities": "[]", "listAutomations": "[]",
            "getSettings": #"{"currency":"EUR","rotting_days":14}"#,
            "addActivity": #""a1""#, "addAutomation": #""r1""#, "addNote": #""n1""#, "addStage": #""s1""#,
            "createContact": #""c1""#, "createDeal": #""d1""#,
        ]
    }

    func testEveryMethodIsTheABIsNameWithItsParameters() async throws {
        let r = Recorder()
        let c = CrmClient(contract: r)
        _ = try await c.addActivity(kind: "call", subject: "Call", dueAt: 1, note: "")
        _ = try await c.addAutomation(stageId: "s", kind: "call", subject: "x", dueInDays: 2)
        _ = try await c.addNote(dealId: "d", body: "b")
        _ = try await c.addStage(name: "n", probability: 10)
        _ = try await c.createContact(name: "n", email: "", phone: "", organization: "", jobTitle: "")
        _ = try await c.createDeal(title: "t", value: 1, organization: "", stageId: "s", source: "")
        try await c.deleteActivity(activityId: "a")
        try await c.deleteAutomation(automationId: "r")
        try await c.deleteContact(contactId: "c")
        try await c.deleteDeal(dealId: "d")
        try await c.deleteNote(noteId: "n")
        try await c.deleteStage(stageId: "s")
        _ = try await c.getDeal(dealId: "d")
        _ = try await c.getSettings()
        _ = try await c.listActivities()
        _ = try await c.listAutomations()
        _ = try await c.listContacts()
        _ = try await c.listDeals()
        _ = try await c.listStages()
        try await c.markLost(dealId: "d", reason: "Price")
        try await c.markWon(dealId: "d")
        try await c.moveDeal(dealId: "d", stageId: "s")
        try await c.reopenDeal(dealId: "d")
        try await c.reorderStages(stageIds: ["a", "b"])
        try await c.rescheduleActivity(activityId: "a", dueAt: 2)
        try await c.setActivityDone(activityId: "a", done: true)
        try await c.setAutomationEnabled(automationId: "r", enabled: false)
        try await c.setCurrency(currency: "EUR")
        try await c.setRottingDays(days: 14)
        try await c.updateContact(contactId: "c", name: "n", email: "", phone: "", organization: "", jobTitle: "")
        try await c.updateDeal(dealId: "d", title: "t", value: 1, organization: "", source: "")
        try await c.updateStage(stageId: "s", name: "n", probability: 20)

        XCTAssertEqual(Set(r.sent.map(\.method)), Set(Self.abi.keys), "every ABI method, and only those")
        XCTAssertEqual(CrmClient.views, Self.viewNames)
        XCTAssertEqual(CrmClient.calls, Set(Self.abi.keys).subtracting(Self.viewNames))
        for request in r.sent {
            XCTAssertEqual(Set(request.args.keys), Set(Self.abi[request.method] ?? []), request.method)
            XCTAssertEqual(request.view, Self.viewNames.contains(request.method), request.method)
        }
    }

    func testANoneIsANullAndAU64IsADecimalString() async throws {
        let r = Recorder()
        let c = CrmClient(contract: r)
        _ = try await c.createDeal(
            title: "t", value: 12_500, organization: "", contactId: nil, stageId: "s", expectedClose: 1_793_181_600_000,
            source: "")
        let args = try XCTUnwrap(r.sent.first?.args)
        XCTAssertEqual(args["value"] as? String, "12500")
        XCTAssertEqual(args["expectedClose"] as? String, "1793181600000")
        XCTAssertTrue(args["contactId"] is NSNull)
        XCTAssertTrue(args["owner"] is NSNull)
    }

    func testAnswersReadU64sFromDecimalStrings() async throws {
        let c = CrmClient(contract: Recorder())
        let deals = try await c.listDeals().map { try $0.decoded(as: DealView.self) }
        let deal = try XCTUnwrap(deals.first)
        XCTAssertEqual(deal.value, 12_500)
        XCTAssertEqual(deal.expectedClose, 1_793_181_600_000)
        XCTAssertNil(deal.closedAt)
        XCTAssertEqual(deal.nextActivity?.dueAt, 1_793_268_000_000)
        let detail = try await c.getDeal(dealId: "d1").decoded(as: DealDetail.self)
        XCTAssertEqual(detail.deal, deal)
        let back = try JSONDecoder().decode(DealView.self, from: JSONEncoder().encode(deal))
        XCTAssertEqual(back, deal, "encoding writes the wire's strings back")
    }
}
