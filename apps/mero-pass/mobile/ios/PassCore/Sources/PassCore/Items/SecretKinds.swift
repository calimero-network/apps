import Foundation

/// One field a kind of secret carries (the web's `secretKinds.ts` `FIELDS`).
public struct FieldSpec: Hashable, Sendable {
    public let key: String
    public let label: String
    /// A long value: a multi-line editor.
    public let multiline: Bool
    /// Concealed while typing, and in the item until revealed.
    public let secret: Bool
    /// Offer the password generator.
    public let generate: Bool
    /// Validate as an authenticator seed or otpauth URI.
    public let totp: Bool

    init(
        _ key: String, _ label: String, multiline: Bool = false, secret: Bool = false, generate: Bool = false,
        totp: Bool = false
    ) {
        self.key = key
        self.label = label
        self.multiline = multiline
        self.secret = secret
        self.generate = generate
        self.totp = totp
    }
}

/// The kinds a secret can be, in the web's order, with their fields and labels.
public enum SecretKind: String, CaseIterable, Identifiable, Sendable {
    case login
    case secureNote = "secure_note"
    case totp
    case sshKey = "ssh_key"
    case paymentCard = "payment_card"
    case identity
    case apiKey = "api_key"
    case oauth2

    public var id: String { rawValue }

    /// The name in a picker ("Login", "Secure note", …).
    public var label: String {
        switch self {
        case .login: return "Login"
        case .secureNote: return "Secure note"
        case .totp: return "Authenticator (TOTP)"
        case .sshKey: return "SSH key"
        case .paymentCard: return "Payment card"
        case .identity: return "Identity"
        case .apiKey: return "API key"
        case .oauth2: return "OAuth connection"
        }
    }

    /// The category heading ("Logins", "Secure notes", …).
    public var plural: String {
        switch self {
        case .login: return "Logins"
        case .secureNote: return "Secure notes"
        case .totp: return "Authenticators"
        case .sshKey: return "SSH keys"
        case .paymentCard: return "Payment cards"
        case .identity: return "Identities"
        case .apiKey: return "API keys"
        case .oauth2: return "OAuth connections"
        }
    }

    /// The order categories are listed in (the web's `CATEGORIES`).
    public static let categoryOrder: [SecretKind] = [
        .login, .secureNote, .paymentCard, .identity, .totp, .sshKey, .apiKey, .oauth2,
    ]

    public var fields: [FieldSpec] {
        switch self {
        case .login:
            return [
                FieldSpec("username", "Username"),
                FieldSpec("password", "Password", secret: true, generate: true),
                FieldSpec("url", "Website"),
                FieldSpec("totp", "Authenticator seed or otpauth:// URI", secret: true, totp: true),
                FieldSpec("notes", "Notes", multiline: true),
            ]
        case .secureNote:
            return [FieldSpec("notes", "Note", multiline: true, secret: true)]
        case .totp:
            return [
                FieldSpec("secret", "Seed or otpauth:// URI", secret: true, totp: true),
                FieldSpec("issuer", "Issuer"),
                FieldSpec("account", "Account"),
            ]
        case .sshKey:
            return [
                FieldSpec("private_key", "Private key", multiline: true, secret: true),
                FieldSpec("public_key", "Public key", multiline: true),
                FieldSpec("passphrase", "Passphrase", secret: true, generate: true),
            ]
        case .paymentCard:
            return [
                FieldSpec("cardholder_name", "Cardholder"),
                FieldSpec("card_number", "Card number", secret: true),
                FieldSpec("expiry_date", "Expires"),
                FieldSpec("cvv", "CVV", secret: true),
                FieldSpec("pin", "PIN", secret: true),
                FieldSpec("notes", "Notes", multiline: true),
            ]
        case .identity:
            return [
                FieldSpec("full_name", "Full name"),
                FieldSpec("email", "Email"),
                FieldSpec("phone", "Phone"),
                FieldSpec("document_number", "Passport / ID number", secret: true),
                FieldSpec("address", "Address", multiline: true),
                FieldSpec("notes", "Notes", multiline: true),
            ]
        case .apiKey:
            return [
                FieldSpec("service", "Service"),
                FieldSpec("base_url", "API base URL"),
                FieldSpec("api_key", "API key", secret: true),
                FieldSpec("api_secret", "API secret", secret: true),
                FieldSpec("access_token", "Access token", secret: true),
                FieldSpec("access_token_secret", "Access token secret", secret: true),
                FieldSpec("notes", "Notes", multiline: true),
            ]
        case .oauth2:
            return [
                FieldSpec("provider", "Provider"),
                FieldSpec("account", "Account"),
                FieldSpec("client_id", "Client ID"),
                FieldSpec("client_secret", "Client secret", secret: true),
                FieldSpec("access_token", "Access token", secret: true),
                FieldSpec("refresh_token", "Refresh token", secret: true),
                FieldSpec("expires_at", "Access token expires"),
                FieldSpec("scopes", "Scopes"),
                FieldSpec("notes", "Notes", multiline: true),
            ]
        }
    }

    public static func label(of kind: String) -> String {
        SecretKind(rawValue: kind)?.label ?? kind.replacingOccurrences(of: "_", with: " ")
    }

    /// Whether `field` of a `kind` secret is concealed until revealed.
    public static func isSensitive(kind: String, field: String) -> Bool {
        if let spec = SecretKind(rawValue: kind)?.fields.first(where: { $0.key == field }) { return spec.secret }
        let lower = field.lowercased()
        return ["pass", "secret", "key", "cvv", "pin", "token", "seed", "private"].contains { lower.contains($0) }
    }

