import Combine
import Foundation
import MeroKit

/// The workspace list: the orgs the account is in, founding one, and
/// joining one from an invitation.
@MainActor
final class WorkspacesModel: ObservableObject {
    @Published private(set) var workspaces: [Workspace] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isWorking = false
    /// A failure to show, in words.
    @Published var errorText: String?
    /// Something worth telling that is not a failure (e.g. HA not enabled yet).
    @Published var notice: String?

    private let backend: any ChatBackend
    /// Chat's package, when known: only orgs running it are chat
    /// workspaces (the web app filters the same way).
    private let applicationId: @MainActor () -> String?
    private let displayName: @MainActor () -> String

    /// `applicationId` is read on every load: the session resolves it from
    /// the registry after sign-in.
    init(
        backend: any ChatBackend, applicationId: @escaping @MainActor () -> String?,
        displayName: @escaping @MainActor () -> String
    ) {
        self.backend = backend
        self.applicationId = applicationId
        self.displayName = displayName
    }

    var hasRelay: Bool { backend.hasRelay }

    func load() async {
        guard backend.hasRelay else {
            workspaces = []
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let listed = try await backend.listWorkspaces()
            workspaces = Self.chatWorkspaces(listed, applicationId: applicationId())
                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            errorText = nil
        } catch {
            errorText = ChatErrorText.describe(error)
        }
    }

    /// Keep only chat's workspaces when chat's application id is known.
    nonisolated static func chatWorkspaces(_ listed: [Workspace], applicationId: String?) -> [Workspace] {
        guard let applicationId, !applicationId.isEmpty else { return listed }
        return listed.filter { $0.applicationId.lowercased() == applicationId.lowercased() }
    }

    /// Found a workspace, then give it `#general` as the web app does.
    @discardableResult
    func create(name rawName: String) async -> Bool {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        if let problem = Self.nameProblem(name) {
            errorText = problem
            return false
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let founded = try await backend.foundWorkspace(name: name)
            var notes: [String] = []
            if !founded.haEnabled {
                notes.append(
                    "Workspace created, but not hosted in the cloud yet, so invitations can't be claimed: "
                        + (founded.haError ?? "no reason given"))
            }
            await load()
            // The listing may lag the founding; the org runs chat either way.
            let workspace =
                workspaces.first(where: { $0.id == founded.namespaceId })
                ?? applicationId().map { Workspace(id: founded.namespaceId, name: name, applicationId: $0) }
            if let workspace {
                let creator = ChannelCreator(backend: backend)
                do {
                    _ = try await creator.create(
                        in: workspace, name: ChatConstants.generalChannel, isPublic: true, username: displayName())
                } catch {
                    notes.append("#general could not be created: \(ChatErrorText.describe(error))")
                }
            } else {
                notes.append("#general was not created: the new workspace is not listed yet.")
            }
            notice = notes.isEmpty ? nil : notes.joined(separator: "\n")
            errorText = nil
            return true
        } catch {
            errorText = ChatErrorText.describe(error)
            return false
        }
    }

    /// Redeem an invitation link or token. Returns the joined org id.
    func join(invitation input: String) async -> String? {
        guard let invitation = ChatInvitation.parse(input) else {
            errorText = "That isn't a Mero Chat invitation link."
            return nil
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let joined = try await backend.joinWorkspace(
                namespaceId: invitation.namespaceId, invitation: invitation.invitation)
            let name = invitation.workspaceName ?? ChatIdentity.short(invitation.namespaceId)
            notice =
                joined.published
                ? "Joined \(name)."
                : "The join to \(name) was sent but not published yet. Try again shortly."
            errorText = nil
            return invitation.namespaceId
        } catch {
            errorText = ChatErrorText.describe(error)
            return nil
        }
    }

    /// The shareable invitation link for a workspace.
    func inviteLink(for workspace: Workspace) async -> String? {
        isWorking = true
        defer { isWorking = false }
        do {
            let signed = try await backend.createInvitation(namespaceId: workspace.id)
            return try ChatInvitation(invitation: signed, workspaceName: workspace.name).link()
        } catch {
            errorText = ChatErrorText.describe(error)
            return nil
        }
    }

    /// Why a workspace or channel name is refused, or `nil`.
    nonisolated static func nameProblem(_ name: String) -> String? {
        if name.isEmpty { return "Enter a name." }
        if name.utf8.count > ChatConstants.maxNameBytes {
            return "Names can be at most \(ChatConstants.maxNameBytes) bytes."
        }
        return nil
    }
}
