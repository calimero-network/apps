import Foundation
import MeroKit
import XCTest
@testable import ModelsCore

@MainActor
final class ApprovalsTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    /// A report as `GET /auth/apps` answers it: one unapproved release, one app with a newer version.
    private func pending(scope: String = #"{"kind":"account"}"#, releasesHeldBy: String = "owner") throws
        -> PendingApprovals
    {
        let governance = #"{"releases":"\#(releasesHeldBy)","appUpgrades":"owner","outbound":"owner"}"#
        let report = try decode(
            AppsReport.self,
            """
            {"scope":\(scope),"governance":\(governance),"approvedReleases":["2.3.109"],
             "clusterReleases":[{"release":"2.3.110","nodes":3,"approved":false},{"release":"2.3.109","nodes":3,"approved":true}],
             "apps":[{"app":"app1","group":1,"scope":\(scope),"bundle":"b","package":{"package":"com.calimero.mero-models","version":"1.0.0"},
               "upgradesHeldBy":"owner","replicas":[],"name":"Crate kit","availableVersions":["1.1.0"]}]}
            """)
        let rules = try decode(
            ReleaseRules.self,
            #"{"governance":\#(governance),"deadlines":[{"version":"2.3.110","after":"2026-11-30T00:00:00Z","afterSecs":1796000000}]}"#)
        return pendingApprovalsFrom(report, rules: rules, now: 0)
    }

    func testTheAccountsDecisionsBecomeItems() throws {
        let items = ApprovalItem.from(try pending())
        XCTAssertEqual(
            items,
            [
                .release(scope: .account, version: "2.3.110", deadline: "2026-11-30T00:00:00Z"),
                .upgrade(app: "app1", name: "Crate kit", from: "1.0.0", to: "1.1.0"),
            ])
        XCTAssertEqual(items[1].title, "Upgrade Crate kit to 1.1.0")
        XCTAssertEqual(
            items[0].request(returnTo: "mero-models://enrol"),
            .release(scope: .account, version: "2.3.110", returnTo: "mero-models://enrol"))
    }

    func testAnOperatorsDecisionIsNotTheAccounts() throws {
        let items = ApprovalItem.from(try pending(releasesHeldBy: "operator"))
        XCTAssertEqual(items.map(\.id), ["upgrade:app1:1.1.0"])
    }

    func testApprovingShowsTheCodeOpensThePageThenRereads() async throws {
        let account = try pending()
        let org = try pending(scope: #"{"kind":"org","org":"org1"}"#)
        var loads: [String?] = []
        var asked: [ConsentRequest] = []
        var opened = false
        let approved = try decode(ConsentResult.self, #"{"requestId":"r1","kind":"release","status":"approved"}"#)
        let started = try decode(ConsentStarted.self, #"{"requestId":"r1","url":"https://n/consent/r1","expiresAt":0}"#)
        let model = ApprovalsModel(
            load: { scope in
                loads.append(scope)
                if scope == "denied" { throw URLError(.userAuthenticationRequired) }
                return scope == nil ? account : org
            },
            consent: { build, confirm in
                asked.append(build("mero-models://consent"))
                opened = await confirm(started)
                return opened ? approved : nil
            })
        await model.refresh(orgs: ["org1", "denied"])
        XCTAssertEqual(loads, [nil, "org1", "denied"])
        // The account's release, its upgrade, and the org's release (the same upgrade only once).
        XCTAssertEqual(model.items.count, 3)
        let approving = Task { await model.approve(model.items[0]) }
        while model.code == nil { await Task.yield() }
        // A node that predates `code`: the app works it out from the request id, as the page does.
        XCTAssertEqual(model.code, confirmationCode("r1"))
        model.continueToPage()
        await approving.value
        XCTAssertTrue(opened)
        XCTAssertNil(model.code)
        XCTAssertEqual(asked, [.release(scope: .account, version: "2.3.110", returnTo: "mero-models://consent")])
        XCTAssertEqual(model.message, "Approved.")
        XCTAssertNil(model.busy)
        XCTAssertEqual(loads.count, 6)
    }

    func testStoppingAtTheCodeApprovesNothing() async throws {
        let started = try decode(
            ConsentStarted.self, #"{"requestId":"r2","url":"https://n/consent/r2","expiresAt":0,"code":"ABC-DEF"}"#)
        let model = ApprovalsModel(
            load: { _ in try self.pending() },
            consent: { _, confirm in
                _ = await confirm(started)
                return nil
            })
        await model.refresh()
        let approving = Task { await model.approve(model.items[0]) }
        while model.code == nil { await Task.yield() }
        XCTAssertEqual(model.code, "ABC-DEF")
        model.cancelCode()
        await approving.value
        XCTAssertEqual(model.message, "Nothing was approved.")
    }

    func testAFailedRequestIsSaidInWords() async throws {
        let model = ApprovalsModel(
            load: { _ in try self.pending() },
            consent: { _, _ in throw ConsentStale("changed") })
        await model.refresh()
        await model.approve(model.items[0])
        XCTAssertEqual(model.message, "What you were asked to approve changed in the meantime. Review it again.")
    }
}
