package network.calimero.pixart.generated

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.jsonPrimitive

// The component contract takes a method's top-level u64 / i64 arguments (`updatedAt`,
// `timestamp`, `x`, `y`) as decimal strings: JSON numbers lose precision above 2^53. Integers
// inside records (`Layer`, `Member`, cursors) stay JSON numbers, so only the generated argument
// classes use these serializers.

private fun Decoder.decimalText(): String = if (this is JsonDecoder) decodeJsonElement().jsonPrimitive.content else decodeString()

/** A u64 argument as a decimal string (reads a bare number too). */
object U64String : KSerializer<ULong> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("U64String", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: ULong,
    ) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): ULong = decoder.decimalText().let { it.toULongOrNull() ?: throw SerializationException("not a u64: $it") }
}

/** An i64 argument as a decimal string (reads a bare number too). */
object I64String : KSerializer<Long> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("I64String", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: Long,
    ) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): Long = decoder.decimalText().let { it.toLongOrNull() ?: throw SerializationException("not an i64: $it") }
}
