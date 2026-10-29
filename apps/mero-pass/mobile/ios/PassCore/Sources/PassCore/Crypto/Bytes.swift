import CryptoKit
import Foundation
import Security

/// Encodings and digests the web's `crypto.ts` uses, byte for byte: standard
/// base64 with padding (`btoa`), lower-case hex, base64url without padding.
public enum Bytes {
    public static func b64(_ data: Data) -> String { data.base64EncodedString() }

    public static func fromB64(_ text: String) throws -> Data {
        guard let data = Data(base64Encoded: text) else { throw PassCryptoError.malformed("base64") }
        return data
    }

    public static func b64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func fromB64url(_ text: String) throws -> Data {
        var std = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        std += String(repeating: "=", count: (4 - std.count % 4) % 4)
        return try fromB64(std)
    }

    public static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    public static func fromHex(_ text: String) throws -> Data {
        guard text.count % 2 == 0 else { throw PassCryptoError.malformed("hex") }
        var out = Data(capacity: text.count / 2)
        var index = text.startIndex
        while index < text.endIndex {
            let next = text.index(index, offsetBy: 2)
            guard let byte = UInt8(text[index..<next], radix: 16) else { throw PassCryptoError.malformed("hex") }
            out.append(byte)
            index = next
        }
        return out
    }

    public static func sha256(_ data: Data) -> Data { Data(SHA256.hash(data: data)) }

    /// Bytes from the system's CSPRNG.
    public static func random(_ count: Int) -> Data {
        var out = Data(count: count)
        let status = out.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
        return out
    }
}

public enum PassCryptoError: Error, Equatable, LocalizedError {
    case malformed(String)
    case wrongKey
    case unsupported(String)

    public var errorDescription: String? {
        switch self {
        case .malformed(let what): return "Malformed \(what)."
        case .wrongKey: return "That key does not open this."
        case .unsupported(let what): return what
        }
    }
}
