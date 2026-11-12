// The contract, as Mero Sign's component ABI (`logic/res/abi.json`) declares it: methods,
// arguments and answer fields in camelCase, every u64 a decimal string in arguments (answers may
// carry either), accounts as account-id strings, blob ids as 64 lowercase hex digits, timestamps in
// milliseconds, and a refusal as `422 APP_ERROR {code, fields}` (`NotFound`, `Forbidden`, `Invalid`,
// `Conflict`). The calls and the answer types are the generated [SignClient]
// (`scripts/mobile-codegen.sh` at the repo root); this file keeps the method sets
// `ContractSurfaceTest` pins to the ABI and the id helper [ContractBytes].

package network.calimero.sign.generated

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import network.calimero.sign.generated.client.SignClient

/** What the app keeps of the contract beside the generated [SignClient]. */
object SignContract {
    /** The contract's views, by ABI name. */
    val VIEWS: Set<String> =
        setOf(
            "getContextDetails",
            "getContextId",
            "getDocumentSignatures",
            "getIdentityMapping",
            "getSharedIdentity",
            "getUserPermission",
            "hasConsented",
            "isDefaultPrivateContext",
            "listDocuments",
            "listJoinedContexts",
            "listParticipants",
            "listSignatures",
            "resolvePrivateIdentity",
            "searchDocumentByEmbedding",
            "whoami",
        )

    /** The contract's calls, by ABI name. */
    val CALLS: Set<String> =
        setOf(
            "addParticipant",
            "createSignature",
            "deleteDocument",
            "deleteSignature",
            "joinSharedContext",
            "leaveSharedContext",
            "markParticipantSigned",
            "registerSelfAsParticipant",
            "removeParticipant",
            "setConsent",
            "setParticipantPermission",
            "setup",
            "signDocument",
            "uploadDocument",
        )
}

// The answer types are the generated client's ([SignClient], from the ABI): ids are the strings
// the contract writes (read them through [ContractBytes.Text] to compare or turn them into hex),
// u64s are [ULong].

typealias ContextDetails = SignClient.ContextDetails

typealias ContextMetadata = SignClient.ContextMetadata

typealias DocumentChunk = SignClient.DocumentChunk

typealias DocumentInfo = SignClient.DocumentInfo

typealias DocumentSignature = SignClient.DocumentSignature

typealias DocumentStatus = SignClient.DocumentStatus

typealias IdentityMapping = SignClient.IdentityMapping

typealias ParticipantInfo = SignClient.ParticipantInfo

typealias ParticipantRole = SignClient.ParticipantRole

typealias PermissionLevel = SignClient.PermissionLevel

typealias SignatureRecord = SignClient.SignatureRecord

/**
 * Fixed-size bytes. An id with its own spelling (`UserId`, `BlobId`) is [Text] —
 * base58 or hex, exactly as the contract writes it — and a plain `[u8; N]` is
 * [Raw], an array of numbers. Decoding takes whichever arrives; encoding writes
 * the form this value holds.
 */
@Serializable(with = ContractBytesSerializer::class)
sealed class ContractBytes {
    data class Text(val value: String) : ContractBytes()

    data class Raw(val value: List<UByte>) : ContractBytes()

    /** The text form, if that is what this holds. */
    val text: String? get() = (this as? Text)?.value

    /** The array form, if that is what this holds. */
    val raw: List<UByte>? get() = (this as? Raw)?.value
}

internal object ContractBytesSerializer : KSerializer<ContractBytes> {
    override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor

    override fun serialize(encoder: Encoder, value: ContractBytes) {
        val element = when (value) {
            is ContractBytes.Text -> JsonPrimitive(value.value)
            is ContractBytes.Raw -> JsonArray(value.value.map { JsonPrimitive(it.toInt()) })
        }
        (encoder as JsonEncoder).encodeJsonElement(element)
    }

    override fun deserialize(decoder: Decoder): ContractBytes {
        val element = (decoder as JsonDecoder).decodeJsonElement()
        return if (element is JsonPrimitive && element.isString) {
            ContractBytes.Text(element.content)
        } else {
            ContractBytes.Raw(element.jsonArray.map { it.jsonPrimitive.content.toInt().toUByte() })
        }
    }
}
