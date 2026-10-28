import Foundation

/// Password strength, the generator and the vault health check: the web's
/// `app/src/lib/health.ts`, computed on the phone over decrypted secrets.
public enum PasswordTools {
    public static let generatorMin = 12
    public static let generatorMax = 64
    public static let generatorDefault = 20

    private static let common: Set<String> = [
        "password", "123456", "12345678", "qwerty", "letmein", "admin", "welcome", "iloveyou", "monkey", "dragon",
        "hunter2", "password1", "abc123",
    ]

    /// 0–4 from length, character classes and a common-word check.
    public static func strength(_ pw: String) -> Int {
        if pw.isEmpty { return 0 }
        if common.contains(pw.lowercased()) { return 0 }
        let scalars = pw.unicodeScalars
        let classes = [
            scalars.contains { ("a"..."z").contains($0) },
            scalars.contains { ("A"..."Z").contains($0) },
            scalars.contains { ("0"..."9").contains($0) },
            scalars.contains { !(("a"..."z").contains($0) || ("A"..."Z").contains($0) || ("0"..."9").contains($0)) },
        ].filter { $0 }.count
        let chars = Array(pw.utf16)
        if chars.count > 1 && chars.allSatisfy({ $0 == chars[0] }) { return 0 }
        let length = chars.count
        var score = 0
        if length >= 8 { score += 1 }
        if length >= 12 { score += 1 }
        if length >= 16 { score += 1 }
        if classes >= 3 { score += 1 }
        if length < 8 { score = min(score, 1) }
        return min(score, 4)
    }

    public static let strengthLabels = ["Very weak", "Weak", "Fair", "Strong", "Very strong"]

    /// A strong random password from a URL- and shell-safe alphabet.
    public static func generate(length: Int = generatorDefault) -> String {
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+")
        let limit = 256 - (256 % alphabet.count)
        var out: [Character] = []
        while out.count < length {
            for byte in Bytes.random(length * 2) where Int(byte) < limit && out.count < length {
                out.append(alphabet[Int(byte) % alphabet.count])
            }
        }
        return String(out)
    }

    public enum Issue: String, CaseIterable, Sendable {
        case weak, reused, old

        public var label: String {
            switch self {
            case .weak: return "Weak"
            case .reused: return "Reused"
            case .old: return "Over a year old"
            }
        }
    }

    public struct HealthRow: Identifiable, Equatable, Sendable {
        public let id: String
        public let name: String
        public let issues: [Issue]
        public let strength: Int
    }

    /// Weak, reused and year-old passwords among live, readable logins.
    public static func analyse(_ secrets: [Secret], nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000))
        -> [HealthRow]
    {
        let live = secrets.filter { !$0.trashed && !$0.unreadable && !($0.fields["password"] ?? "").isEmpty }
        var count: [String: Int] = [:]
        for s in live { count[s.fields["password"]!, default: 0] += 1 }
        let yearMs: Int64 = 365 * 24 * 60 * 60 * 1000
        return live.map { s in
            let pw = s.fields["password"]!
            let score = strength(pw)
            var issues: [Issue] = []
            if score <= 1 { issues.append(.weak) }
            if (count[pw] ?? 0) > 1 { issues.append(.reused) }
            let updatedMs = s.updatedAt > 100_000_000_000_000 ? Int64(s.updatedAt / 1_000_000) : Int64(s.updatedAt)
            if updatedMs > 0 && nowMs - updatedMs > yearMs { issues.append(.old) }
            return HealthRow(id: s.id, name: s.name, issues: issues, strength: score)
        }
        .sorted { $0.issues.count != $1.issues.count ? $0.issues.count > $1.issues.count : $0.strength < $1.strength }
    }
}
