package network.calimero.pass.core

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConsentStale
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import network.calimero.pass.generated.DeviceView
import network.calimero.pass.generated.KeyWrapInput
import network.calimero.pass.generated.PassWireDecoding
import network.calimero.pass.generated.SecretView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The client speaks the component ABI the web app's `meroPass.ts` speaks. (Swift `WireTests`.) */
class WireTest {
    private val calls =
        listOf(
            "renameVault", "setRole", "removeMember", "setDefaultRole", "registerDevice", "revokeDevice", "addKeyWraps",
            "rotateKey", "addSecret", "updateSecret", "trashSecret", "restoreSecret", "purgeSecret",
        )
    private val views =
        listOf(
            "vaultInfo", "vaultName", "listMembers", "listDevices", "keyWrapsFor", "wrappedPairs", "secretHistory",
            "getSecret", "listSecrets", "getAuditLogs",
        )

    private fun RecordedContractCall.arg(key: String) = (args as JsonObject)[key]

    @Test
    fun `every method goes out camelCase`() =
        runTest {
            val backend = InMemoryAppBackend()
            backend.recording.handler = { call ->
                when (call.method) {
                    "addKeyWraps" -> JsonPrimitive(0)
                    "addSecret", "vaultName" -> JsonPrimitive("x")
                    "wrappedPairs", "listMembers", "listDevices", "keyWrapsFor", "secretHistory", "listSecrets", "getAuditLogs" -> JsonArray(emptyList())
                    else -> JsonNull
                }
            }
            val client = passClient(backend.contract, "app-1")
            runCatching { client.vaultInfo() }
            client.vaultName()
            client.listMembers()
            client.listDevices()
            client.keyWrapsFor("r")
            client.wrappedPairs()
            client.secretHistory("s")
            assertNull("an unknown id answers null", client.getSecret("s"))
            client.listSecrets()
            client.getAuditLogs()
            client.renameVault("V")
            client.setRole("a", "editor")
            client.removeMember("a")
            client.setDefaultRole("viewer")
            client.registerDevice("f", "pk", "l", "mobile")
            client.revokeDevice("f")
            client.addKeyWraps(listOf(PassWireDecoding.encode(KeyWrapInput.serializer(), KeyWrapInput("k", "r", "w", "e"))))
            client.rotateKey("k")
            client.addSecret("s", "login", "n", "", emptyMap())
            client.updateSecret("s", null, null, emptyMap(), false)
            client.trashSecret("s")
            client.restoreSecret("s")
            client.purgeSecret("s")

            for (method in calls) {
                assertEquals(
                    method, RecordedContractCall.Path.EXECUTE,
                    backend.recording
                        .calls(method)
                        .single()
                        .path,
                )
            }
            for (method in views) {
                assertEquals(
                    method, RecordedContractCall.Path.QUERY,
                    backend.recording
                        .calls(method)
                        .single()
                        .path,
                )
            }
            val device = backend.recording.calls("registerDevice").single()
            assertEquals(JsonPrimitive("pk"), device.arg("publicKey"))
            assertNull(device.arg("public_key"))
            assertEquals(
                JsonPrimitive("k"),
                backend.recording
                    .calls("rotateKey")
                    .single()
                    .arg("keyId"),
            )
            val wrap =
                (
                    backend.recording
                        .calls("addKeyWraps")
                        .single()
                        .arg("wraps") as JsonArray
                ).single() as JsonObject
            assertEquals(JsonPrimitive("k"), wrap["keyId"])
            val update = backend.recording.calls("updateSecret").single()
            assertEquals("option<string> goes out as an explicit null", JsonNull, update.arg("name"))
            assertEquals(JsonNull, update.arg("tags"))
        }

    @Test
    fun `u64 answers arrive as decimal strings`() {
        val secrets =
            PassWireDecoding.decode(
                kotlinx.serialization.builtins.ListSerializer(SecretView.serializer()),
                """[{"id":"s","kind":"login","name":"n","tags":"","fields":{"username":"u"},"createdAt":"1761000000123",
                   "createdBy":"a","updatedAt":"1761000000456","updatedBy":"a","trashed":false,"trashedAt":"0"}]""",
            )
        assertEquals(1_761_000_000_123uL, secrets.single().createdAt)
        assertEquals("u", secrets.single().fields["username"])
        val device =
            PassWireDecoding.decode(
                DeviceView.serializer(),
                """{"fingerprint":"f","publicKey":"pk","label":"l","kind":"mobile","account":"a","addedAt":"42","revoked":false}""",
            )
        assertEquals(42uL, device.addedAt)
        assertEquals("pk", device.publicKey)
        assertEquals(JsonPrimitive("123"), (PassWireDecoding.normalized(Json.parseToJsonElement("""{"title":"123"}""")) as JsonObject)["title"])
    }

    @Test
    fun `the contract's refusals read as plain words`() {
        fun app(
            code: String,
            message: String? = null,
        ) = AppError(
            "app error",
            buildJsonObject {
                put("code", code)
                put("fields", buildJsonObject { message?.let { put("message", it) } })
            },
        )
        assertEquals("Your role in this vault can't do that.", PassErrorText.describe(app("Forbidden")))
        assertEquals("Already exists.", PassErrorText.describe(app("Conflict", "already exists")))
        assertEquals("Only a vault Admin can do that.", PassErrorText.describe(app("Forbidden", "only a vault admin can do that")))
        assertEquals("You cancelled the passkey prompt, so nothing changed.", PassErrorText.describe(ConfirmCancelled()))
        assertTrue(PassErrorText.describe(ConsentStale("x")).contains("already decided"))
    }

    @Test
    fun `reads the web app's invite links and joins the team the node names`() =
        runTest {
            val web = PassInvitation.parse("https://pass.example.com/?invite=inv_abc123")!!
            assertEquals("inv_abc123", web.invitation.token)
            assertEquals(PassInvitation.Kind.TEAM, web.kind)
            assertEquals("inv_abc123", PassInvitation.parse("inv_abc123")!!.invitation.token)
            assertNull(PassInvitation.parse("https://pass.example.com/?other=1"))
            val model = InvitationModel(vaultAttempts = 1, vaultRetryDelayMs = 0)
            assertTrue(model.open("https://pass.example.com/?invite=inv_abc123"))
            model.accept(backend = { InMemoryAppBackend() }, didJoin = {})
            assertTrue(model.stage.value is InvitationModel.Stage.Joined)
        }
}
