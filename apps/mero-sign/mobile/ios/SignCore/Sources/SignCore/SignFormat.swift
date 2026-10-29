import Foundation

/// Words and numbers as the screens show them. Android `SignFormat.kt` matches.
public enum SignFormat {
    /// A contract timestamp (nanoseconds, `env::time_now`) as a date.
    public static func date(nanos: UInt64) -> Date {
        Date(timeIntervalSince1970: TimeInterval(nanos / 1_000_000) / 1000)
    }

    /// "Today, 14:05", "Yesterday", or "12 Mar 2026".
    public static func when(nanos: UInt64, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current)
        -> String
    {
        let date = date(nanos: nanos)
        if calendar.isDate(date, inSameDayAs: now) {
            let time = DateFormatter()
            time.locale = locale
            time.timeStyle = .short
            time.dateStyle = .none
            return "Today, \(time.string(from: date))"
        }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
            return "Yesterday"
        }
        let day = DateFormatter()
        day.locale = locale
        day.setLocalizedDateFormatFromTemplate("d MMM yyyy")
        return day.string(from: date)
    }

    /// The web's status words (`statusLabel`).
    public static func status(_ status: DocumentStatus) -> String {
        switch status {
        case .fullySigned: return "Signed"
        case .partiallySigned: return "In progress"
        case .pending: return "Awaiting signatures"
        }
    }

    /// "1.2 MB".
    public static func size(_ bytes: UInt64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(clamping: bytes))
    }

    /// "2 of 3 signed".
    public static func progress(_ entry: DocumentEntry) -> String {
        let p = entry.progress
        if p.required == 0 { return SignFormat.status(entry.document.status) }
        return "\(p.signed) of \(p.required) signed"
    }

    /// The level's word and what it lets you do (`LEVEL_DESCRIPTIONS`).
    public static func level(_ level: PermissionLevel) -> (String, String) {
        switch level {
        case .admin: return ("Admin", "Everything a signer can do, plus managing documents and people.")
        case .sign: return ("Signer", "Can sign the documents in this agreement.")
        case .read: return ("Viewer", "Can open the agreement and read its documents.")
        }
    }

    /// Up to two letters for an avatar: a name's initials, else the id's first two.
    public static func initials(_ name: String?, id: String) -> String {
        if let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            let words = name.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "_" }).prefix(2)
            let letters = words.compactMap(\.first).map { String($0).uppercased() }.joined()
            return letters.isEmpty ? String(name.prefix(1)).uppercased() : letters
        }
        return String(SignIds.hex(id).prefix(2)).uppercased()
    }

    /// A stable index into the avatar tones for an id.
    public static func tone(_ seed: String, tones: Int = 6) -> Int {
        var hash: UInt32 = 2_166_136_261
        for byte in seed.utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        return Int(hash % UInt32(max(tones, 1)))
    }

    /// A file name for sharing a document's current version.
    public static func fileName(_ name: String, signed: Bool) -> String {
        var base = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if base.isEmpty { base = "document" }
        base = base.replacingOccurrences(of: "/", with: "-")
        if !base.lowercased().hasSuffix(".pdf") { base += ".pdf" }
        return signed ? "signed-\(base)" : base
    }
}
