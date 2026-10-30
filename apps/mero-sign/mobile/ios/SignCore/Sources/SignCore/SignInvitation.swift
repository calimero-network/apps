import Foundation
import MeroKit

/// An invitation link: swift-sdk's ``OrgInvitation`` (the payload every
/// Calimero 1.0 app shares), plus the workspace's name to show:
///
/// - payload: `{"invitation": "inv_…", "namespaceId": "<workspace>", "contextId"?: "<agreement>", "name"?: "<agreement name>", "workspaceName"?: "…"}`
/// - token: `base58(deflate(payload))`
/// - link: `https://links.calimero.network/com.calimero.mero-sign/join?invitation=<token>`
///
/// The invite token admits to the WORKSPACE (a Calimero organization).
/// `contextId` (the agreement's app instance) and `name` are a hint for
/// which agreement to open and what to call it while it loads, never
/// trusted over the workspace's own listing or the contract's `context_name`.
public struct SignInvitation: Sendable {
    public let invitation: OrgInvitation
    public let workspaceName: String?

    public init(invitation: OrgInvitation, workspaceName: String? = nil) {
        self.invitation = invitation
        self.workspaceName = workspaceName
    }

    /// The invitation to `namespaceId` (``OrgInvitation/namespaceId``) with
    /// Mero Sign's hints set on it.
    public init(
        invitation: OrgInvitation, contextId: String?, contextName: String? = nil, workspaceName: String? = nil
    ) {
        self.init(
            invitation: OrgInvitation(
                namespaceId: invitation.namespaceId, token: invitation.token, contextId: contextId?.signTrimmed,
                name: contextName?.signTrimmed),
            workspaceName: workspaceName?.signTrimmed)
    }

    /// The workspace it admits to: the organization the node minted the token for.
    public var namespaceId: String { invitation.namespaceId }
    /// The agreement to open after joining, when the link names one.
    public var contextId: String? { invitation.contextId?.signTrimmed }
    /// The agreement's name, while it loads.
    public var contextName: String? { invitation.name?.signTrimmed }

    /// What to call it in a prompt.
    public var title: String {
        if let contextName { return contextName }
        if let workspaceName = workspaceName?.signTrimmed { return workspaceName }
        return "an agreement"
    }

    // MARK: Encoding

    /// ``OrgInvitation``'s JSON with `workspaceName` beside it.
    private struct Payload: Codable {
        let invitation: String
        let namespaceId: String
        let contextId: String?
        let name: String?
        let workspaceName: String?
    }

