import CryptoKit
import Foundation

/// Authenticator codes (RFC 6238), as the web's `app/src/lib/totp.ts`: a bare
/// base32 seed or an `otpauth://totp/…` URI, computed on the phone, never sent.
public struct TotpParams: Equatable, Sendable {
    public enum Algorithm: String, Sendable { case sha1 = "SHA-1", sha256 = "SHA-256", sha512 = "SHA-512" }

    public var secret: String
    public var digits: Int
    public var period: Int
    public var algorithm: Algorithm
    public var issuer: String?
    public var account: String?
}

public enum Totp {
    private static let b32 = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")

    public static func base32Decode(_ input: String) -> Data? {
        let clean = input.uppercased().filter { !$0.isWhitespace && $0 != "=" && $0 != "-" }
        var out = Data()
        var bits = 0
        var value = 0
        for ch in clean {
            guard let index = b32.firstIndex(of: ch) else { return nil }
            value = ((value << 5) | index) & 0xFFFF
            bits += 5
            if bits >= 8 {
                out.append(UInt8((value >> (bits - 8)) & 0xFF))
                bits -= 8
            }
        }
        return out
    }

    /// A seed or an otpauth URI; `nil` for anything that is neither.
    public static func parse(_ input: String) -> TotpParams? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if text.lowercased().hasPrefix("otpauth://") {
            guard let url = URLComponents(string: text), url.host?.lowercased() == "totp" else { return nil }
            let query = Dictionary(
                (url.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { first, _ in first })
            guard let secret = query["secret"], !secret.isEmpty, base32Decode(secret) != nil else { return nil }
            let alg = (query["algorithm"] ?? "SHA1").uppercased()
            let algorithm: TotpParams.Algorithm = alg == "SHA256" ? .sha256 : alg == "SHA512" ? .sha512 : .sha1
            let label = url.path.drop { $0 == "/" }
            let issuerFromLabel: String?
            let account: String
            if let colon = label.firstIndex(of: ":") {
                issuerFromLabel = String(label[..<colon])
                let rest = label[label.index(after: colon)...]
                account = String(rest.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
            } else {
                issuerFromLabel = nil
                account = String(label)
            }
            return TotpParams(
                secret: secret, digits: Int(query["digits"] ?? "") ?? 6, period: Int(query["period"] ?? "") ?? 30,
                algorithm: algorithm, issuer: query["issuer"] ?? issuerFromLabel,
                account: account.isEmpty ? nil : account)
        }
        guard let bytes = base32Decode(text), !bytes.isEmpty else { return nil }
        return TotpParams(secret: text, digits: 6, period: 30, algorithm: .sha1)
    }

    /// The code at `atMs`, zero-padded to `digits`.
    public static func code(_ params: TotpParams, atMs: Int64) -> String {
        let key = SymmetricKey(data: base32Decode(params.secret) ?? Data())
        var counter = UInt64(atMs / 1000 / Int64(params.period)).bigEndian
        let message = Data(bytes: &counter, count: 8)
        let mac: Data
        switch params.algorithm {
        case .sha1: mac = Data(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: key))
        case .sha256: mac = Data(HMAC<SHA256>.authenticationCode(for: message, using: key))
        case .sha512: mac = Data(HMAC<SHA512>.authenticationCode(for: message, using: key))
        }
        let bytes = [UInt8](mac)
        let offset = Int(bytes[bytes.count - 1] & 0x0F)
        let bin =
            (Int(bytes[offset] & 0x7F) << 24) | (Int(bytes[offset + 1]) << 16) | (Int(bytes[offset + 2]) << 8)
            | Int(bytes[offset + 3])
        var modulus = 1
        for _ in 0..<params.digits { modulus *= 10 }
        let value = String(bin % modulus)
        return String(repeating: "0", count: max(0, params.digits - value.count)) + value
    }

    /// Seconds left in the current period.
    public static func secondsRemaining(period: Int, atMs: Int64) -> Int {
        period - Int((atMs / 1000) % Int64(period))
    }
}
