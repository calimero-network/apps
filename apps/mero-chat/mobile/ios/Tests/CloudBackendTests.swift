import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

/// ``CloudChatBackend`` over the swift-sdk's app layer: what the chat screens
/// ask becomes the `MeroAppBackend` calls `CalimeroAppBackend` maps onto the 1.0
/// API (orgs, teams, app instances, invites, `/views` and `/intents`).
final class CloudBackendTests: XCTestCase {
    private let org = String(repeating: "0a", count: 32)

    private func seeded() -> InMemoryAppBackend {
        let app = InMemoryAppBackend()
        app.applicationId = ChatConstants.packageName
        app.namespaces = [AppNamespace(id: org, name: "Design", applicationId: ChatConstants.packageName)]
        app.subgroups = [
            org: [
                AppSubgroup(groupId: "team-general", name: "general", contextIds: ["app-general"]),
                AppSubgroup(groupId: "team-secret", name: "secret", contextIds: ["app-secret"]),
            ]
        ]
        return app
    }

    func testWorkspacesAreTheAccountsOrgs() async throws {
        let backend = CloudChatBackend(app: seeded())
        let workspaces = try await backend.listWorkspaces()
        XCTAssertEqual(workspaces, [Workspace(id: org, name: "Design", applicationId: ChatConstants.packageName)])
    }

    func testChannelGroupsAreTeamsAndInviteOnlyTeamsArePrivate() async throws {
        let backend = CloudChatBackend(app: seeded(), privateTeams: { _ in ["team-secret"] })
        let groups = try await backend.listChannelGroups(namespaceId: org)
        XCTAssertEqual(groups.map(\.groupId), ["team-general", "team-secret"])
        XCTAssertEqual(groups.map(\.contextIds), [["app-general"], ["app-secret"]])
        XCTAssertEqual(groups.map(\.isPrivate), [false, true])
    }

    func testCreatingAChannelMakesATeamAndAnAppInstance() async throws {
        let app = seeded()
        let backend = CloudChatBackend(app: app)
        let team = try await backend.createChannelGroup(namespaceId: org, name: "random", isPublic: false)
        let instance = try await backend.createContext(
            groupId: team, applicationId: ChatConstants.packageName, name: "random", initArgs: ["name": "random"])
        XCTAssertTrue(app.log.contains("createSubgroup \(org) random restricted"))
        XCTAssertEqual(app.initArgs[instance], ["name": "random"])
        let isMember = try await backend.isMember(contextId: instance)
        XCTAssertTrue(isMember)
    }

    func testInvitationsAreOrgInviteTokens() async throws {
        let app = seeded()
        let backend = CloudChatBackend(app: app)
        let invitation = try await backend.createInvitation(namespaceId: org)
        XCTAssertEqual(invitation.namespaceId, org)
        XCTAssertTrue(invitation.token.hasPrefix("inv_"))

        let joiner = InMemoryAppBackend(account: String(repeating: "cd", count: 32))
        joiner.joinRelayURL = "https://node.test"
        let joined = try await CloudChatBackend(app: joiner).joinWorkspace(namespaceId: org, invitation: invitation)
        XCTAssertEqual(joined, JoinedWorkspace(namespaceId: org, published: true, nodeURL: "https://node.test"))
        XCTAssertEqual(joiner.log, ["joinNamespace \(org)"])
    }

    /// Calls reach the app instance in the component ABI's names, and answers
    /// come back in v1's shapes (``ComponentChatContract``).
    func testContractCallsGoThroughTheAppInstance() async throws {
        let app = seeded()
        app.recording.setHandler { call in
            call.method == "getInfo"
                ? ["name": "general", "contextType": "Channel", "description": "", "createdAt": "1760000000", "creator": "x"]
                : .null
        }
        let backend = CloudChatBackend(app: app)
        let info = try await ChatAPI(contract: backend.contract).getInfo("app-general")
        XCTAssertEqual(info.name, "general")
        _ = try await backend.contract.execute(
            contextId: "app-general", method: "send_message",
            args: ChatAPI.sendMessageArgs(text: "hi", timestamp: 1_760_000_000, parentMessage: "m_1"))
        XCTAssertEqual(app.recording.calls.map(\.method), ["getInfo", "sendMessage"])
        XCTAssertEqual(app.recording.calls.map(\.path), [.query, .execute])
        XCTAssertEqual(app.recording.calls.map(\.contextId), ["app-general", "app-general"])
        let sent = app.recording.calls[1].args
        XCTAssertEqual(sent["timestamp"], "1760000000")
        XCTAssertEqual(sent["parentMessage"], "m_1")
        XCTAssertEqual(sent["mentionsUsernames"], .array([]))
    }

    func testBlobsRoundTripThroughTheirAppInstance() async throws {
        let backend = CloudChatBackend(app: seeded())
        let id = try await backend.uploadBlob(contextId: "app-general", data: Data("hello".utf8))
        let bytes = try await backend.downloadBlob(blobId: id, contextId: "app-general")
        XCTAssertEqual(bytes, Data("hello".utf8))
    }

    func testFailuresPassThrough() async {
        let app = seeded()
        app.failure = NotFound("no such org")
        do {
            _ = try await CloudChatBackend(app: app).listWorkspaces()
            XCTFail("expected a failure")
        } catch {
            XCTAssertTrue(error is NotFound)
        }
    }
}
