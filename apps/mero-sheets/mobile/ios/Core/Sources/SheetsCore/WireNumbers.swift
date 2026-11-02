import Foundation

// The component contract sends and takes every u64 as a decimal string
// (`calimero_app_sdk::json::u64_str`): JSON numbers lose precision above 2^53.
// These overloads make the generated client's synthesized `Codable` code in
// this module read and write `UInt64` that way. Reading also accepts a bare number.

extension KeyedDecodingContainer {
    func decode(_ type: UInt64.Type, forKey key: Key) throws -> UInt64 {
        if let text = try? decodeIfPresent(String.self, forKey: key) {
            guard let value = UInt64(text) else {
                throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "not a u64: \(text)")
            }
            return value
        }
        guard let value = try decodeIfPresent(UInt64.self, forKey: key) else {
            throw DecodingError.keyNotFound(key, .init(codingPath: codingPath, debugDescription: "missing u64"))
        }
        return value
    }
}

extension KeyedEncodingContainer {
    mutating func encode(_ value: UInt64, forKey key: Key) throws {
        try encode(String(value), forKey: key)
    }
}
