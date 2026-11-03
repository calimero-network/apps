import ForumCore
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
                "name":"Design","package":{"package":"\(ForumConstants.packageName)","version":"1.0.0"},
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
            from: try Self.pending(org: "org1"), org: "org1", packageName: ForumConstants.packageName,
            appName: "Mero Forum")
        XCTAssertEqual(
            items.map(\.kind), [.upgrade(app: "app-1", version: "1.2.0"), .release(org: "org1", version: "2.3.110")])
        XCTAssertEqual(
            items[0].request(returnTo: "mero-forum://consent"),
            .upgrade(app: "app-1", toVersion: "1.2.0", returnTo: "mero-forum://consent"))
        XCTAssertEqual(
            items[1].request(returnTo: "x://y"),
            .release(scope: .org("org1"), version: "2.3.110", returnTo: "x://y"))
    }

    func testOperatorHeldDecisionsAreNotOffered() throws {
        let items = ApprovalsModel.items(
            from: try Self.pending(org: nil, upgradesBy: "operator", releasesBy: "operator"), org: nil,
            packageName: ForumConstants.packageName, appName: "Mero Forum")
        XCTAssertTrue(items.isEmpty)
    }

    static let started = try! JSONDecoder().decode(
        ConsentStarted.self,
        from: Data(#"{"requestId":"r1","url":"https://node/consent/r1","expiresAt":0,"code":"ABC-123"}"#.utf8))

    private func model(requested: @escaping (ConsentRequest) -> Void) -> ApprovalsModel {
        ApprovalsModel(
            packageName: ForumConstants.packageName, appName: "Mero Forum",
            fetch: { org in
                guard let org else { throw NotFound("no account report") }
                return try Self.pending(org: org)
            },
            consent: { build, confirm in
                guard await confirm(Self.started) else {
                    return try? JSONDecoder().decode(
                        ConsentResult.self, from: Data(#"{"requestId":"r1","kind":"upgrade","status":"pending"}"#.utf8))
                }
                requested(build("mero-forum://consent"))
                return try? JSONDecoder().decode(
                    ConsentResult.self, from: Data(#"{"requestId":"r1","kind":"upgrade","status":"approved"}"#.utf8))
            })
    }

    private func waitForConfirmation(_ model: ApprovalsModel) async {
        for _ in 0..<200 where model.confirmation == nil { await Task.yield() }
    }

    func testLoadSkipsUnreadableScopesAndApproveShowsTheCodeThenOpensConsent() async throws {
        var requested: [ConsentRequest] = []
        let model = model { requested.append($0) }
        await model.load(orgs: ["org1"])
        XCTAssertEqual(model.items.count, 2)
        let item = model.items[0]
        let approving = Task { await model.approve(item, orgs: ["org1"]) }
        await waitForConfirmation(model)
        XCTAssertEqual(model.confirmation?.code, "ABC-123", "the code shows before the page opens")
        XCTAssertEqual(model.confirmation?.title, item.title)
        XCTAssertTrue(requested.isEmpty)
        model.answer(true)
        let approved = await approving.value
        XCTAssertTrue(approved)
        XCTAssertEqual(requested, [.upgrade(app: "app-1", toVersion: "1.2.0", returnTo: "mero-forum://consent")])
        XCTAssertNil(model.approving)
        XCTAssertNil(model.confirmation)
    }

    func testCancellingTheCodeKeepsThePageClosed() async throws {
        var requested: [ConsentRequest] = []
        let model = model { requested.append($0) }
        await model.load(orgs: ["org1"])
        let item = model.items[0]
        let approving = Task { await model.approve(item, orgs: ["org1"]) }
        await waitForConfirmation(model)
        model.answer(false)
        let approved = await approving.value
        XCTAssertFalse(approved)
        XCTAssertTrue(requested.isEmpty)
        XCTAssertNil(model.error, "cancelling is not an error")
    }

    func testClusterErrorsInWords() {
        XCTAssertEqual(ForumErrorText.describe(ConfirmCancelled()), "The passkey prompt was cancelled.")
        XCTAssertTrue(ForumErrorText.describe(ReleaseDeadlineError("deadline passed")).contains("needs approval"))
        XCTAssertEqual(ForumErrorText.describe(LoginRequired("expired")), "Your session ended. Sign in again.")
        XCTAssertTrue(ForumErrorText.describe(WrongNode("wrong node")).contains("doesn't serve your account"))
        XCTAssertTrue(ForumErrorText.describe(ConsentStale("stale")).contains("out of date"))
    }

    func testContractRefusalsInWords() {
        let forbidden = AppError(
            "refused", details: ["code": .string("Forbidden"), "fields": .object(["message": .string("only a moderator can do that")])])
        XCTAssertEqual(ForumErrorText.describe(forbidden), "Only a moderator can do that.")
        let missing = AppError(
            "refused", details: ["code": .string("NotFound"), "fields": .object(["what": .string("post"), "id": .string("p1")])])
        XCTAssertEqual(ForumErrorText.describe(missing), "This post no longer exists. It may have been deleted.")
        let invalid = AppError("refused", details: ["code": .string("Invalid"), "fields": .object([:])])
        XCTAssertEqual(ForumErrorText.describe(invalid), "That isn't valid. Check it and try again.")
    }
}
