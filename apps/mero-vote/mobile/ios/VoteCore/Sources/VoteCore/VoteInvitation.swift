import Foundation
import MeroKit

/// An invitation: Calimero 1.0's org invite token in the SDK's link shape
/// (``OrgInvitation``), the same keys the web app's 0.x links used:
///
/// - payload: `{"invitation": "inv_…", "namespaceId": "<org>", "contextId": "<app instance>"}`
/// - token: `base58(deflate(payload))` (MeroKit `InviteCodec`)
/// - link: `https://links.calimero.network/com.calimero.mero-vote/join?invitation=<token>`
///
/// The token grants the ORG (redeemed with `POST /invites/{token}/redeem`, which
/// joins the org it belongs to); `contextId` says which voting group in it to open
/// once joined. A pre-1.0 signed invitation is refused: a 1.0 cluster cannot redeem it.
/// (Kotlin `VoteInvitation`.)
public struct VoteInvitation: Sendable {
    public let invitation: OrgInvitation
    public let contextId: String

    public init(invitation: OrgInvitation, contextId: String) {
        self.invitation = invitation
        self.contextId = contextId
    }

    /// The org it admits to.
    public var namespaceId: String { invitation.namespaceId }

    public func token() throws -> String {
        try OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: contextId, name: invitation.name
        ).encoded()
    }

    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: VoteConstants.packageName)
    }

    /// Parse a link (https or `calimero://`), a bare token or raw JSON. `nil`
    /// when it holds no Mero Vote invitation, including another app's link.
    public static func parse(_ input: String) -> VoteInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("{") { return parse(json: trimmed) }
        guard let token = InviteLink.token(fromPasted: trimmed, expectedSlug: VoteConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// Both ids present, and the invitation an invite token (the SDK's
    /// ``OrgInvitation`` decoding refuses a 0.x signed envelope).
    public static func parse(json: String) -> VoteInvitation? {
        guard let invitation = try? JSONDecoder().decode(OrgInvitation.self, from: Data(json.utf8)),
            let contextId = invitation.contextId?.nilIfEmpty
        else { return nil }
        return VoteInvitation(invitation: invitation, contextId: contextId)
    }
}

/// Redeeming an invitation link: confirm, join the workspace, open the voting
/// group. (Kotlin `InvitationModel`; the web's `useJoinFromInvitation`.)
@MainActor
public final class InvitationModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case confirm
        case joining
        case joined(GroupRef)
        case failed(String)
    }

    @Published public private(set) var stage: Stage = .idle
    public private(set) var invitation: VoteInvitation?

    private let attempts: Int
    private let retryDelay: Duration

    public init(attempts: Int = 4, retryDelay: Duration = .milliseconds(1500)) {
        self.attempts = attempts
        self.retryDelay = retryDelay
    }

    /// Read a link or a pasted code. `false` (and a failed stage) when it is
    /// not a Mero Vote invitation.
    @discardableResult
    public func open(_ raw: String) -> Bool {
        guard let parsed = VoteInvitation.parse(raw) else {
            invitation = nil
            stage = .failed("This isn't a Mero Vote invitation. Check the link and try again.")
            return false
        }
        invitation = parsed
        stage = .confirm
        return true
    }

    /// Join (`POST /invites/{token}/redeem`). `backend` is read again after `didJoin`.
    public func accept(
        backend: @escaping @MainActor () -> (any MeroAppBackend)?,
        didJoin: @escaping @MainActor () async -> Void
    ) async {
        guard let invitation, let current = backend() else {
            stage = .failed("Sign in to join.")
            return
        }
        stage = .joining
        do {
            _ = try await current.joinNamespace(namespaceId: invitation.namespaceId, invitation: invitation.invitation)
        } catch {
            let text = "\(error)".lowercased()
            if !(text.contains("already a member") || text.contains("already member") || text.contains("already joined")) {
                stage = .failed(VoteErrorText.describe(error))
                return
            }
        }
        await didJoin()
        // The group's context is directly in the namespace; membership arrives
        // with the namespace's, but ask for it in case it has not projected yet.
        for attempt in 0..<attempts {
            if attempt > 0 { try? await Task.sleep(for: retryDelay) }
            guard let now = backend() else { break }
            if (try? await now.isMember(contextId: invitation.contextId)) == true { break }
            if (try? await now.joinContext(contextId: invitation.contextId)) != nil { break }
        }
        var workspace = "Workspace"
        if let listed = try? await backend()?.listNamespaces(),
            let name = listed.first(where: { $0.id == invitation.namespaceId })?.name?.nilIfEmpty
        {
            workspace = name
        }
        stage = .joined(GroupRef(namespaceId: invitation.namespaceId, workspaceName: workspace, contextId: invitation.contextId))
    }

    public func reset() {
        invitation = nil
        stage = .idle
    }
}
