@testable import IssueTrackerCore
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
                "name":"Launches","package":{"package":"\(Tracker.packageName)","version":"1.0.0"},
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
            from: try Self.pending(org: "org1"), org: "org1", packageName: Tracker.packageName,
            appName: "Mero Issue Tracker")
        XCTAssertEqual(
            items.map(\.kind), [.upgrade(app: "app-1", version: "1.2.0"), .release(org: "org1", version: "2.3.110")])
        XCTAssertEqual(
            items[0].request(returnTo: "mero-issues://consent"),
            .upgrade(app: "app-1", toVersion: "1.2.0", returnTo: "mero-issues://consent"))
        XCTAssertEqual(
            items[1].request(returnTo: "x://y"),
            .release(scope: .org("org1"), version: "2.3.110", returnTo: "x://y"))
    }

    func testOperatorHeldDecisionsAreNotOffered() throws {
        let items = ApprovalsModel.items(
            from: try Self.pending(org: nil, upgradesBy: "operator", releasesBy: "operator"), org: nil,
            packageName: Tracker.packageName, appName: "Mero Issue Tracker")
        XCTAssertTrue(items.isEmpty)
    }

    func testLoadSkipsUnreadableScopesAndApproveOpensConsent() async throws {
        var requested: [ConsentRequest] = []
        var opened = 0
        let model = ApprovalsModel(
            packageName: Tracker.packageName, appName: "Mero Issue Tracker",
            fetch: { org in
                guard let org else { throw NotFound("no account report") }
                return try Self.pending(org: org)
            },
            consent: { build, confirm in
                requested.append(build("mero-issues://consent"))
                let started = try! JSONDecoder().decode(
                    ConsentStarted.self,
                    from: Data(#"{"requestId":"r1","url":"https://n/consent/r1","expiresAt":1,"code":"ABC-DEF"}"#.utf8))
                guard await confirm(started) else { return nil }
                opened += 1
                return try? JSONDecoder().decode(
                    ConsentResult.self, from: Data(#"{"requestId":"r1","kind":"upgrade","status":"approved"}"#.utf8))
            })
        await model.load(orgs: ["org1"])
        XCTAssertEqual(model.items.count, 2)

        // The code is shown first; declining it never opens the page.
        let declined = Task { await model.approve(model.items[0], orgs: ["org1"]) }
        while model.confirmationCode == nil { await Task.yield() }
        XCTAssertEqual(model.confirmationCode, "ABC-DEF")
        model.answerConfirmation(false)
        let declinedResult = await declined.value
        XCTAssertFalse(declinedResult)
        XCTAssertEqual(opened, 0)
        XCTAssertNil(model.error)

        let approving = Task { await model.approve(model.items[0], orgs: ["org1"]) }
        while model.confirmationCode == nil { await Task.yield() }
        model.answerConfirmation(true)
        let approved = await approving.value
        XCTAssertTrue(approved)
        XCTAssertEqual(opened, 1)
        XCTAssertEqual(requested.last, .upgrade(app: "app-1", toVersion: "1.2.0", returnTo: "mero-issues://consent"))
        XCTAssertNil(model.approving)
        XCTAssertNil(model.confirmationCode)
    }

    func testClusterErrorsInWords() {
        XCTAssertEqual(TrackerFormat.errorText(ConfirmCancelled()), "The passkey prompt was cancelled.")
        XCTAssertTrue(TrackerFormat.errorText(ReleaseDeadlineError("deadline passed")).contains("needs approval"))
        XCTAssertEqual(TrackerFormat.errorText(LoginRequired("expired")), "Your session ended. Sign in again.")
        XCTAssertTrue(TrackerFormat.errorText(WrongNode("moved")).contains("Sign in again"))
    }

    func testContractRefusalsInWords() {
        func app(_ code: String, _ fields: [String: JSONValue]) -> AppError {
            AppError("refused", details: ["code": .string(code), "fields": .object(fields)])
        }
        XCTAssertEqual(
            TrackerFormat.errorText(app("Forbidden", ["message": .string("only the author may edit a comment")])),
            "Only the author may edit a comment.")
        XCTAssertEqual(
            TrackerFormat.errorText(app("NotFound", ["id": .string("issue-1-ab")])),
            "That issue no longer exists. It may have been deleted.")
        XCTAssertEqual(
            TrackerFormat.errorText(app("NotFound", ["id": .string("comment-1-ab")])), "That comment no longer exists.")
        XCTAssertEqual(
            TrackerFormat.errorText(app("Invalid", ["message": .string("title must be 1 to 64 characters")])),
            "Title must be 1 to 64 characters.")
    }
}
