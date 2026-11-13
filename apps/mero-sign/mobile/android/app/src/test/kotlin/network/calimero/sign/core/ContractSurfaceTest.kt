package network.calimero.sign.core

import com.calimero.mero.app.ContextContractCalling
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import network.calimero.sign.generated.ContractBytes
import network.calimero.sign.generated.SignContract
import network.calimero.sign.generated.client.SignClient
import network.calimero.sign.generated.client.SignClient.PermissionLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The client against the contract's component ABI (`logic/res/abi.json`): every method by its
 * camelCase name, sent the right way (view or call), with exactly the ABI's parameters but an unset
 * `option` (left out), and a u64 as a decimal string. (iOS: `ContractSurfaceTests`.)
 */
class ContractSurfaceTest {
    private class Sent(
        val method: String,
        val view: Boolean,
        val args: JsonObject,
    )

    private class Recorder : ContextContractCalling {
        val sent = mutableListOf<Sent>()

        override suspend fun query(
            method: String,
            argsJson: String,
        ): String {
            sent += Sent(method, true, Json.parseToJsonElement(argsJson).jsonObject)
            return ANSWERS[method] ?: "null"
        }

        override suspend fun execute(
            method: String,
            argsJson: String,
        ): String {
            sent += Sent(method, false, Json.parseToJsonElement(argsJson).jsonObject)
            return ANSWERS[method] ?: "null"
        }
    }

    @Test
    fun `every method is the ABI's name with its parameters`() =
        runTest {
            val r = Recorder()
            val c = SignClient(r)
            c.addParticipant(IDs.alice, PermissionLevel.Sign)
            c.createSignature("S", IDs.blob, 3u)
            c.deleteDocument("d")
            c.deleteSignature(7u)
            c.getContextDetails("c")
            c.getContextId()
            c.getDocumentSignatures("d")
            c.getIdentityMapping("c")
            c.getSharedIdentity("c")
            c.getUserPermission(IDs.me)
            c.hasConsented(IDs.me, "d")
            c.isDefaultPrivateContext()
            c.joinSharedContext("c", IDs.me, "n")
            c.leaveSharedContext("c")
            c.listDocuments()
            c.listJoinedContexts()
            c.listParticipants()
            c.listSignatures()
            c.markParticipantSigned("d")
            c.registerSelfAsParticipant()
            c.removeParticipant(IDs.alice)
            c.resolvePrivateIdentity(IDs.me)
            c.searchDocumentByEmbedding(listOf(0.5f), "d")
            c.setConsent("d")
            c.setParticipantPermission(IDs.alice, PermissionLevel.Read)
            c.setup(false, "Lease")
            c.signDocument("d", "a", IDs.blob, 9u, "b")
            c.uploadDocument("n", "h", IDs.blob, 9u)
            c.whoami()

            assertEquals(ABI.keys, r.sent.map { it.method }.toSet())
            assertEquals(VIEWS, SignContract.VIEWS)
            assertEquals(ABI.keys - VIEWS, SignContract.CALLS)
            for (request in r.sent) {
                assertEquals(request.method, ABI[request.method]!!.toSet() - UNSET_OPTIONS[request.method].orEmpty(), request.args.keys)
                assertEquals(request.method, request.method in VIEWS, request.view)
            }
            assertEquals(JsonPrimitive("9"), r.sent.first { it.method == "signDocument" }.args["fileSize"])
            assertNull(r.sent.first { it.method == "uploadDocument" }.args["embeddings"])
            assertEquals(JsonPrimitive("7"), r.sent.first { it.method == "deleteSignature" }.args["signatureId"])
            assertEquals(JsonPrimitive("Sign"), r.sent.first { it.method == "addParticipant" }.args["permission"])
        }

