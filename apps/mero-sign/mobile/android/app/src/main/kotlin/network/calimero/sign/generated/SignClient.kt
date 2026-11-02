// The contract, as Mero Sign's component ABI (`logic/res/abi.json`) declares it: methods,
// arguments and answer fields in camelCase, every u64 a decimal string in arguments (answers may
// carry either), accounts as account-id strings, blob ids as 64 lowercase hex digits, timestamps in
// milliseconds, and a refusal as `422 APP_ERROR {code, fields}` (`NotFound`, `Forbidden`, `Invalid`,
// `Conflict`). Written from the ABI (no codegen targets a component ABI yet); `ContractSurfaceTest`
// pins the method list and parameter names to it.

package network.calimero.sign.generated

import com.calimero.mero.app.ContextContractCalling
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive

/** Typed calls to the contract. Views go through `query`, calls through `execute`. */
class SignClient(private val transport: ContextContractCalling) {
    /**
     * Add participant to shared context (admin only)
     *
     * `addParticipant`: a call, sent with `execute`.
     */
    suspend fun addParticipant(userIdStr: String, permission: PermissionLevel) {
        call("addParticipant", JsonObject(mapOf("userIdStr" to opt(userIdStr), "permission" to JsonPrimitive(permission.name))), JsonElement.serializer())
    }

    /**
     * Create a new signature and store its blob ID
     *
     * `createSignature`: a call, sent with `execute`.
     */
    suspend fun createSignature(name: String, blobIdStr: String, dataSize: ULong): ULong = call("createSignature", JsonObject(mapOf("name" to opt(name), "blobIdStr" to opt(blobIdStr), "dataSize" to u64(dataSize))), U64)

    /**
     * Delete a document by ID. Admins only: they are the documents'
     * moderators, and every node refuses anyone else's removal.
     *
     * Every account's document at the id, each by name (`remove_by`): keys
     * are per owner, and a key-only `remove` removes only the caller's own.
     *
     * `deleteDocument`: a call, sent with `execute`.
     */
    suspend fun deleteDocument(documentId: String) {
        call("deleteDocument", JsonObject(mapOf("documentId" to opt(documentId))), JsonElement.serializer())
    }

    /**
     * Delete a signature by ID
     *
     * `deleteSignature`: a call, sent with `execute`.
     */
    suspend fun deleteSignature(signatureId: ULong) {
        call("deleteSignature", JsonObject(mapOf("signatureId" to u64(signatureId))), JsonElement.serializer())
    }

    /**
     * Get detailed information about the shared context
     *
     * `getContextDetails`: a view, sent with `query`.
     */
    suspend fun getContextDetails(contextIdStr: String): ContextDetails = view("getContextDetails", JsonObject(mapOf("contextIdStr" to opt(contextIdStr))), ContextDetails.serializer())

    /**
     * Get current context ID
     *
     * `getContextId`: a view, sent with `query`.
     */
    suspend fun getContextId(): ContractBytes = view("getContextId", JsonObject(emptyMap()), ContractBytesSerializer)

    /**
     * The signatures on a document, in the order they were applied.
     *
     * `getDocumentSignatures`: a view, sent with `query`.
     */
    suspend fun getDocumentSignatures(documentId: String): List<DocumentSignature> = view("getDocumentSignatures", JsonObject(mapOf("documentId" to opt(documentId))), ListSerializer(DocumentSignature.serializer()))

    /**
     * Get identity mapping for a specific context
     *
     * `getIdentityMapping`: a view, sent with `query`.
     */
    suspend fun getIdentityMapping(contextIdStr: String): IdentityMapping = view("getIdentityMapping", JsonObject(mapOf("contextIdStr" to opt(contextIdStr))), IdentityMapping.serializer())

    /**
     * Get shared identity for a specific context
     *
     * `getSharedIdentity`: a view, sent with `query`.
     */
    suspend fun getSharedIdentity(contextIdStr: String): ContractBytes = view("getSharedIdentity", JsonObject(mapOf("contextIdStr" to opt(contextIdStr))), ContractBytesSerializer)

    /**
     * Get user permission level
     *
     * `getUserPermission`: a view, sent with `query`.
     */
    suspend fun getUserPermission(userIdStr: String): PermissionLevel = view("getUserPermission", JsonObject(mapOf("userIdStr" to opt(userIdStr))), PermissionLevel.serializer())

    /**
     * Check if user has given consent for a document (public API)
     *
     * `hasConsented`: a view, sent with `query`.
     */
    suspend fun hasConsented(userIdStr: String, documentId: String): Boolean = view("hasConsented", JsonObject(mapOf("userIdStr" to opt(userIdStr), "documentId" to opt(documentId))), Boolean.serializer())

    /**
     * `isDefaultPrivateContext`: a view, sent with `query`.
     */
    suspend fun isDefaultPrivateContext(): Boolean = view("isDefaultPrivateContext", JsonObject(emptyMap()), Boolean.serializer())

