import MeroKit
import XCTest

@MainActor
final class WorkspaceModelsTests: XCTestCase {
    private let chatApp = String(repeating: "ee", count: 32)
    private let otherApp = String(repeating: "0f", count: 32)

    private func workspacesModel(_ backend: FakeChatBackend, appId: String? = nil) -> WorkspacesModel {
        WorkspacesModel(backend: backend, applicationId: { appId }, displayName: { "alice" })
    }

    // MARK: Workspaces

    func testOnlyChatsNamespacesAreWorkspaces() async {
        let backend = FakeChatBackend()
        backend.workspaces = [
            Workspace(id: "n1", name: "Team", applicationId: chatApp),
            Workspace(id: "n2", name: "Docs", applicationId: otherApp),
        ]
        let model = workspacesModel(backend, appId: chatApp)
        await model.load()
        XCTAssertEqual(model.workspaces.map(\.id), ["n1"])

        let unfiltered = workspacesModel(backend, appId: nil)
        await unfiltered.load()
        XCTAssertEqual(unfiltered.workspaces.count, 2, "with no id known yet, nothing is hidden")
    }

    func testARelaylessAccountListsNothingAndSaysSo() async {
        let backend = FakeChatBackend()
        backend.hasRelay = false
        let model = workspacesModel(backend)
        await model.load()
        XCTAssertFalse(model.hasRelay)
        XCTAssertTrue(model.workspaces.isEmpty)
        XCTAssertFalse(backend.log.contains("listWorkspaces"))
    }

    func testCreatingAWorkspaceFoundsItThenMakesGeneral() async {
        let backend = FakeChatBackend()
        let id = backend.founded.namespaceId
        backend.workspaces = [Workspace(id: id, name: "Team", applicationId: chatApp)]
        let model = workspacesModel(backend, appId: chatApp)

        let ok = await model.create(name: "  Team ")

        XCTAssertTrue(ok)
        XCTAssertEqual(
            backend.log.filter { !$0.hasPrefix("list") },
            [
                "foundWorkspace Team",
                "createChannelGroup \(id) general open",
                "createContext group-1 \(chatApp) general",
            ])
        XCTAssertEqual(backend.createdContextInitArgs.first?["context_type"], "Channel")
        XCTAssertEqual(backend.createdContextInitArgs.first?["name"], "general")
        // The creator's name in the new channel, as a warrant.
        let profile = backend.recording.calls("set_profile").first
        XCTAssertEqual(profile?.path, .execute)
        XCTAssertEqual(profile?.contextId, "ctx-group-1")
        XCTAssertEqual(profile?.args["username"], "alice")
        XCTAssertNil(model.notice)
    }

    func testAWorkspaceTheCloudWillNotHostSaysWhy() async {
        let backend = FakeChatBackend()
        backend.founded = FoundedWorkspace(
            namespaceId: backend.founded.namespaceId, haEnabled: false, haError: "link the account to a cloud user")
        let model = workspacesModel(backend, appId: chatApp)
        await model.create(name: "Team")
        XCTAssertTrue(model.notice?.contains("link the account to a cloud user") ?? false, model.notice ?? "")
    }

    func testANameOverTheCapIsRefusedBeforeAnythingIsSent() async {
        let backend = FakeChatBackend()
        let model = workspacesModel(backend)
        let ok = await model.create(name: String(repeating: "é", count: 33))
        XCTAssertFalse(ok)
        XCTAssertNotNil(model.errorText)
        XCTAssertTrue(backend.log.isEmpty)
    }

    func testJoiningRedeemsTheInvitationsNamespace() async throws {
        let backend = FakeChatBackend()
        let model = workspacesModel(backend)
        let link = try ChatInvitation(invitation: ChatFixtures.signedInvitation(), workspaceName: "Design").link()

        let joined = await model.join(invitation: link)

        XCTAssertEqual(joined, ChatFixtures.namespaceId)
        XCTAssertEqual(backend.joinedNamespaces, [ChatFixtures.namespaceId])
        XCTAssertTrue(model.notice?.contains("Design") ?? false)
    }

    func testAJoinTheRelayRefusesShowsTheStepsReason() async throws {
        let backend = FakeChatBackend()
        backend.failure = BootstrapFailure(step: .notInvited, reason: "Ask for a fresh invitation.")
        let model = workspacesModel(backend)
        let link = try ChatInvitation(invitation: ChatFixtures.signedInvitation(), workspaceName: nil).link()

        let joined = await model.join(invitation: link)

        XCTAssertNil(joined)
        XCTAssertEqual(model.errorText, "Ask for a fresh invitation.")
    }

