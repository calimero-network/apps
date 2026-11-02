package network.calimero.sign.core

import com.calimero.mero.AppError
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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
    val contentTypes = mutableListOf<String>()
    val names = mutableMapOf<String, String>()
    val uploads = mutableListOf<String>()
    val instanceList = mutableListOf<SignInstance>()
    val created = mutableListOf<Pair<String, String?>>()
    private var next = 0

    override suspend fun uploadBlob(
        data: ByteArray,
        contentType: String,
        contextId: String,
    ): String {
        next += 1
        val id = "%064x".format(next + 0xB10B)
        blobs[id] = data to contextId
        uploads += contextId
        contentTypes += contentType
        return id
    }

    override suspend fun getBlob(
        blobId: String,
        contextId: String,
    ): ByteArray = blobs[blobId]?.first ?: throw ContractFailure("blob not found")

    override suspend fun instances(): List<SignInstance> = instanceList.toList()

    override suspend fun createInstance(
        name: String,
        org: String?,
    ): String {
        created += name to org
        val id = "c${created.size}".repeat(32)
        instanceList += SignInstance(id, name, IDs.me, org)
        return id
    }

    override suspend fun memberName(
        namespaceId: String,
        account: String,
    ): String? = names[account]
}

/** An `APP_ERROR` the contract answers with. */
fun appError(
    code: String,
    message: String,
): AppError = AppError("", JsonObject(mapOf("code" to JsonPrimitive(code), "fields" to JsonObject(mapOf("message" to JsonPrimitive(message))))))

/** Appends the PNG to the PDF, so the result differs and is checkable. */
val fakeStamper = PdfStamping { pdf, png, _ -> pdf + png }

/** An id as the JSON string the contract answers with. */
fun quoted(id: String): String = "\"$id\""

fun documentJson(
    id: String = "doc_1",
    hash: String,
    status: String = "Pending",
    required: List<String> = listOf(IDs.me, IDs.alice),
    uploadedAt: String = "1788952411519",
): String =
    """{"id":"$id","name":"NDA.pdf","hash":"$hash","uploadedBy":"${IDs.alice}","uploadedAt":"$uploadedAt",""" +
        """"status":"$status","pdfBlobId":"${IDs.blob}","size":"1234","requiredSigners":[${required.joinToString(",") { quoted(it) }}],""" +
        """"embeddings":null,"extractedText":null,"chunks":null}"""

fun detailsJson(
    participants: List<Pair<String, String>> = listOf(IDs.me to "Sign", IDs.alice to "Admin"),
    name: String = "Lease",
): String {
    val rows = participants.joinToString(",") { """{"userId":"${it.first}","permissionLevel":"${it.second}"}""" }
    return """{"contextId":"${IDs.agreementContext}","contextName":"$name","owner":"${IDs.alice}","isPrivate":false,""" +
        """"participantCount":"${participants.size}","participants":[$rows],"documentCount":"1","createdAt":"1"}"""
}

/** A backend with one workspace the account reaches the agreement in. */
fun seededBackend(): InMemoryAppBackend =
    InMemoryAppBackend(account = IDs.me).apply {
        namespaces = listOf(AppNamespace(IDs.workspace, "Acme", applicationId))
        members = setOf(IDs.agreementContext)
    }

/** The admin that lists that agreement (an app instance in the workspace). */
fun seededAdmin(): FakeSignAdmin = FakeSignAdmin().apply { instanceList += SignInstance(IDs.agreementContext, "Lease", IDs.alice, IDs.workspace) }

val agreementRef = AgreementRef(IDs.workspace, "Acme", IDs.agreementContext, "Lease", IDs.agreementContext)

fun directory(
    backend: InMemoryAppBackend,
    admin: SignAdmin = seededAdmin(),
    privateContext: String? = IDs.privateContext,
): AgreementDirectory {
    val cache = MemoryPrivateContextCache().apply { privateContext?.let { save(it, IDs.me) } }
    return AgreementDirectory(backend, admin, PrivateStore(backend, admin, cache), SyncTiming.IMMEDIATE)
}
