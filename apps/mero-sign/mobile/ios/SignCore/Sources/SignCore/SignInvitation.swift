import Foundation
import MeroKit

/// An invitation in the web app's format (`app/src/lib/inviteCodec.ts`,
/// `inviteLink.ts`), so a link minted on either side opens on the other:
///
/// - payload: `{"invitation": <SignedGroupOpenInvitation>, "contextId"?, "contextName"?, "workspaceName"?}`
/// - token: `base58(deflate(payload))`
/// - link: `https://links.calimero.network/com.calimero.mero-sign/join?invitation=<token>`
///
/// The signed invitation grants the WORKSPACE (namespace). `contextId` and
/// `contextName` sit beside the signature: a hint for which agreement to open
/// and what to call it while it syncs, never trusted over the workspace's own
/// listing or the contract's `context_name`.
public struct SignInvitation: Sendable {
    public let invitation: SignedGroupOpenInvitation
    public let contextId: String?
    public let contextName: String?
    public let workspaceName: String?

    public init(
        invitation: SignedGroupOpenInvitation, contextId: String? = nil, contextName: String? = nil,
        workspaceName: String? = nil
    ) {
        self.invitation = invitation
        self.contextId = contextId
        self.contextName = contextName
        self.workspaceName = workspaceName
    }

    /// The namespace it admits to: the hex of its SIGNED `group_id`, never a
    /// field beside it, so an edited wrapper cannot redirect a join.
    public var namespaceId: String {
        Hex.encode(invitation.invitation.groupId.map { UInt8(truncatingIfNeeded: $0) })
    }

    /// What to call it in a prompt.
    public var title: String {
        if let contextName = contextName?.signTrimmed { return contextName }
        if let workspaceName = workspaceName?.signTrimmed { return workspaceName }
        return "an agreement"
    }

    // MARK: Encoding

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let contextId: String?
        let contextName: String?
        let workspaceName: String?
    }

    public func token() throws -> String {
        try InviteCodec.encode(
            Payload(invitation: invitation, contextId: contextId, contextName: contextName, workspaceName: workspaceName))
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

    /// The decoded payload (the web's `parsePayload`): `data` envelopes are
    /// unwrapped, and both spellings of each field are read.
    public static func parse(json: String) -> SignInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        var inner = parsed
        for _ in 0..<6 {
            if isSignedInvitation(inner) { break }
            guard let next = inner["data"] else { break }
            inner = next
        }
        if let wrapped = inner["invitation"], let signed = unwrapSigned(wrapped) {
            return SignInvitation(
                invitation: signed,
                contextId: (inner["contextId"]?.stringValue ?? inner["context_id"]?.stringValue)?.signTrimmed,
                contextName: (inner["contextName"]?.stringValue ?? inner["context_name"]?.stringValue
                    ?? inner["groupAlias"]?.stringValue ?? inner["groupName"]?.stringValue)?.signTrimmed,
                workspaceName: (inner["workspaceName"]?.stringValue ?? inner["namespaceName"]?.stringValue)?.signTrimmed)
        }
        if isSignedInvitation(inner), let signed = decodeSigned(inner) {
            return SignInvitation(invitation: signed)
        }
        return nil
    }

    private static func unwrapSigned(_ value: JSONValue) -> SignedGroupOpenInvitation? {
        var current = value
        for _ in 0..<6 {
            if isSignedInvitation(current) { return decodeSigned(current) }
            guard let next = current["data"] ?? current["invitation"] else { return nil }
            current = next
        }
        return nil
    }

    private static func isSignedInvitation(_ value: JSONValue) -> Bool {
        guard case .object(let fields) = value, case .object? = fields["invitation"] else { return false }
        return fields["inviter_signature"]?.stringValue != nil || fields["inviterSignature"]?.stringValue != nil
    }

    private static func decodeSigned(_ value: JSONValue) -> SignedGroupOpenInvitation? {
        guard case .object(var fields) = value else { return nil }
        if fields["inviter_signature"] == nil, let camel = fields["inviterSignature"] {
            fields["inviter_signature"] = camel
            fields.removeValue(forKey: "inviterSignature")
        }
        guard let data = try? JSONEncoder().encode(JSONValue.object(fields)) else { return nil }
        return try? JSONDecoder().decode(SignedGroupOpenInvitation.self, from: data)
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

    /// Join. `directory` is read again after `didJoin`, which may hand the
    /// session the admitting relay (and so a new backend).
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