    public static func isTotpField(kind: String, field: String) -> Bool {
        SecretKind(rawValue: kind)?.fields.first(where: { $0.key == field })?.totp ?? false
    }

    public static func isMultiline(kind: String, field: String) -> Bool {
        SecretKind(rawValue: kind)?.fields.first(where: { $0.key == field })?.multiline ?? false
    }
}

/// How a decrypted secret presents in a list (the web's `itemView.ts`).
public enum ItemView {
    /// The host of a stored website, without scheme or `www.`; "" when none.
    public static func host(of url: String?) -> String {
        let raw = (url ?? "").trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return "" }
        let hasScheme = raw.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*://", options: .regularExpression) != nil
        guard let host = URLComponents(string: hasScheme ? raw : "https://\(raw)")?.host, !host.isEmpty else {
            return ""
        }
        let lower = host.lowercased()
        return lower.hasPrefix("www.") ? String(lower.dropFirst(4)) : lower
    }

    /// A stored website as a link to open, or `nil`.
    public static func openableURL(_ url: String?) -> URL? {
        let raw = (url ?? "").trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return nil }
        if raw.lowercased().hasPrefix("http://") || raw.lowercased().hasPrefix("https://") { return URL(string: raw) }
        return host(of: raw).isEmpty ? nil : URL(string: "https://\(raw)")
    }

    /// The line under an item's name. Never a secret value, except a card's last four.
    public static func subtitle(_ s: Secret) -> String {
        let f = s.fields
        func v(_ key: String) -> String { f[key] ?? "" }
        func firstNonEmpty(_ values: String...) -> String? { values.first { !$0.isEmpty } }
        switch SecretKind(rawValue: s.kind) {
        case .login:
            return firstNonEmpty(v("username"), host(of: v("url"))) ?? "Login"
        case .paymentCard:
            let digits = v("card_number").filter(\.isNumber)
            return digits.count >= 4 ? "•••• \(digits.suffix(4))" : (firstNonEmpty(v("cardholder_name")) ?? "Payment card")
        case .identity:
            return firstNonEmpty(v("full_name"), v("email")) ?? "Identity"
        case .totp:
            let joined = [v("issuer"), v("account")].filter { !$0.isEmpty }.joined(separator: " · ")
            return joined.isEmpty ? "Authenticator" : joined
        case .sshKey:
            return "SSH key"
        case .apiKey:
            return firstNonEmpty(v("service"), host(of: v("base_url"))) ?? "API key"
        case .oauth2:
            let joined = [v("provider"), v("account")].filter { !$0.isEmpty }.joined(separator: " · ")
            return joined.isEmpty ? "OAuth" : joined
        default:
            return SecretKind.label(of: s.kind)
        }
    }

    /// The letter on a tile.
    public static func monogram(_ name: String) -> String {
        guard let ch = name.trimmingCharacters(in: .whitespaces).first(where: { $0.isLetter || $0.isNumber }) else {
            return "•"
        }
        return String(ch).uppercased()
    }

    /// A stable hue (0–359) from a name, the same as the web's `hueOf`.
    public static func hue(_ name: String) -> Int {
        var h = 0
        for scalar in name.trimmingCharacters(in: .whitespaces).lowercased().unicodeScalars {
            h = (h * 31 + Int(scalar.value)) % 360
        }
        return h
    }

    /// Search over names, tags, usernames and sites. Never over secret values.
    public static func matches(_ s: Secret, query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return true }
        let f = s.fields
        let haystack = [s.name] + s.tags + ["username", "url", "email", "issuer", "account", "full_name"].compactMap { f[$0] }
        return haystack.contains { $0.lowercased().contains(q) }
    }

    /// Alphabetical, ignoring case and accents.
    public static func byName(_ a: Secret, _ b: Secret) -> Bool {
        a.name.compare(b.name, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedAscending
    }

    /// Calimero stamps in nanoseconds; anything that large is not milliseconds.
    public static func date(_ stamp: UInt64) -> Date {
        let ms = stamp > 1_000_000_000_000 ? Double(stamp / 1_000_000) : Double(stamp)
        return Date(timeIntervalSince1970: ms / 1000)
    }

    /// "you", or a short account id.
    public static func who(_ account: String, me: String?) -> String {
        if !account.isEmpty && account == me { return "you" }
        return shortAccount(account)
    }

    public static func shortAccount(_ account: String) -> String {
        let s = account.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { return "unknown" }
        return s.count <= 11 ? s : "\(s.prefix(6))…\(s.suffix(4))"
    }

    /// The fields to show, in the kind's order, then any others; empty ones left out.
    public static func orderedFields(_ s: Secret) -> [(key: String, label: String, value: String)] {
        let spec = SecretKind(rawValue: s.kind)?.fields ?? []
        let known = spec.compactMap { f -> (String, String, String)? in
            guard let v = s.fields[f.key], !v.isEmpty else { return nil }
            return (f.key, f.label, v)
        }
        let extra = s.fields.keys.sorted()
            .filter { k in !(s.fields[k] ?? "").isEmpty && !spec.contains { $0.key == k } }
            .map { ($0, $0.replacingOccurrences(of: "_", with: " "), s.fields[$0]!) }
        return (known + extra).map { (key: $0.0, label: $0.1, value: $0.2) }
    }
}
