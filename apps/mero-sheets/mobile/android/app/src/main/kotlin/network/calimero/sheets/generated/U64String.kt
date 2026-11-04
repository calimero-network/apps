package network.calimero.sheets.generated

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.jsonPrimitive

/**
 * A u64 on the component wire: the contract sends and takes it as a decimal string
 * (`calimero_sdk::json::u64_str`), since JSON numbers lose precision above 2^53. Reads a bare
 * number too.
 */
object U64String : KSerializer<ULong> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("U64String", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: ULong,
    ) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): ULong {
        val text =
            if (decoder is JsonDecoder) {
                decoder.decodeJsonElement().jsonPrimitive.content
            } else {
                decoder.decodeString()
            }
        return text.toULongOrNull() ?: throw kotlinx.serialization.SerializationException("not a u64: $text")
    }
}

