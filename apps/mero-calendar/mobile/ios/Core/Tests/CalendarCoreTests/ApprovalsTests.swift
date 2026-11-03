import CalendarCore
import Foundation
import MeroKit
import XCTest

@MainActor
final class ApprovalsTests: XCTestCase {
    static func pending(org: String?, upgradesBy: String = "owner", releasesBy: String = "owner") throws
        -> PendingApprovals
    {
        let scope = org.map { #"{"kind":"org","org":"\#($0)"}"# } ?? #"{"kind":"account"}"#
        let report = """
            {"scope":\(scope),
             "governance":{"releases":"\(releasesBy)","appUpgrades":"\(upgradesBy)","outbound":"owner"},
             "approvedReleases":["2.3.109"],
             "clusterReleases":[{"release":"2.3.110","nodes":3,"approved":false},
                                {"release":"2.3.109","nodes":3,"approved":true}],
             "apps":[
               {"app":"app-1","group":1,"scope":\(scope),"bundle":"b","upgradesHeldBy":"owner","replicas":[],
                "name":"Launches","package":{"package":"\(CalendarConstants.packageName)","version":"1.0.0"},
                "availableVersions":["1.1.0","1.2.0"]},
               {"app":"app-2","group":2,"scope":\(scope),"bundle":"b","upgradesHeldBy":"owner","replicas":[],
                "package":{"package":"com.other.app","version":"1.0.0"},"availableVersions":["2.0.0"]}
             ]}
            """
        let rules = #"{"governance":{"releases":"owner","appUpgrades":"owner","outbound":"owner"},"deadlines":[]}"#
        return pendingApprovalsFrom(
            try JSONDecoder().decode(AppsReport.self, from: Data(report.utf8)),
            rules: try JSONDecoder().decode(ReleaseRules.self, from: Data(rules.utf8)))
    }

    func testItemsKeepThisAppsUpgradesAndActionableReleases() throws {
        let items = ApprovalsModel.items(
            from: try Self.pending(org: "org1"), org: "org1", packageName: CalendarConstants.packageName,
            appName: "Mero Calendar")
        XCTAssertEqual(
            items.map(\.kind), [.upgrade(app: "app-1", version: "1.2.0"), .release(org: "org1", version: "2.3.110")])
        XCTAssertEqual(
            items[0].request(returnTo: "mero-calendar://consent"),
            .upgrade(app: "app-1", toVersion: "1.2.0", returnTo: "mero-calendar://consent"))
        XCTAssertEqual(
            items[1].request(returnTo: "x://y"),
            .release(scope: .org("org1"), version: "2.3.110", returnTo: "x://y"))
    }

    func testOperatorHeldDecisionsAreNotOffered() throws {
        let items = ApprovalsModel.items(
            from: try Self.pending(org: nil, upgradesBy: "operator", releasesBy: "operator"), org: nil,
            packageName: CalendarConstants.packageName, appName: "Mero Calendar")
        XCTAssertTrue(items.isEmpty)
    }

    func testLoadSkipsUnreadableScopesAndApproveOpensConsent() async throws {
        var requested: [ConsentRequest] = []
        let model = ApprovalsModel(
            packageName: CalendarConstants.packageName, appName: "Mero Calendar",
            fetch: { org in
                guard let org else { throw NotFound("no account report") }
                return try Self.pending(org: org)
            },
            consent: { build, _ in
                requested.append(build("mero-calendar://consent"))
                return try? JSONDecoder().decode(
                    ConsentResult.self, from: Data(#"{"requestId":"r1","kind":"upgrade","status":"approved"}"#.utf8))
            })
        await model.load(orgs: ["org1"])
        XCTAssertEqual(model.items.count, 2)
        let approved = await model.approve(model.items[0], orgs: ["org1"])
        XCTAssertTrue(approved)
        XCTAssertEqual(requested, [.upgrade(app: "app-1", toVersion: "1.2.0", returnTo: "mero-calendar://consent")])
        XCTAssertNil(model.approving)
    }

    func testTheConfirmationCodeIsShownBeforeThePageOpens() async throws {
        var opened = false
        let model = ApprovalsModel(
            packageName: CalendarConstants.packageName, appName: "Mero Calendar",
            fetch: { org in try Self.pending(org: org ?? "org1") },
            consent: { _, confirm in
                let started = try! JSONDecoder().decode(
                    ConsentStarted.self,
                    from: Data(#"{"requestId":"r1","url":"https://node/consent/r1","expiresAt":1,"code":"ABC-DEF"}"#.utf8))
                guard await confirm(started) else { return nil }
                opened = true
                return nil
            })
        await model.load(orgs: ["org1"])
        let item = try XCTUnwrap(model.items.first)
        let approving = Task { await model.approve(item, orgs: ["org1"]) }
        while model.confirmationCode == nil { await Task.yield() }
        XCTAssertEqual(model.confirmationCode, "ABC-DEF")
        model.answerConfirmation(false)
        let approved = await approving.value
        XCTAssertFalse(approved)
        XCTAssertFalse(opened)
        XCTAssertNil(model.confirmationCode)
        XCTAssertNil(model.error, "declining the code is not an error")
    }

    func testContractErrorsInWords() {
        func refusal(_ code: String, _ fields: [String: JSONValue] = [:]) -> AppError {
            AppError("refused", details: ["code": .string(code), "fields": .object(fields)])
        }
        XCTAssertEqual(ErrorText.describe(refusal("Forbidden"), doing: "save"), "Only the event's owner can change it.")
        XCTAssertEqual(
            ErrorText.describe(refusal("Invalid", ["message": .string("title cannot be empty")]), doing: "save"),
            "That isn't valid: title cannot be empty.")
        XCTAssertTrue(ErrorText.describe(refusal("NotFound", ["id": .string("e1")]), doing: "save").contains("no longer exists"))
    }

    func testClusterErrorsInWords() {
        XCTAssertEqual(
            ErrorText.describe(ConfirmCancelled(), doing: "save"), "The passkey prompt was cancelled.")
        XCTAssertTrue(
            ErrorText.describe(ReleaseDeadlineError("deadline passed"), doing: "save").contains("needs approval"))
        XCTAssertEqual(ErrorText.describe(LoginRequired("expired"), doing: "save"), "Your session ended. Sign in again.")
    }
}