    /**
     * Join a shared context with identity mapping
     *
     * `joinSharedContext`: a call, sent with `execute`.
     */
    suspend fun joinSharedContext(contextIdStr: String, sharedIdentityStr: String, contextName: String) {
        call("joinSharedContext", JsonObject(mapOf("contextIdStr" to opt(contextIdStr), "sharedIdentityStr" to opt(sharedIdentityStr), "contextName" to opt(contextName))), JsonElement.serializer())
    }

    /**
     * Leave a shared context
     *
     * `leaveSharedContext`: a call, sent with `execute`.
     */
    suspend fun leaveSharedContext(contextIdStr: String) {
        call("leaveSharedContext", JsonObject(mapOf("contextIdStr" to opt(contextIdStr))), JsonElement.serializer())
    }

    /**
     * List all documents, without their search content (see [`DocumentInfo`]).
     *
     * `listDocuments`: a view, sent with `query`.
     */
    suspend fun listDocuments(): List<DocumentInfo> = view("listDocuments", JsonObject(emptyMap()), ListSerializer(DocumentInfo.serializer()))

    /**
     * List all joined contexts
     *
     * `listJoinedContexts`: a view, sent with `query`.
     */
    suspend fun listJoinedContexts(): List<ContextMetadata> = view("listJoinedContexts", JsonObject(emptyMap()), ListSerializer(ContextMetadata.serializer()))

    /**
     * List all participants
     *
     * `listParticipants`: a view, sent with `query`.
     */
    suspend fun listParticipants(): List<ContractBytes> = view("listParticipants", JsonObject(emptyMap()), ListSerializer(ContractBytesSerializer))

    /**
     * Get all signatures
     *
     * `listSignatures`: a view, sent with `query`.
     */
    suspend fun listSignatures(): List<SignatureRecord> = view("listSignatures", JsonObject(emptyMap()), ListSerializer(SignatureRecord.serializer()))

    /**
     * Confirm the CALLER's signature is on a document.
     *
     * The status is derived from the signatures on every read, so there is
     * nothing left to recompute; this stays so a client can ask, after
     * signing, whether its signature is the one on the document.
     *
     * `markParticipantSigned`: a call, sent with `execute`.
     */
    suspend fun markParticipantSigned(documentId: String) {
        call("markParticipantSigned", JsonObject(mapOf("documentId" to opt(documentId))), JsonElement.serializer())
    }

    /**
     * Register self as participant (for users who joined via open invitation)
     *
     * `registerSelfAsParticipant`: a call, sent with `execute`.
     */
    suspend fun registerSelfAsParticipant() {
        call("registerSelfAsParticipant", JsonObject(emptyMap()), JsonElement.serializer())
    }

    /**
     * Remove participant from shared context. The removal outranks the
     * participant's own registration, and is refused for the last admin.
     *
     * `removeParticipant`: a call, sent with `execute`.
     */
    suspend fun removeParticipant(userIdStr: String) {
        call("removeParticipant", JsonObject(mapOf("userIdStr" to opt(userIdStr))), JsonElement.serializer())
    }

    /**
     * Resolve private identity from shared identity
     *
     * `resolvePrivateIdentity`: a view, sent with `query`.
     */
    suspend fun resolvePrivateIdentity(sharedIdentityStr: String): ContractBytes? = view("resolvePrivateIdentity", JsonObject(mapOf("sharedIdentityStr" to opt(sharedIdentityStr))), NullableContractBytes)

    /**
     * `searchDocumentByEmbedding`: a view, sent with `query`.
     */
    suspend fun searchDocumentByEmbedding(queryEmbedding: List<Float>, documentId: String): String = view("searchDocumentByEmbedding", JsonObject(mapOf("queryEmbedding" to floats(queryEmbedding), "documentId" to opt(documentId))), String.serializer())

    /**
     * Record the CALLER's consent to sign a document, in their own slot.
     *
     * Consent is a personal act. Nobody can give it for you, so there is no
     * parameter to give — and the slot is yours alone on every node.
     *
     * `setConsent`: a call, sent with `execute`.
     */
    suspend fun setConsent(documentId: String) {
        call("setConsent", JsonObject(mapOf("documentId" to opt(documentId))), JsonElement.serializer())
    }

    /**
     * Change an EXISTING participant's permission level, up or down.
     *
     * `add_participant` cannot do this: it refuses a user who is already a
     * participant. Levels live in `AccessControl`, whose grants merge
     * last-writer-wins, so a demotion converges like a promotion. The last
     * admin cannot step down.
     *
     * `setParticipantPermission`: a call, sent with `execute`.
     */
    suspend fun setParticipantPermission(userIdStr: String, permission: PermissionLevel) {
        call("setParticipantPermission", JsonObject(mapOf("userIdStr" to opt(userIdStr), "permission" to JsonPrimitive(permission.name))), JsonElement.serializer())
    }

