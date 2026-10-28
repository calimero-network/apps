import Foundation
import MeroKit
import XCTest

/// A workspace as one account sees it through the app's models.
@MainActor
struct LiveWorkspace {
    let workspaces: WorkspacesModel
    let workspace: Workspace
    let channels: ChannelsModel
    /// `#general`, joined.
    let general: ChannelEntry
}

/// The steps the cases share, each through the app's own models.
@MainActor
enum LiveScenario {
    /// Found a workspace as `founder` the way the Workspaces screen does
    /// (`WorkspacesModel.create`: founding through the relay, then `#general`
    /// as the web app makes it), and open its channel list.
    ///
    /// The founder registers no display name here (`displayName` is empty),
    /// so the founder flow can set it with `set_profile` and see it stick.
    static func foundWorkspace(_ founder: LiveAccount, rig: LiveRig) async throws -> LiveWorkspace {
        let backend = founder.backend
        let appId = rig.appId
        let workspaces = WorkspacesModel(backend: backend, applicationId: { appId }, displayName: { "" })
        XCTAssertTrue(workspaces.hasRelay)
        await workspaces.load()
        XCTAssertNil(workspaces.errorText, "listing a fresh account's workspaces")
        XCTAssertTrue(workspaces.workspaces.isEmpty, "a fresh account is in no workspace: \(workspaces.workspaces)")

        let name = "Live \(UUID().uuidString.prefix(8))"
        let created = await workspaces.create(name: name)
        guard created else {
            throw LiveFailure("founding \(name) failed: \(workspaces.errorText ?? "no reason given")")
        }
        XCTAssertNil(workspaces.errorText)
        // There is no cloud, so HA is refused and said so; #general must not be.
        let notice = workspaces.notice ?? ""
        XCTAssertFalse(notice.contains("#general"), "the founding note: \(notice)")

        // A fresh account: the one workspace it is in is the one it founded.
        try await eventually("the founded workspace is listed", detail: "\(workspaces.workspaces)") {
            await workspaces.load()
            return workspaces.workspaces.count == 1
        }
        let workspace = try XCTUnwrap(workspaces.workspaces.first)
        XCTAssertEqual(workspace.applicationId.lowercased(), appId, "the namespace runs chat's application")
        XCTAssertEqual(workspace.name, name, "the name set at founding (GroupMetadataSet) is listed")

        let channels = ChannelsModel(workspace: workspace, backend: backend, displayName: { "" })
        try await eventually(
            "#general is listed and joined",
            detail: "\(channels.channels) \(channels.errorText ?? "")"
        ) {
            await channels.load()
            return channels.channels.contains { $0.name == ChatConstants.generalChannel && $0.isJoined }
        }
        XCTAssertNil(channels.errorText)
        let general = try XCTUnwrap(channels.channels.first { $0.name == ChatConstants.generalChannel })
        XCTAssertEqual(general.kind, .channel)
        return LiveWorkspace(workspaces: workspaces, workspace: workspace, channels: channels, general: general)
    }

    /// The invitation link the Share button makes (`WorkspacesModel.inviteLink`).
    static func invite(_ founded: LiveWorkspace) async throws -> String {
        let link = await founded.workspaces.inviteLink(for: founded.workspace)
        let made = try XCTUnwrap(link, "minting an invitation: \(founded.workspaces.errorText ?? "no reason given")")
        let parsed = try XCTUnwrap(ChatInvitation.parse(made), "the app reads back its own link: \(made)")
        XCTAssertEqual(parsed.namespaceId.lowercased(), founded.workspace.id.lowercased())
        XCTAssertEqual(parsed.workspaceName, founded.workspace.name)
        return made
    }

    /// Redeem `link` as `member` the way the Join sheet does
    /// (`WorkspacesModel.join`: direct admission at the relay's `/admit`),
    /// reconnect as `SessionModel.didJoinWorkspace` does, then find the
    /// workspace and the channel `channelId` and join it (`ChannelsModel.join`,
    /// `MemberJoinedOpen` + `set_profile(displayName)`).
    static func join(
        _ member: LiveAccount, link: String, workspaceId: String, channelId: String, displayName: String,
        rig: LiveRig
    ) async throws -> LiveWorkspace {
        let appId = rig.appId
        let before = WorkspacesModel(
            backend: member.backend, applicationId: { appId }, displayName: { displayName })
        XCTAssertFalse(before.hasRelay, "a brand-new account has no relay until it joins")
        await before.load()
        XCTAssertTrue(before.workspaces.isEmpty)

        let joined = await before.join(invitation: link)
        guard let joined else {
            throw LiveFailure("\(member.label) could not redeem the invitation: \(before.errorText ?? "no reason given")")
        }
        XCTAssertEqual(joined.lowercased(), workspaceId.lowercased())
        XCTAssertNil(before.errorText)
        XCTAssertEqual(before.notice?.hasPrefix("Joined "), true, "the join was published: \(before.notice ?? "-")")

        try await member.didJoinWorkspace()
        XCTAssertTrue(member.backend.hasRelay, "the admitting relay is the account's relay now")

        let workspaces = WorkspacesModel(
            backend: member.backend, applicationId: { appId }, displayName: { displayName })
        try await eventually(
            "\(member.label) lists the joined workspace",
            detail: "\(workspaces.workspaces) \(workspaces.errorText ?? "")"
        ) {
            await workspaces.load()
            return workspaces.workspaces.contains { $0.id.lowercased() == workspaceId.lowercased() }
        }
        let workspace = try XCTUnwrap(
            workspaces.workspaces.first { $0.id.lowercased() == workspaceId.lowercased() })

        let channels = ChannelsModel(workspace: workspace, backend: member.backend, displayName: { displayName })
        try await eventually(
            "\(member.label) lists the channel", detail: "\(channels.channels) \(channels.errorText ?? "")"
        ) {
            await channels.load()
            return channels.channels.contains { $0.id == channelId }
        }
        let listed = try XCTUnwrap(channels.channels.first { $0.id == channelId })
        if !listed.isJoined {
            await channels.join(listed)
            XCTAssertNil(channels.errorText, "joining the open channel")
        }
        try await eventually(
            "\(member.label) is a member of the channel", detail: "\(channels.channels) \(channels.errorText ?? "")"
        ) {
            await channels.load()
            return channels.channels.contains { $0.id == channelId && $0.isJoined }
        }
        let general = try XCTUnwrap(channels.channels.first { $0.id == channelId })
        XCTAssertEqual(general.name, ChatConstants.generalChannel, "a member reads the channel's name from get_info")
        return LiveWorkspace(workspaces: workspaces, workspace: workspace, channels: channels, general: general)
    }

    /// The first message that reads as `text`.
    static func message(_ text: String, in model: ChannelModel) -> ChatMessage? {
        model.messages.first { $0.plainText == text }
    }
}

extension ChatMessage {
    /// What a person reads: bodies are stored as the web app's HTML (`<p>…</p>`).
    var plainText: String { RichText.parse(html: text).plainText }
}
