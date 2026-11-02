import Foundation
import MeroKit

/// An invitation: Calimero 1.0's org invite token. Two link shapes open it:
///
/// - the SDK's (what this app mints, ``OrgInvitation``):
///   `https://links.calimero.network/com.calimero.mero-vote/join?invitation=<base58(deflate(payload))>`,
///   payload `{"invitation": "inv_…", "namespaceId": "<org>", "contextId": "<app instance>"}`;
/// - the web app's: its own address with `?invite=inv_…` (the token alone).
///
/// The token grants the ORG (redeemed with `POST /invites/{token}/redeem`, which joins the org
/// it belongs to); `contextId`, when the link names one, says which voting group in it to open
/// once joined, and otherwise the org's first one opens. A pre-1.0 signed invitation is refused:
/// a 1.0 cluster cannot redeem it. (Kotlin `VoteInvitation`.)
public struct VoteInvitation: Sendable {
    public let invitation: OrgInvitation
    /// The voting group to open after joining; `nil` for a web link.
    public let contextId: String?

    public init(invitation: OrgInvitation, contextId: String?) {
        self.invitation = invitation
        self.contextId = contextId
    }

    /// The org it admits to; empty for a web link (the node names it when it is redeemed).
    public var namespaceId: String { invitation.namespaceId }

    public func token() throws -> String {
        try OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: contextId, name: invitation.name
        ).encoded()
    }

    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: VoteConstants.packageName)
    }

    /// The query parameter the web app's links carry the token in.
    public static let webParam = "invite"

    /// Parse a link (https or `calimero://`), a bare code, a bare `inv_…` token or raw JSON.
    /// `nil` when it holds no Mero Vote invitation, including another app's link.
    public static func parse(_ input: String) -> VoteInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("{") { return parse(json: trimmed) }
        if trimmed.hasPrefix("inv_"), !trimmed.contains(where: { $0.isWhitespace || $0 == "/" || $0 == "?" }) {
            return VoteInvitation(invitation: OrgInvitation(namespaceId: "", token: trimmed), contextId: nil)
        }
        if let token = webToken(trimmed) {
            return VoteInvitation(invitation: OrgInvitation(namespaceId: "", token: token), contextId: nil)
        }
        guard let token = InviteLink.token(fromPasted: trimmed, expectedSlug: VoteConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The web app's `?invite=inv_…`, from an http(s) link.
    static func webToken(_ raw: String) -> String? {
        guard let url = URLComponents(string: raw), let scheme = url.scheme?.lowercased(),
            scheme == "https" || scheme == "http",
            let token = url.queryItems?.first(where: { $0.name == webParam })?.value?.nilIfEmpty
        else { return nil }
        return token
    }

    /// The SDK payload: the org and the invitation present, the invitation an invite token (the
    /// SDK's ``OrgInvitation`` decoding refuses a 0.x signed envelope).
    public static func parse(json: String) -> VoteInvitation? {
        guard let invitation = try? JSONDecoder().decode(OrgInvitation.self, from: Data(json.utf8)) else { return nil }
        return VoteInvitation(invitation: invitation, contextId: invitation.contextId?.nilIfEmpty)
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
        /// Joined a workspace that has no voting group yet.
        case joinedWorkspace(String)
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
        var org = invitation.namespaceId
        do {
            let joined = try await current.joinNamespace(namespaceId: org, invitation: invitation.invitation)
            if !joined.namespaceId.isEmpty { org = joined.namespaceId }
        } catch {
            let text = "\(error)".lowercased()
            if !(text.contains("already a member") || text.contains("already member") || text.contains("already joined")) {
                stage = .failed(VoteErrorText.describe(error))
                return
            }
        }
        await didJoin()
        guard !org.isEmpty else {
            stage = .joinedWorkspace("Workspace")
            return
        }
        // On 1.0 the org's members reach its org-wide app instances at once; the retries cover
        // a node that has not caught up yet.
        var contextId = invitation.contextId
        for attempt in 0..<attempts {
            if attempt > 0 { try? await Task.sleep(for: retryDelay) }
            guard let now = backend() else { break }
            if let known = contextId {
                if (try? await now.isMember(contextId: known)) == true { break }
                if (try? await now.joinContext(contextId: known)) != nil { break }
            } else if let first = (try? await now.listContexts(groupId: org))?.first {
                contextId = first
                break
            }
        }
        var workspace = invitation.invitation.name?.nilIfEmpty ?? "Workspace"
        if let listed = try? await backend()?.listNamespaces(),
            let name = listed.first(where: { $0.id == org })?.name?.nilIfEmpty
        {
            workspace = name
        }
        guard let contextId else {
            stage = .joinedWorkspace(workspace)
            return
        }
        stage = .joined(GroupRef(namespaceId: org, workspaceName: workspace, contextId: contextId))
    }

    public func reset() {
        invitation = nil
        stage = .idle
    }
}
