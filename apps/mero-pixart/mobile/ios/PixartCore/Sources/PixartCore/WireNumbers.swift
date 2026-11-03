import Foundation

// The component contract takes a method's top-level u64 / i64 arguments
// (`updatedAt`, `timestamp`, `x`, `y`) as decimal strings: JSON numbers lose
// precision above 2^53. Integers inside records (`Layer`, `Member`, cursors)
// stay JSON numbers, so only the generated argument structs use these wrappers.

/// An integer argument that goes out as a decimal string.
@propertyWrapper
struct WireDecimal<Value: FixedWidthInteger & Sendable>: Encodable, Sendable {
    var wrappedValue: Value

    init(wrappedValue: Value) {
        self.wrappedValue = wrappedValue
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(String(wrappedValue))
    }
}

/// An optional integer argument: a decimal string when set, left out when `nil`.
@propertyWrapper
struct WireDecimalOptional<Value: FixedWidthInteger & Sendable>: Encodable, Sendable {
    var wrappedValue: Value?

    init(wrappedValue: Value?) {
        self.wrappedValue = wrappedValue
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let wrappedValue { try container.encode(String(wrappedValue)) } else { try container.encodeNil() }
    }
}

extension KeyedEncodingContainer {
    /// Leave an unset optional argument out, as the generated client did before.
    mutating func encode<Value>(_ value: WireDecimalOptional<Value>, forKey key: Key) throws {
        guard let wrapped = value.wrappedValue else { return }
        try encode(String(wrapped), forKey: key)
    }
}