    /**
     * Set the instance up, once, by its owner: `isPrivate` for the account's signature library
     * (`contextName` "default"), else an agreement named `contextName`. Until then every method but
     * `isDefaultPrivateContext` answers `Invalid`.
     *
     * `setup`: a call, sent with `execute`.
     */
    suspend fun setup(isPrivate: Boolean, contextName: String) {
        call("setup", JsonObject(mapOf("isPrivate" to JsonPrimitive(isPrivate), "contextName" to opt(contextName))), JsonElement.serializer())
    }

    /**
     * Record the CALLER's signature on a document.
     *
     * The signer is the caller's ACCOUNT — a document is signed by a PERSON,
     * and one signer on two machines must not read as two signatories — and on
     * every other node it is the signature entry's owner stamp. There is no
     * signer parameter.
     *
     * A signature is not a field value, it is a whole new PDF: the signer
     * downloads the current version, flattens their mark into it in the
     * browser, uploads the result as a NEW blob, and records it here as a
     * write-once [`SignedVersion`] from `base_hash` to `new_hash`. Nothing is
     * overwritten: the uploaded document and every signature stay on record,
     * and the document's current version is the last one in the chain.
     *
     * `base_hash` is the hash the signer actually had in front of them. If it
     * is not the current version, somebody else signed in the meantime and
     * this PDF lacks their mark — refused, so the signer re-fetches and
     * re-signs.
     *
     * ⚠️ `pdf_blob_id_str` must name a blob THIS node holds. The announce below
     * fails the whole call otherwise, with
     * `blob operations not supported (NodeClient not available)` — a message
     * about the host, not about the blob, which reads like a misconfigured node.
     *
     * `signDocument`: a call, sent with `execute`.
     */
    suspend fun signDocument(documentId: String, baseHash: String, pdfBlobIdStr: String, fileSize: ULong, newHash: String) {
        call("signDocument", JsonObject(mapOf("documentId" to opt(documentId), "baseHash" to opt(baseHash), "pdfBlobIdStr" to opt(pdfBlobIdStr), "fileSize" to u64(fileSize), "newHash" to opt(newHash))), JsonElement.serializer())
    }

    /**
     * Upload a document
     *
     * `uploadDocument`: a call, sent with `execute`.
     */
    suspend fun uploadDocument(name: String, hash: String, pdfBlobIdStr: String, fileSize: ULong, embeddings: List<Float>? = null, extractedText: String? = null, chunks: List<DocumentChunk>? = null): String = call("uploadDocument", JsonObject(mapOf("name" to opt(name), "hash" to opt(hash), "pdfBlobIdStr" to opt(pdfBlobIdStr), "fileSize" to u64(fileSize), "embeddings" to floats(embeddings), "extractedText" to opt(extractedText), "chunks" to chunks(chunks))), String.serializer())

    /**
     * The caller's ACCOUNT id, as this contract sees it.
     *
     * Exists because the frontend cannot work it out. A device key and an
     * account id have both been 32 raw bytes — 64 hex characters — since core
     * 0.11.0-rc.27, so the two are indistinguishable by inspection, and this
     * app holds a DEVICE key in `localStorage` (`agreementContextUserID`, the
     * context member public key from the join response) while participants
     * are keyed by ACCOUNT. Comparing the two type-checks and silently matches
     * nothing, which is how a UI ends up unable to tell an admin that they
     * are one.
     *
     * One call removes the guess: the contract is the only thing that knows.
     *
     * `whoami`: a view, sent with `query`.
     */
    suspend fun whoami(): ContractBytes = view("whoami", JsonObject(emptyMap()), ContractBytesSerializer)

    private suspend fun <T> view(
        method: String,
        args: JsonObject,
        answer: KSerializer<T>,
    ): T = json.decodeFromString(answer, transport.query(method, args.toString()))

    private suspend fun <T> call(
        method: String,
        args: JsonObject,
        answer: KSerializer<T>,
    ): T = json.decodeFromString(answer, transport.execute(method, args.toString()))

    companion object {
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

        private val json = Json { ignoreUnknownKeys = true }

        /** A u64 argument: a decimal string; `none` an explicit null. */
        private fun u64(value: ULong?): JsonElement = value?.let { JsonPrimitive(it.toString()) } ?: JsonNull

        private fun opt(value: String?): JsonElement = value?.let { JsonPrimitive(it) } ?: JsonNull

        private fun floats(value: List<Float>?): JsonElement = value?.let { list -> JsonArray(list.map { JsonPrimitive(it) }) } ?: JsonNull

        private fun chunks(value: List<DocumentChunk>?): JsonElement =
            value?.let { json.encodeToJsonElement(ListSerializer(DocumentChunk.serializer()), it) } ?: JsonNull
    }
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
