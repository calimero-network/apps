// The contract, as Mero Sign's component ABI (`logic/res/abi.json`) declares it: methods,
// arguments and answer fields in camelCase, every u64 a decimal string in arguments (answers may
// carry either), accounts as account-id strings, blob ids as 64 lowercase hex digits, timestamps in
// milliseconds, and a refusal as `422 APP_ERROR {code, fields}` (`NotFound`, `Forbidden`, `Invalid`,
// `Conflict`). The calls are the generated [network.calimero.sign.generated.client.SignClient]
// (`scripts/mobile-codegen.sh` at the repo root); this file keeps the answer types, which read the
// JSON the client answers until the logic derives `AbiType`, and the method sets
// `ContractSurfaceTest` pins to the ABI.

package network.calimero.sign.generated

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer

/** What the app keeps of the contract beside the generated [network.calimero.sign.generated.client.SignClient]. */
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

    val JSON = Json { ignoreUnknownKeys = true }

    /** An answer of the generated client as the app type [T]. */
    inline fun <reified T> read(answer: JsonElement): T = JSON.decodeFromJsonElement(serializer<T>(), answer)

    /** [value] as the JSON the generated client takes. */
    inline fun <reified T> json(value: T): JsonElement = JSON.encodeToJsonElement(serializer<T>(), value)
}


/** A u64 field as the wire carries it: a decimal string (a number is read too). */
object U64 : KSerializer<ULong> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("U64", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: ULong) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): ULong {
        val text = (decoder as? JsonDecoder)?.decodeJsonElement()?.jsonPrimitive?.content ?: decoder.decodeString()
        return text.toULongOrNull() ?: throw SerializationException("not a u64: $text")
    }
}

/** An optional id: `null`, or [ContractBytes]. */
internal object NullableContractBytes : KSerializer<ContractBytes?> {
    override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor

    override fun serialize(encoder: Encoder, value: ContractBytes?) {
        (encoder as JsonEncoder).encodeJsonElement(value?.let { if (it is ContractBytes.Text) JsonPrimitive(it.value) else JsonNull } ?: JsonNull)
    }

    override fun deserialize(decoder: Decoder): ContractBytes? {
        val element = (decoder as JsonDecoder).decodeJsonElement()
        return if (element is JsonNull) null else decoder.json.decodeFromJsonElement(ContractBytesSerializer, element)
    }
}

// ---- answers -----------------------------------------------------------------------------------

/** Detailed information about a shared context */
@Serializable
data class ContextDetails(
    val contextId: ContractBytes,
    val contextName: String,
    val owner: ContractBytes,
    val isPrivate: Boolean,
    @Serializable(with = U64::class) val participantCount: ULong,
    val participants: List<ParticipantInfo>,
    @Serializable(with = U64::class) val documentCount: ULong,
    @Serializable(with = U64::class) val createdAt: ULong,
)

/** Metadata for tracking joined shared contexts */
@Serializable
data class ContextMetadata(
    val contextId: ContractBytes,
    val contextName: String,
    val role: ParticipantRole,
    @Serializable(with = U64::class) val joinedAt: ULong,
    val privateIdentity: ContractBytes,
    val sharedIdentity: ContractBytes,
)

/** Document chunk with its embedding */
@Serializable
data class DocumentChunk(
    val text: String,
    val embedding: List<Float>,
    val startPosition: UInt,
    val endPosition: UInt,
)

/**
 * Document information as read: the uploaded document, its current version
 * (the last signature's, or the upload's) and its status, derived every read
 * from the write-once entries.
 *
 * `embeddings`, `extracted_text` and `chunks` are always `None` in
 * `list_documents`, which returns every document; they stay in storage for
 * `search_document_by_embedding`.
 */
@Serializable
data class DocumentInfo(
    val id: String,
    val name: String,
    val hash: String,
    val uploadedBy: ContractBytes,
    @Serializable(with = U64::class) val uploadedAt: ULong,
    val status: DocumentStatus,
    val pdfBlobId: ContractBytes,
    @Serializable(with = U64::class) val size: ULong,
    val requiredSigners: List<ContractBytes>,
    val embeddings: List<Float>? = null,
    val extractedText: String? = null,
    val chunks: List<DocumentChunk>? = null,
)

/** A signature on a document, as read. `signer` is the entry's owner stamp. */
@Serializable
data class DocumentSignature(
    val signer: ContractBytes,
    @Serializable(with = U64::class) val signedAt: ULong,
)

/**
 * Document status, derived from the document's signatures.
 *
 * `FullySigned` IS TERMINAL. Completion is a fact about the past: the
 * signers a document waits for are fixed when it is uploaded, its signatures
 * are written once, and a completed document refuses further signatures. A
 * participant added later was not party to it; if they need to be, that is a
 * new document.
 */
@Serializable
enum class DocumentStatus {
    @SerialName("Pending")
    Pending,
    @SerialName("PartiallySigned")
    PartiallySigned,
    @SerialName("FullySigned")
    FullySigned,
}

/** Identity mapping for tracking user identities across contexts */
@Serializable
data class IdentityMapping(
    val privateIdentity: ContractBytes,
    val sharedIdentity: ContractBytes,
    val contextId: ContractBytes,
    @Serializable(with = U64::class) val createdAt: ULong,
)

/** Participant information with permission level */
@Serializable
data class ParticipantInfo(
    val userId: ContractBytes,
    val permissionLevel: PermissionLevel,
)

/** Participant roles in shared contexts */
@Serializable
enum class ParticipantRole {
    @SerialName("Owner")
    Owner,
    @SerialName("Signer")
    Signer,
    @SerialName("Viewer")
    Viewer,
    @SerialName("Unknown")
    Unknown,
}

/** Permission levels for participants */
@Serializable
enum class PermissionLevel {
    @SerialName("Read")
    Read,
    @SerialName("Sign")
    Sign,
    @SerialName("Admin")
    Admin,
}

/** Signature record - uses LWW based on created_at timestamp */
@Serializable
data class SignatureRecord(
    @Serializable(with = U64::class) val id: ULong,
    val name: String,
    val blobId: ContractBytes,
    @Serializable(with = U64::class) val size: ULong,
    @Serializable(with = U64::class) val createdAt: ULong,
)

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