    @Test
    fun `answers read the component wire`() =
        runTest {
            val c = SignClient(Recorder())
            val document = c.listDocuments().single()
            assertEquals(1234uL, document.size)
            assertEquals(1_788_952_411_519uL, document.uploadedAt)
            assertEquals(IDs.blob, ContractBytes.Text(document.pdfBlobId).hex)
            assertEquals(listOf(IDs.me, IDs.alice), document.requiredSigners.map { ContractBytes.Text(it).hex })
            val details = c.getContextDetails("c")
            assertEquals(2uL, details.participantCount)
            assertEquals(PermissionLevel.Sign, details.participants.first().permissionLevel)
            assertEquals(7uL, c.createSignature("S", IDs.blob, 3u))
            assertNull(c.resolvePrivateIdentity(IDs.me))
        }

    private companion object {
        /** The `option` parameters the calls above leave unset: the client leaves them out. */
        val UNSET_OPTIONS: Map<String, Set<String>> = mapOf("uploadDocument" to setOf("embeddings", "extractedText", "chunks"))

        val ABI: Map<String, List<String>> =
            mapOf(
                "addParticipant" to listOf("userIdStr", "permission"),
                "createSignature" to listOf("name", "blobIdStr", "dataSize"),
                "deleteDocument" to listOf("documentId"),
                "deleteSignature" to listOf("signatureId"),
                "getContextDetails" to listOf("contextIdStr"),
                "getContextId" to emptyList(),
                "getDocumentSignatures" to listOf("documentId"),
                "getIdentityMapping" to listOf("contextIdStr"),
                "getSharedIdentity" to listOf("contextIdStr"),
                "getUserPermission" to listOf("userIdStr"),
                "hasConsented" to listOf("userIdStr", "documentId"),
                "isDefaultPrivateContext" to emptyList(),
                "joinSharedContext" to listOf("contextIdStr", "sharedIdentityStr", "contextName"),
                "leaveSharedContext" to listOf("contextIdStr"),
                "listDocuments" to emptyList(),
                "listJoinedContexts" to emptyList(),
                "listParticipants" to emptyList(),
                "listSignatures" to emptyList(),
                "markParticipantSigned" to listOf("documentId"),
                "registerSelfAsParticipant" to emptyList(),
                "removeParticipant" to listOf("userIdStr"),
                "resolvePrivateIdentity" to listOf("sharedIdentityStr"),
                "searchDocumentByEmbedding" to listOf("queryEmbedding", "documentId"),
                "setConsent" to listOf("documentId"),
                "setParticipantPermission" to listOf("userIdStr", "permission"),
                "setup" to listOf("isPrivate", "contextName"),
                "signDocument" to listOf("documentId", "baseHash", "pdfBlobIdStr", "fileSize", "newHash"),
                "uploadDocument" to listOf("name", "hash", "pdfBlobIdStr", "fileSize", "embeddings", "extractedText", "chunks"),
                "whoami" to emptyList(),
            )

        val VIEWS =
            setOf(
                "getContextDetails", "getContextId", "getDocumentSignatures", "getIdentityMapping", "getSharedIdentity",
                "getUserPermission", "hasConsented", "isDefaultPrivateContext", "listDocuments", "listJoinedContexts",
                "listParticipants", "listSignatures", "resolvePrivateIdentity", "searchDocumentByEmbedding", "whoami",
            )

        val ANSWERS: Map<String, String> =
            mapOf(
                "createSignature" to "\"7\"",
                "getContextDetails" to detailsJson(),
                "getContextId" to quoted(IDs.agreementContext),
                "getDocumentSignatures" to "[]",
                "getIdentityMapping" to """{"privateIdentity":"a","sharedIdentity":"a","contextId":"c","createdAt":"1"}""",
                "getSharedIdentity" to quoted(IDs.me),
                "getUserPermission" to "\"Sign\"",
                "hasConsented" to "false",
                "isDefaultPrivateContext" to "true",
                "listDocuments" to "[${documentJson(hash = "h")}]",
                "listJoinedContexts" to "[]",
                "listParticipants" to "[${quoted(IDs.me)}]",
                "listSignatures" to "[]",
                "resolvePrivateIdentity" to "null",
                "searchDocumentByEmbedding" to "\"\"",
                "uploadDocument" to "\"doc_9\"",
                "whoami" to quoted(IDs.me),
            )
    }
}
