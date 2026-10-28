import Foundation
import MeroKit

/// A company or audience invitation in the web app's format
/// (`app/src/lib/inviteCodec.ts` + `inviteLink.ts`), so a link minted on a
/// phone opens in the browser and the other way round:
///
/// - payload: JSON `{"invitation": <SignedGroupOpenInvitation>, "kind": "namespace"|"audience",
///   "groupId": <namespace>, "groupAlias": <company name>, "audienceId"?, "contextId"?, "audienceName"?}`
/// - token: `base58(deflate(payload))` (``InviteCodec``, byte-compatible with fflate + bs58)
/// - link: `https://links.calimero.network/com.calimero.mero-updates/join?invitation=<token>`
///
/// The grant is always the namespace (audiences are open subgroups, reachable
/// by every company member); `audienceId` / `contextId` only say where to land.
public struct UpdatesInvitation: Sendable {
    /// The registry package, which is also the links' slug (`APP_SLUG`).
    public static let packageName = "com.calimero.mero-updates"

    public enum Kind: String, Sendable { case namespace, audience }

    /// The signed envelope, carried through untouched.
    public let invitation: SignedGroupOpenInvitation
    public let kind: Kind
    /// The namespace (company) it admits to, read from inside the signed invitation.
    public let namespaceId: String
    public let companyName: String?
    public let audienceId: String?
    public let contextId: String?
    public let audienceName: String?

    public init(
        invitation: SignedGroupOpenInvitation, kind: Kind, namespaceId: String, companyName: String? = nil,
        audienceId: String? = nil, contextId: String? = nil, audienceName: String? = nil
    ) {
        self.invitation = invitation
        self.kind = kind
        self.namespaceId = namespaceId
        self.companyName = companyName
        self.audienceId = audienceId
        self.contextId = contextId
        self.audienceName = audienceName
    }

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let kind: String
        let groupId: String
        let groupAlias: String?
        let audienceId: String?
        let contextId: String?
        let audienceName: String?
    }

    /// The shareable link.
    public func link() throws -> String {
        let token = try InviteCodec.encode(
            Payload(
                invitation: invitation, kind: kind.rawValue, groupId: namespaceId, groupAlias: companyName,
                audienceId: audienceId, contextId: contextId, audienceName: audienceName))
        return InviteLink.invitation(token: token, slug: Self.packageName)
    }

    /// Where the link lands, for the invite sheet.
    public var scope: String {
        switch kind {
        case .namespace: return "Whole company\(companyName.map { " · \($0)" } ?? "")"
        case .audience: return "Opens \(audienceName ?? "an audience")"
        }
    }

    /// Read a link (https or `calimero://`, current or the older `?invite=`) or
    /// a bare token. Nil when it is not a Mero Updates invitation, including
    /// another app's link.
    public static func parse(_ input: String) -> UpdatesInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        var candidate = trimmed
        // The web app's links before the platform format: `…?invite=<code>`.
        if let legacy = URLComponents(string: trimmed)?.queryItems?.first(where: { $0.name == "invite" })?.value {
            candidate = legacy
        }
        guard let token = InviteLink.token(fromPasted: candidate, expectedSlug: packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// Read the decoded payload. Like the web's `parsePayload`, it checks the
    /// envelope is signed and leaves its fields to the node.
    public static func parse(json: String) -> UpdatesInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let root = parsed["data"].flatMap { $0.objectValue != nil ? $0 : nil } ?? parsed
        guard case .object(var fields) = root else { return nil }

        let signedValue: JSONValue
        if let inner = fields["invitation"], isSigned(inner) {
            signedValue = inner
        } else if isSigned(root) {
            signedValue = root  // a bare SignedGroupOpenInvitation
            fields = [:]
        } else {
            return nil
        }
        guard let signed = decodeSigned(signedValue) else { return nil }

        let chainNamespace = fields["chain"]?.arrayValue?.first(where: { $0["kind"]?.stringValue == "namespace" })
        let fromChain = chainNamespace?["invitation"].flatMap(decodeSigned).map { hex($0.invitation.groupId) }
        let signedGroup = hex(signed.invitation.groupId)
        let namespaceId =
            [fromChain, signedGroup, fields["groupId"]?.stringValue].compactMap { $0 }.first { !$0.isEmpty } ?? ""
        guard !namespaceId.isEmpty else { return nil }

        let audienceId = nonEmpty(fields["audienceId"]?.stringValue)
        let contextId = nonEmpty(fields["contextId"]?.stringValue)
        let kind: Kind = fields["kind"]?.stringValue == "audience" || (audienceId != nil && contextId != nil)
            ? .audience : .namespace
        return UpdatesInvitation(
            invitation: signed, kind: kind, namespaceId: namespaceId,
            companyName: nonEmpty(fields["groupAlias"]?.stringValue ?? fields["groupName"]?.stringValue),
            audienceId: audienceId, contextId: contextId,
            audienceName: nonEmpty(fields["audienceName"]?.stringValue))
    }

    private static func isSigned(_ value: JSONValue) -> Bool {
        guard case .object(let o) = value, o["invitation"]?.objectValue != nil else { return false }
        return o["inviter_signature"]?.stringValue != nil || o["inviterSignature"]?.stringValue != nil
    }

    /// Decode the envelope, accepting the camelCase spelling some nodes write.
    private static func decodeSigned(_ value: JSONValue) -> SignedGroupOpenInvitation? {
        guard case .object(var o) = value else { return nil }
        if o["inviter_signature"] == nil, let camel = o["inviterSignature"] {
            o["inviter_signature"] = camel
            o["inviterSignature"] = nil
        }
        guard let data = try? JSONEncoder().encode(JSONValue.object(o)) else { return nil }
        return try? JSONDecoder().decode(SignedGroupOpenInvitation.self, from: data)
    }

    static func hex(_ bytes: [Int]) -> String {
        bytes.map { String(format: "%02x", $0 & 0xFF) }.joined()
    }

    private static func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return s
    }
}
