import Foundation
import MeroKit

/// A company or audience invitation: Calimero 1.0's org invite token in the
/// SDK's link shape (``OrgInvitation``), plus where to land:
///
/// - payload: JSON `{"invitation": "inv_…", "namespaceId": <org>, "contextId"?, "name"?: <company name>,
///   "kind": "namespace"|"audience", "audienceId"?, "audienceName"?}`
/// - token: `base58(deflate(payload))` (``InviteCodec``, byte-compatible with fflate + bs58)
/// - link: `https://links.calimero.network/com.calimero.mero-updates/join?invitation=<token>`
///
/// The grant is always the org (audiences are open teams, reachable by every
/// company member): redeeming the token (`POST /invites/{token}/redeem`) joins
/// the org it belongs to; `audienceId` / `contextId` only say where to land. A
/// pre-1.0 signed invitation is refused (a 1.0 cluster cannot redeem it).
public struct UpdatesInvitation: Sendable {
    /// The registry package, which is also the links' slug (`APP_SLUG`).
    public static let packageName = "com.calimero.mero-updates"

    public enum Kind: String, Sendable { case namespace, audience }

    /// The org invite token.
    public let invitation: OrgInvitation
    public let kind: Kind
    /// The org (company) it admits to.
    public let namespaceId: String
    public let companyName: String?
    public let audienceId: String?
    public let contextId: String?
    public let audienceName: String?

    public init(
        invitation: OrgInvitation, kind: Kind, namespaceId: String, companyName: String? = nil,
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

    /// The shareable link: the SDK's ``OrgInvitation`` JSON with this app's landing fields beside it.
    public func link() throws -> String {
        let base = OrgInvitation(
            namespaceId: namespaceId, token: invitation.token, contextId: Self.nonEmpty(contextId),
            name: Self.nonEmpty(companyName))
        guard case .object(var payload) = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(base))
        else { throw UpdatesError.notAnInvitation }
        payload["kind"] = .string(kind.rawValue)
        if let audienceId = Self.nonEmpty(audienceId) { payload["audienceId"] = .string(audienceId) }
        if let audienceName = Self.nonEmpty(audienceName) { payload["audienceName"] = .string(audienceName) }
        let token = try InviteCodec.encode(JSONValue.object(payload))
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

    /// Read the decoded payload (under an optional `data` envelope). The SDK's
    /// ``OrgInvitation`` decoding refuses a 0.x payload (a signed object as `invitation`).
    public static func parse(json: String) -> UpdatesInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let root = parsed["data"].flatMap { $0.objectValue != nil ? $0 : nil } ?? parsed
        guard case .object(let fields) = root,
            let data = try? JSONEncoder().encode(root),
            let base = try? JSONDecoder().decode(OrgInvitation.self, from: data)
        else { return nil }

        let audienceId = nonEmpty(fields["audienceId"]?.stringValue)
        let contextId = nonEmpty(base.contextId)
        let kind: Kind = fields["kind"]?.stringValue == "audience" || (audienceId != nil && contextId != nil)
            ? .audience : .namespace
        return UpdatesInvitation(
            invitation: base, kind: kind, namespaceId: base.namespaceId,
            companyName: nonEmpty(base.name ?? fields["groupAlias"]?.stringValue), audienceId: audienceId,
            contextId: contextId, audienceName: nonEmpty(fields["audienceName"]?.stringValue))
    }

    private static func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return s
    }
}
