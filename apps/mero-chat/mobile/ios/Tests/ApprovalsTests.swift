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
                "name":"Launches","package":{"package":"\(ChatConstants.packageName)","version":"1.0.0"},
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
            from: try Self.pending(org: "org1"), org: "org1", packageName: ChatConstants.packageName,
            appName: "Mero Chat")
        XCTAssertEqual(
            items.map(\.kind), [.upgrade(app: "app-1", version: "1.2.0"), .release(org: "org1", version: "2.3.110")])
        XCTAssertEqual(
            items[0].request(returnTo: "mero-chat://consent"),
            .upgrade(app: "app-1", toVersion: "1.2.0", returnTo: "mero-chat://consent"))
        XCTAssertEqual(
            items[1].request(returnTo: "x://y"),
            .release(scope: .org("org1"), version: "2.3.110", returnTo: "x://y"))
    }

    func testOperatorHeldDecisionsAreNotOffered() throws {
        let items = ApprovalsModel.items(
            from: try Self.pending(org: nil, upgradesBy: "operator", releasesBy: "operator"), org: nil,
            packageName: ChatConstants.packageName, appName: "Mero Chat")
        XCTAssertTrue(items.isEmpty)
    }

    func testLoadSkipsUnreadableScopesAndApproveOpensConsent() async throws {
        var requested: [ConsentRequest] = []
        let model = ApprovalsModel(
            packageName: ChatConstants.packageName, appName: "Mero Chat",
            fetch: { org in
                guard let org else { throw NotFound("no account report") }
                return try Self.pending(org: org)
            },
            consent: { build in
                requested.append(build("mero-chat://consent"))
                return try? JSONDecoder().decode(
                    ConsentResult.self, from: Data(#"{"requestId":"r1","kind":"upgrade","status":"approved"}"#.utf8))
            })
        await model.load(orgs: ["org1"])
        XCTAssertEqual(model.items.count, 2)
        let approved = await model.approve(model.items[0], orgs: ["org1"])
        XCTAssertTrue(approved)
        XCTAssertEqual(requested, [.upgrade(app: "app-1", toVersion: "1.2.0", returnTo: "mero-chat://consent")])
        XCTAssertNil(model.approving)
    }
}
