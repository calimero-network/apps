package network.calimero.sign.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.crypto.Hex
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

object IDs {
    val me = "ab".repeat(32)
    val alice = "a1".repeat(32)
    val workspace = "11".repeat(32)
    val personal = "22".repeat(32)
    val agreementGroup = "33".repeat(32)
    val agreementContext = "44".repeat(32)
    val privateGroup = "55".repeat(32)
    val privateContext = "66".repeat(32)
    val blob = "77".repeat(32)
}

class ContractFailure(
    message: String,
) : Exception(message)

/** Scripted contract answers by method (optionally per context), as JSON text. */
class Script {
    private val answers = mutableMapOf<String, (RecordedContractCall) -> String>()

    fun on(
        method: String,
        contextId: String? = null,
        answer: (RecordedContractCall) -> String,
    ) {
        answers["${contextId ?: "*"}|$method"] = answer
    }

    fun json(
        method: String,
        text: String,
        contextId: String? = null,
    ) = on(method, contextId) { text }

    fun fail(
        method: String,
        text: String,
    ) = on(method) { throw ContractFailure(text) }

    fun install(backend: InMemoryAppBackend) {
        backend.recording.handler = { call ->
            val answer = answers["${call.contextId}|${call.method}"] ?: answers["*|${call.method}"]
            if (answer == null) JsonNull else Json.parseToJsonElement(answer(call))
        }
    }
}

fun RecordedContractCall.arg(name: String): JsonElement? = args.jsonObject[name]

fun RecordedContractCall.text(name: String): String? = (arg(name) as? JsonPrimitive)?.content

class FakeSignAdmin : SignAdmin {
    val blobs = mutableMapOf<String, Pair<ByteArray, String>>()
    val metadata = mutableMapOf<String, GroupRecord>()
    val names = mutableMapOf<String, String>()
    val uploads = mutableListOf<String>()
    private var next = 0

    override suspend fun uploadBlob(
        data: ByteArray,
        contextId: String,
    ): String {
        next += 1
        val id = "%064x".format(next + 0xB10B)
        blobs[id] = data to contextId
        uploads += contextId
        return id
    }

    override suspend fun getBlob(
        blobId: String,
        contextId: String,
    ): ByteArray = blobs[blobId]?.first ?: throw ContractFailure("blob not found")

    override suspend fun groupMetadata(groupId: String): GroupRecord? = metadata[groupId]

    override suspend fun setGroupMetadata(
        groupId: String,
        name: String?,
        data: Map<String, String>,
    ) {
        metadata[groupId] = GroupRecord(name, data)
    }

    override suspend fun memberName(
        namespaceId: String,
        account: String,
    ): String? = names[account]
}

/** Appends the PNG to the PDF, so the result differs and is checkable. */
val fakeStamper = PdfStamping { pdf, png, _ -> pdf + png }

fun bytes(hex: String): String = Hex.decode(hex, "id", 32).joinToString(",", "[", "]") { (it.toInt() and 0xff).toString() }

fun documentJson(
    id: String = "doc_1",
    hash: String,
    status: String = "Pending",
    required: List<String> = listOf(IDs.me, IDs.alice),
    uploadedAt: String = "1788952411519000000",
): String =
    """{"id":"$id","name":"NDA.pdf","hash":"$hash","uploaded_by":${bytes(IDs.alice)},"uploaded_at":$uploadedAt,""" +
        """"status":"$status","pdf_blob_id":"${IDs.blob}","size":1234,"required_signers":[${required.joinToString(",") { bytes(it) }}],""" +
        """"embeddings":null,"extracted_text":null,"chunks":null}"""

fun detailsJson(
    participants: List<Pair<String, String>> = listOf(IDs.me to "Sign", IDs.alice to "Admin"),
    name: String = "Lease",
): String {
    val rows = participants.joinToString(",") { """{"user_id":${bytes(it.first)},"permission_level":"${it.second}"}""" }
    return """{"context_id":${bytes(IDs.agreementContext)},"context_name":"$name","owner":${bytes(IDs.alice)},"is_private":false,""" +
        """"participant_count":${participants.size},"participants":[$rows],"document_count":1,"created_at":1}"""
}

fun seededBackend(): InMemoryAppBackend =
    InMemoryAppBackend(account = IDs.me).apply {
        namespaces = listOf(AppNamespace(IDs.workspace, "Acme", applicationId))
        subgroups = mapOf(IDs.workspace to listOf(AppSubgroup(IDs.agreementGroup, "Lease", listOf(IDs.agreementContext))))
        members = setOf(IDs.agreementContext)
    }

val agreementRef = AgreementRef(IDs.workspace, "Acme", IDs.agreementGroup, "Lease", IDs.agreementContext)

fun directory(
    backend: InMemoryAppBackend,
    admin: SignAdmin = FakeSignAdmin(),
    privateContext: String? = IDs.privateContext,
): AgreementDirectory {
    val cache = MemoryPrivateContextCache().apply { privateContext?.let { save(it, IDs.me) } }
    return AgreementDirectory(backend, PrivateStore(backend, admin, "app", cache), SyncTiming.IMMEDIATE)
}