    func testSomethingThatIsNotAnInvitationIsRefused() async {
        let backend = FakeChatBackend()
        let model = workspacesModel(backend)
        let joined = await model.join(invitation: "https://example.com/nope")
        XCTAssertNil(joined)
        XCTAssertNotNil(model.errorText)
        XCTAssertTrue(backend.joinedNamespaces.isEmpty)
    }

    func testAnInviteLinkCarriesTheWorkspaceName() async throws {
        let backend = FakeChatBackend()
        let model = workspacesModel(backend)
        let link = await model.inviteLink(for: Workspace(id: ChatFixtures.namespaceId, name: "Team", applicationId: ""))
        let parsed = try XCTUnwrap(ChatInvitation.parse(try XCTUnwrap(link)))
        XCTAssertEqual(parsed.workspaceName, "Team")
        XCTAssertEqual(backend.log, ["createInvitation \(ChatFixtures.namespaceId)"])
    }

    // MARK: Channels

    func testChannelsAndDmsAreSplitAndUnjoinedChannelsOfferAJoin() async {
        let contract = RecordingChatContract { call in
            switch (call.contextId, call.method) {
            case ("c-general", "get_info"):
                return JSONValue.parse(
                    #"{"name":"general","context_type":"Channel","description":"","created_at":1,"creator":"x"}"#)
            case ("c-dm", "get_info"):
                return JSONValue.parse(
                    #"{"name":"DM: bob","context_type":"Dm","description":"{\"c\":\"bob\",\"o\":\"alice\"}","#
                        + #""created_at":1,"creator":"someone-else"}"#)
            case (_, "get_unread_count"):
                return JSONValue.number(call.contextId == "c-general" ? 4 : 0)
            default:
                return nil
            }
        }
        let backend = FakeChatBackend(contract: contract)
        let workspace = Workspace(id: "ns", name: "Team", applicationId: chatApp)
        backend.groups["ns"] = [
            ChannelGroupListing(groupId: "g1", name: "general", contextIds: ["c-general"]),
            ChannelGroupListing(groupId: "g2", name: "random", contextIds: ["c-random"]),
            ChannelGroupListing(groupId: "g3", name: "DM_CONTEXT_abc", contextIds: ["c-dm"]),
            ChannelGroupListing(groupId: "g4", name: "empty", contextIds: []),
        ]
        backend.members = ["c-general", "c-dm"]
        let model = ChannelsModel(workspace: workspace, backend: backend, displayName: { "alice" })

        await model.load()

        XCTAssertEqual(model.channels.map(\.name), ["general", "random"])
        XCTAssertEqual(model.channels.map(\.isJoined), [true, false])
        XCTAssertEqual(model.channels.first?.unread, 4)
        XCTAssertEqual(model.directMessages.map(\.name), ["bob"])
        XCTAssertEqual(model.directMessages.first?.kind, .dm)
        // Nothing is read from a channel the account is not in.
        XCTAssertTrue(contract.calls.allSatisfy { $0.contextId != "c-random" })

        model.markOpened("c-general")
        XCTAssertEqual(model.channels.first?.unread, 0)
    }

    func testJoiningAChannelThenRegistersTheName() async {
        let backend = FakeChatBackend()
        let workspace = Workspace(id: "ns", name: "Team", applicationId: chatApp)
        backend.groups["ns"] = [ChannelGroupListing(groupId: "g2", name: "random", contextIds: ["c-random"])]
        let model = ChannelsModel(workspace: workspace, backend: backend, displayName: { "alice" })
        await model.load()

        await model.join(model.channels[0])

        XCTAssertTrue(backend.log.contains("joinChannel c-random"))
        XCTAssertEqual(backend.recording.calls("set_profile").first?.contextId, "c-random")
        XCTAssertEqual(model.channels.first?.isJoined, true)
    }

    func testCreatingAPrivateChannelMakesARestrictedSubgroup() async {
        let backend = FakeChatBackend()
        let workspace = Workspace(id: "ns", name: "Team", applicationId: chatApp)
        let model = ChannelsModel(workspace: workspace, backend: backend, displayName: { "" })

        let ok = await model.create(name: "#secret", isPublic: false)

        XCTAssertTrue(ok)
        XCTAssertTrue(backend.log.contains("createChannelGroup ns secret restricted"), "\(backend.log)")
        XCTAssertTrue(backend.log.contains("createContext group-1 \(chatApp) secret"))
        XCTAssertTrue(backend.recording.calls("set_profile").isEmpty, "no name, no set_profile")
    }
}