    public func token() throws -> String {
        try InviteCodec.encode(
            Payload(
                invitation: invitation.token, namespaceId: namespaceId, contextId: contextId, name: contextName,
                workspaceName: workspaceName?.signTrimmed))
    }

    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: SignConstants.packageName)
    }

    // MARK: Decoding

    /// A link (https or `calimero://`), a bare token, or raw JSON. Nil when it
    /// holds no Mero Sign invitation, and for another app's link.
    public static func parse(_ input: String) -> SignInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("{") { return parse(json: trimmed) }
        guard let token = InviteLink.token(fromPasted: trimmed, expectedSlug: SignConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The decoded payload. Only an ``OrgInvitation`` (an `inv_…` token and
    /// its organization) is an invitation; a pre-1.0 signed group invitation is not.
    public static func parse(json: String) -> SignInvitation? {
        let data = Data(json.utf8)
        guard let invitation = try? JSONDecoder().decode(OrgInvitation.self, from: data) else { return nil }
        let extra = try? JSONDecoder().decode(JSONValue.self, from: data)
        return SignInvitation(invitation: invitation, workspaceName: extra?["workspaceName"]?.stringValue?.signTrimmed)
    }
}

extension String {
    var signTrimmed: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// Where a redeemed invitation lands: the workspace, and the agreement in it
/// when the invitation resolved to one.
public struct InvitationDestination: Equatable, Sendable {
    public let namespaceId: String
    public let workspaceName: String
    public let agreement: AgreementRef?
}

/// Redeeming an invitation link, as the web's `joinWorkspaceFromInvitation`:
/// join the workspace, find the agreement (the one the link names, else the
/// only one), enter it, and settle in — register as a signer and record it,
/// with the identity it was joined with, in the private context.
@MainActor
public final class InvitationModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case confirm(title: String)
        case joining(title: String, step: String)
        case joined(InvitationDestination)
        case failed(String)
    }

    @Published public private(set) var stage: Stage = .idle
    public private(set) var invitation: SignInvitation?

    /// How many times, and how far apart, to look for the agreement in a
    /// just-joined workspace while it replicates.
    private let findAttempts: Int
    private let findDelay: Duration

    public init(findAttempts: Int = 15, findDelay: Duration = .seconds(2)) {
        self.findAttempts = findAttempts
        self.findDelay = findDelay
    }

    @discardableResult
    public func open(_ raw: String) -> Bool {
        guard let parsed = SignInvitation.parse(raw) else {
            invitation = nil
            stage = .failed("This isn't a Mero Sign invitation. Check the link and try again.")
            return false
        }
        invitation = parsed
        stage = .confirm(title: parsed.title)
        return true
    }

    /// Join: redeem the invite token on the node. `directory` is read again
    /// after `didJoin`, which re-reads what the account sees.
    public func accept(
        directory: @escaping @MainActor () -> AgreementDirectory?,
        didJoin: @escaping @MainActor () async -> Void
    ) async {
        guard let invitation, let current = directory() else {
            stage = .failed("Sign in to join.")
            return
        }
        let title = invitation.title
        stage = .joining(title: title, step: "Joining the workspace…")
        let namespaceId = invitation.namespaceId
        do {
            _ = try await current.backend.joinNamespace(namespaceId: namespaceId, invitation: invitation.invitation)
        } catch {
            let text = SignErrorText.message(error).lowercased()
            if !(text.contains("already a member") || text.contains("already member") || text.contains("already joined")) {
                stage = .failed(SignErrorText.describe(error))
                return
            }
        }
        await didJoin()
        guard let joined = directory() else {
            stage = .failed("Sign in to join.")
            return
        }
        stage = .joining(title: title, step: "Looking for the agreement…")
        var workspaceName = invitation.workspaceName ?? "Workspace"
        if invitation.workspaceName == nil,
            let listed = try? await joined.backend.listNamespaces().first(where: { $0.id == namespaceId })
        {
            workspaceName = AgreementDirectory.name(of: listed)
        }
        let target = await findAgreement(joined, namespaceId: namespaceId, workspaceName: workspaceName)
        guard let target else {
            stage = .joined(InvitationDestination(namespaceId: namespaceId, workspaceName: workspaceName, agreement: nil))
            return
        }
        do {
            stage = .joining(title: title, step: "Opening the agreement…")
            try await joined.enter(target.contextId)
            stage = .joining(title: title, step: "Registering you as a signer…")
            let name = await joined.settle(contextId: target.contextId, nameHint: invitation.contextName ?? target.name)
            let settled = AgreementRef(
                namespaceId: target.namespaceId, workspaceName: target.workspaceName,
                agreementId: target.agreementId, name: name, contextId: target.contextId)
            stage = .joined(InvitationDestination(namespaceId: namespaceId, workspaceName: workspaceName, agreement: settled))
        } catch {
            stage = .joined(InvitationDestination(namespaceId: namespaceId, workspaceName: workspaceName, agreement: nil))
        }
    }

    /// The agreement to open (`pickInvitedAgreement`): the one the link names
    /// when it is in the workspace, else the only one. Waits while the
    /// workspace replicates.
    private func findAgreement(_ directory: AgreementDirectory, namespaceId: String, workspaceName: String) async
        -> AgreementRef?
    {
        let workspace = AppNamespace(id: namespaceId, name: workspaceName, applicationId: "")
        let hint = invitation?.contextId
        var listed: [AgreementRef] = []
        for attempt in 0..<max(findAttempts, 1) {
            if attempt > 0 { try? await Task.sleep(for: findDelay) }
            listed = (try? await directory.agreements(in: workspace)) ?? []
            if let hint {
                if let hinted = listed.first(where: { $0.contextId == hint }) { return hinted }
            } else if !listed.isEmpty {
                break
            }
        }
        return listed.count == 1 ? listed[0] : nil
    }

    public func reset() {
        invitation = nil
        stage = .idle
    }
}
