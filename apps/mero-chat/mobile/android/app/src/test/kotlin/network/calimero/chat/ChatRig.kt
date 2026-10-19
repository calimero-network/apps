package network.calimero.chat

import com.calimero.mero.account.ApplicationIds
import com.calimero.mero.account.CloudAccount
import com.calimero.mero.account.DeviceCert
import com.calimero.mero.account.MemorySecureStore
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroClient
import com.calimero.mero.crypto.SeedSigner
import com.calimero.mero.relay.DcapRelayKeyVerifier
import com.calimero.mero.relay.forgetMethodKinds
import com.calimero.mero.storage.MemoryTokenStore
import com.calimero.mero.testkit.FakeCloud
import com.calimero.mero.testkit.FakeNode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import network.calimero.chat.data.ChatIdentity
import network.calimero.chat.data.ChatInvites
import network.calimero.chat.data.ChatRepository
import network.calimero.chat.data.MeroChatBackend
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import java.io.Closeable
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The whole delegated stack under test, end to end: the SDK's real [MeroClient] signed in through
 * a wallet that certifies this device's key, talking to [FakeNode]'s cloud manager + hosted relay
 * (mero-testkit) on a MockWebServer. Routes the fake does not serve (subgroup and group-context
 * listings, per-context contract outputs) are answered from [routes], keyed by request path.
 */
class ChatRig : Closeable {
    val node = FakeNode()
    val cloud: FakeCloud get() = node.cloud

    /** Exact path (no query) → handler of the request body, consulted before [FakeNode]. */
    val routes = ConcurrentHashMap<String, (body: String) -> MockResponse>()

    /** What [routes] answered, in order (FakeNode records its own in [FakeCloud.requests]). */
    val routed = CopyOnWriteArrayList<Pair<String, String>>()

    private val inner = node.dispatcher()
    val server: MockWebServer =
        MockWebServer().apply {
            dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        val path = request.path.orEmpty().substringBefore('?')
                        val handler = routes[path] ?: return inner.dispatch(request)
                        val body = request.body.readUtf8()
                        routed += path to body
                        return handler(body)
                    }
                }
            start()
        }
    val base: String = server.url("/").toString().trimEnd('/')

    private val root = SeedSigner("5c".repeat(32))
    private var opened: String? = null
    private val background = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val account =
        CloudAccount(
            MemorySecureStore(),
            cloudBaseUrl = base,
            walletUrl = "https://wallet.example/account-enroll",
            relayKeyVerifier = DcapRelayKeyVerifier(allowMock = true),
        )
    val client =
        MeroClient(
            account,
            MemoryTokenStore(),
            launchWallet = { _, url -> opened = url },
            config = MeroAppConfig(packageName = ChatInvites.APP_SLUG, registryUrl = base, cloudBaseUrl = base),
            scope = background,
        )
    val backend = MeroChatBackend(client, ChatInvites.APP_SLUG, registryUrl = base)
    val repo = ChatRepository(backend, nowSecs = { NOW })

    /** The account the wallet certifies, 64 hex, and as the contract writes it (base58). */
    val accountHex: String = DeviceCert.accountForRootPublicKey(root.publicKey)
    val me: String = ChatIdentity.userIdOf(accountHex)!!

    /** chat's application id, as the registry below derives it. */
    val applicationId: String = ApplicationIds.applicationIdForBundle(ChatInvites.APP_SLUG, SIGNER)

    init {
        forgetMethodKinds()
        cloud.registryBundles +=
            buildJsonObject {
                put("package", ChatInvites.APP_SLUG)
                put("signerId", SIGNER)
                put("appVersion", "0.6.0")
            }
    }

    /** Sign in the way a person does: open the wallet, approve, hand the redirect back. */
    suspend fun signIn() {
        client.signInWithCloud(android.content.ContextWrapper(null), CALLBACK)
        check(client.handleEnrolmentCallback(walletAnswer())) { "the wallet answer was not taken" }
        check(client.state.value.isAuthenticated) { "not signed in: ${client.state.value}" }
    }

    private fun walletAnswer(): String {
        val url = opened!!.toHttpUrl()
        val device = DeviceCert.mintDeviceId(accountHex, ByteArray(16) { 9 })
        val credential = DeviceCert.sign(root, device, url.queryParameter("enrol-device")!!, url.queryParameter("enrol-kem")!!)
        val state = URLEncoder.encode(url.queryParameter("state")!!, "UTF-8")
        return "$CALLBACK#credential=$credential&account=$accountHex&device=$device&state=$state"
    }

    /** A fixture with `{{ME}}` replaced by this account's base58 id. */
    fun fixture(name: String): JsonElement {
        val text =
            checkNotNull(javaClass.getResource("/fixtures/$name")) { "no fixture $name" }
                .readText()
                .replace("{{ME}}", me)
        return Json.parseToJsonElement(text)
    }

    /** Requests on the relay's `intents` route, newest last. */
    fun intents() = cloud.recorded("/intents").filter { it.method == "POST" }

    /** Requests on the relay's `query` route, newest last. */
    fun queries() = cloud.recorded("/query").filter { it.method == "POST" }

    /** `argsJson` of a recorded intent or query. */
    fun argsOf(body: JsonObject?): JsonObject = body!!["argsJson"]!!.jsonObject

    fun methodOf(body: JsonObject?): String = body!!["method"]!!.jsonPrimitive.content

    override fun close() {
        background.cancel()
        server.shutdown()
    }

    companion object {
        const val CALLBACK = "mero-chat://enrol"
        const val NOW = 1_760_900_000L
        val SIGNER = "77".repeat(32)

        fun json(body: JsonElement): MockResponse =
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(body.toString())

        /** The relay's `{data: {returns}}` envelope for a query or an intent. */
        fun returns(value: JsonElement): MockResponse = json(buildJsonObject { put("data", buildJsonObject { put("returns", value) }) })
    }
}
