import Foundation
import MeroKit

/// Where a redeemed invitation lands: a space, or one forum in it.
public struct InvitationDestination: Equatable, Sendable {
    public let namespaceId: String
    public let spaceName: String
    public let forum: ForumRef?
}

/// Redeeming an invitation link: confirm, join the space, and (for a forum
/// invite) join the forum, then say where to go. (Kotlin `InvitationModel`;
/// the web app's `InvitationPrompt` + `redeemInvite`.)
@MainActor
public final class InvitationModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case confirm(title: String, isForum: Bool)
        case joining(title: String)
        case joined(InvitationDestination)
        case failed(String)
    }

    @Published public private(set) var stage: Stage = .idle
    public private(set) var invitation: ForumInvitation?

    /// How many times, and how far apart, to ask a forum to admit us while
    /// the space membership projects to it.
    private let forumAttempts: Int
    private let forumRetryDelay: Duration

    public init(forumAttempts: Int = 4, forumRetryDelay: Duration = .milliseconds(1500)) {
        self.forumAttempts = forumAttempts
        self.forumRetryDelay = forumRetryDelay
    }

    /// Read a link or a pasted code. `false` (and a failed stage) when it is
    /// not a Mero Forum invitation.
    @discardableResult
    public func open(_ raw: String) -> Bool {
        guard let parsed = ForumInvitation.parse(raw) else {
            invitation = nil
            stage = .failed("This isn't a Mero Forum invitation. Check the link and try again.")
            return false
        }
        invitation = parsed
        stage = .confirm(title: parsed.title, isForum: parsed.kind == .forum)
        return true
    }

    /// Join. `backend` is read again after `didJoin`, which may hand the
    /// session the admitting relay.
    public func accept(
        backend: @escaping @MainActor () -> (any MeroAppBackend)?,
        didJoin: @escaping @MainActor () async -> Void
    ) async {
        guard let invitation, let current = backend() else {
            stage = .failed("Sign in to join.")
            return
        }
        stage = .joining(title: invitation.title)
        let namespaceId = invitation.namespaceId
        do {
            _ = try await current.joinNamespace(namespaceId: namespaceId, invitation: invitation.invitation)
        } catch {
            let text = "\(error)".lowercased()
            if !(text.contains("already a member") || text.contains("already member") || text.contains("already joined")) {
                stage = .failed(ForumErrorText.describe(error))
                return
            }
        }
        await didJoin()
        let spaceName = invitation.spaceName ?? "Space"
        var forum: ForumRef?
        if invitation.kind == .forum, let contextId = invitation.contextId, let forumId = invitation.forumId {
            let ref = ForumRef(
                namespaceId: namespaceId, spaceName: spaceName, forumId: forumId,
                forumName: invitation.forumName ?? "Forum", contextId: contextId)
            if await joinForum(contextId: contextId, backend: backend) { forum = ref }
        }
        stage = .joined(InvitationDestination(namespaceId: namespaceId, spaceName: spaceName, forum: forum))
    }

    private func joinForum(contextId: String, backend: @MainActor () -> (any MeroAppBackend)?) async -> Bool {
        for attempt in 0..<forumAttempts {
            if attempt > 0 { try? await Task.sleep(for: forumRetryDelay) }
            guard let current = backend() else { return false }
            if (try? await current.isMember(contextId: contextId)) == true { return true }
            if (try? await current.joinContext(contextId: contextId)) != nil { return true }
        }
        return false
    }

    /// Not now, or done.
    public func reset() {
        invitation = nil
        stage = .idle
    }
}
