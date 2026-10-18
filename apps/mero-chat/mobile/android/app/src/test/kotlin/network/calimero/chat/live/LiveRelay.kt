package network.calimero.chat.live

import com.calimero.mero.account.CloudAccount
import com.calimero.mero.account.DeviceCert
import com.calimero.mero.account.MemorySecureStore
import com.calimero.mero.account.ResolvedApplication
import com.calimero.mero.account.createAccountRootSigner
import com.calimero.mero.compose.MemoryKeyValueStore
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroClient
import com.calimero.mero.storage.MemoryTokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import network.calimero.chat.app.ChannelModel
import network.calimero.chat.app.ChannelsModel
import network.calimero.chat.app.ProfileStore
import network.calimero.chat.app.WorkspacesModel
import network.calimero.chat.data.Channel
import network.calimero.chat.data.ChatIdentity
import network.calimero.chat.data.ChatInvites
import network.calimero.chat.data.ChatRepository
import network.calimero.chat.data.MeroChatBackend
import network.calimero.chat.data.Workspace
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assume.assumeTrue
import java.io.Closeable
import java.io.File
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

/**
 * Where the live tests' relay is: `MERO_E2E_RELAY_URL` and `MERO_E2E_APP_ID` from the environment,
 * else from `mobile/e2e/.relay.env`, which `mobile/e2e/run-relay.sh` writes. Without them every live
 * test is skipped (JUnit `assume`), so the ordinary unit-test run stays offline.
 */
object LiveEnv {
    private val file: Map<String, String> by lazy { readEnvFile() }

    private fun value(key: String): String? = System.getenv(key)?.trim()?.ifEmpty { null } ?: file[key]?.trim()?.ifEmpty { null }

    val relayUrl: String? get() = value("MERO_E2E_RELAY_URL")?.trimEnd('/')
    val applicationId: String? get() = value("MERO_E2E_APP_ID")?.lowercase()

    /** The bundle's version: run-relay.sh builds it as 0.0.0. */
    val applicationVersion: String get() = value("MERO_E2E_APP_VERSION") ?: "0.0.0"

    /** The relay's admin login (relay.yml's), used only by [FakeCloudRoutes] to learn the relay's account. */
    val adminUser: String get() = value("MERO_E2E_RELAY_ADMIN_USER") ?: "dev"
    val adminPassword: String get() = value("MERO_E2E_RELAY_ADMIN_PASSWORD") ?: "dev-password"

    /** Skip the calling test unless a relay is configured. */
    fun requireRelay() {
        assumeTrue("MERO_E2E_RELAY_URL / MERO_E2E_APP_ID not set and no mobile/e2e/.relay.env: skipping live tests", relayUrl != null && applicationId != null)
    }

    /** `MERO_E2E_RELAY_ENV`, else the first `mobile/e2e/.relay.env` above the working directory. */
    private fun readEnvFile(): Map<String, String> {
        val explicit = System.getenv("MERO_E2E_RELAY_ENV")?.let(::File)
        val found =
            explicit ?: generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
                .flatMap { sequenceOf(File(it, "e2e/.relay.env"), File(it, "mobile/e2e/.relay.env")) }
                .firstOrNull { it.isFile }
        if (found == null || !found.isFile) return emptyMap()
        return found
            .readLines()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") && '=' in it }
            .associate { it.substringBefore('=').trim() to it.substringAfter('=').trim() }
    }
}

/**
 * The Calimero Cloud manager's routes, and ONLY those, in process: which relay serves an account
 * (`/api/cloud/accounts/{a}/relays`), which nodes admit for a namespace
 * (`/api/cloud/namespaces/{ns}/admitters`), their challenges, and the founder's HA request. No cloud
 * exists in this rig, so these answer what a cloud that had assigned the one real relay would:
 * that relay, under its own account. Every relay call the app makes goes to the real relay.
 *
 * The relay's account (the executor the cloud names beside it) is read once from the relay's own
 * `GET /admin-api/identity` with the rig's admin login — the cloud knows it from the relay's
 * registration; the app never sees that login.
 */
class FakeCloudRoutes(
    val relayUrl: String,
) : Closeable {
    /** The relay's account, 64 hex. */
    val relayAccount: String = learnRelayAccount(relayUrl)

    /** Accounts the cloud has assigned the relay to (a new account is a member of nothing). */
    private val assigned = ConcurrentHashMap.newKeySet<String>()

    /** Every request this fake answered, as `METHOD path`. */
    val requests = CopyOnWriteArrayList<String>()

    private val server =
        MockWebServer().apply {
            dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        val path = request.path.orEmpty().substringBefore('?')
                        requests += "${request.method} $path"
                        return route(request.method.orEmpty(), path)
                    }
                }
            start()
        }

    val baseUrl: String = server.url("/").toString().trimEnd('/')

    /** List the relay as [account]'s (as the cloud does once the account is hosted). */
    fun assign(account: String) {
        assigned += account.lowercase()
    }

    private fun route(
        method: String,
        path: String,
    ): MockResponse {
        val seg = path.trim('/').split('/')
        return when {
            method == "GET" && seg.size == 5 && seg.take(3) == listOf("api", "cloud", "accounts") && seg[4] == "challenge" ->
                ok(challenge(accountId = seg[3]))
            method == "GET" && seg.size == 5 && seg.take(3) == listOf("api", "cloud", "accounts") && seg[4] == "relays" ->
                ok(relays(seg[3]))
            method == "GET" && seg.size == 5 && seg.take(3) == listOf("api", "cloud", "namespaces") && seg[4] == "challenge" ->
                ok(challenge(namespaceId = seg[3]))
            method == "GET" && seg.size == 5 && seg.take(3) == listOf("api", "cloud", "namespaces") && seg[4] == "admitters" ->
                ok(admitters(seg[3]))
            method == "POST" && seg.size == 7 && seg.take(3) == listOf("api", "cloud", "accounts") && seg[6] == "enable-ha" ->
                ok(
                    buildJsonObject {
                        put("namespace_id", seg[5])
                        put("status", "requested")
                    }.toString(),
                )
            else -> MockResponse().setResponseCode(404).setBody("""{"error":"the fake cloud does not serve $method $path"}""")
        }
    }

    private fun challenge(
        accountId: String? = null,
        namespaceId: String? = null,
    ): String =
        buildJsonObject {
            accountId?.let { put("account_id", it) }
            namespaceId?.let { put("namespace_id", it) }
            put("nonce", randomHex(32))
            put("expires_at_ms", System.currentTimeMillis() + 120_000)
        }.toString()

    private fun relays(account: String): String =
        buildJsonObject {
            put(
                "relays",
                buildJsonArray {
                    if (account.lowercase() in assigned) {
                        add(
                            buildJsonObject {
                                put("peer_id", "live-relay")
                                put("relay_url", relayUrl)
                                put("fresh", true)
                                put("executor_account", relayAccount)
                                put("assigned", true)
                            },
                        )
                    }
                },
            )
        }.toString()

    private fun admitters(namespaceId: String): String =
        buildJsonObject {
            put("namespace_id", namespaceId)
            put(
                "admitters",
                buildJsonArray {
                    add(
                        buildJsonObject {
                            put("peer_id", "live-relay")
                            put("account", relayAccount)
                            put("relay_url", relayUrl)
                            put("status", "active")
                            put("fresh", true)
                            put("can_admit", true)
                            put("authorship_ready", true)
                            put("can_execute", true)
                            put("tee_role", "RelayTee")
                        },
                    )
                },
            )
            put("servable", true)
            put("writable", true)
        }.toString()

    private fun ok(body: String): MockResponse = MockResponse().setResponseCode(200).setHeader("Content-Type", "application/json").setBody(body)

    override fun close() = server.shutdown()

    companion object {
        private val http = OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build()
        private val json = "application/json".toMediaType()

        private fun learnRelayAccount(relayUrl: String): String {
            val login =
                buildJsonObject {
                    put("auth_method", "user_password")
                    put("public_key", LiveEnv.adminUser)
                    put("client_name", "mero-chat-live-tests")
                    put("permissions", JsonArray(emptyList()))
                    put("timestamp", System.currentTimeMillis() / 1000)
                    put(
                        "provider_data",
                        buildJsonObject {
                            put("username", LiveEnv.adminUser)
                            put("password", LiveEnv.adminPassword)
                        },
                    )
                }
            val token =
                Json
                    .parseToJsonElement(post("$relayUrl/auth/token", login.toString()))
                    .jsonObject["data"]!!
                    .jsonObject["access_token"]!!
                    .jsonPrimitive.content
            val identity = get("$relayUrl/admin-api/identity", token)
            return Json
                .parseToJsonElement(identity)
                .jsonObject["data"]!!
                .jsonObject["accountId"]!!
                .jsonPrimitive.content
                .lowercase()
        }

        private fun post(
            url: String,
            body: String,
        ): String =
            execute(
                Request
                    .Builder()
                    .url(url)
                    .post(body.toRequestBody(json))
                    .build(),
            )

        private fun get(
            url: String,
            bearer: String,
        ): String =
            execute(
                Request
                    .Builder()
                    .url(url)
                    .header("Authorization", "Bearer $bearer")
                    .build(),
            )

        private fun execute(request: Request): String =
            http.newCall(request).execute().use { res ->
                val text = res.body?.string().orEmpty()
                check(res.isSuccessful) { "${request.method} ${request.url} answered ${res.code}: $text" }
                text
            }

        fun randomHex(bytes: Int): String = ByteArray(bytes).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    }
}

/**
 * One person on one phone: a brand-new account minted OFFLINE (a BIP39 account root, which a
 * wallet would hold, certifying this device's fresh key), signed in through the app's own path
 * (the SDK's [MeroClient] completing a wallet redirect), and the app's real repository and view
 * models on top of it — talking to the real relay.
 */
class LiveUser(
    val displayName: String,
    private val cloud: FakeCloudRoutes,
    /** Assign the cloud's relay to this account (a founder's account is hosted; a joiner's is not yet). */
    hosted: Boolean,
) : Closeable {
    private val root = createAccountRootSigner(MemorySecureStore())
    val accountHex: String = root.accountId
    val userId: String = ChatIdentity.userIdOf(accountHex)!!

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var walletUrl: String? = null
    private val appId = LiveEnv.applicationId!!

    val account =
        CloudAccount(
            MemorySecureStore(),
            cloudBaseUrl = cloud.baseUrl,
            walletUrl = "https://wallet.invalid/account-enroll",
        )
    val client =
        MeroClient(
            account,
            MemoryTokenStore(),
            launchWallet = { _, url -> walletUrl = url },
            config = MeroAppConfig(packageName = ChatInvites.APP_SLUG, registryUrl = cloud.baseUrl, cloudBaseUrl = cloud.baseUrl),
            scope = scope,
            resolveApplicationId = { _, _ -> appId },
        )

    /** The registry is not part of this rig: chat's application is the one installed on the relay. */
    private val application = ResolvedApplication(appId, ChatInvites.APP_SLUG, signerId = "", version = LiveEnv.applicationVersion)
    val repo = ChatRepository(MeroChatBackend(client, ChatInvites.APP_SLUG, cloud.baseUrl) { _, _ -> application })
    val profile = ProfileStore(MemoryKeyValueStore()).also { it.setDisplayName(displayName) }
    val workspaces = WorkspacesModel(repo, scope, profile)

    init {
        if (hosted) cloud.assign(accountHex)
    }

    fun channels(workspace: Workspace) = ChannelsModel(repo, scope, profile, workspace)

    fun channel(
        channel: Channel,
        pollIntervalMs: Long = ChannelModel.DEFAULT_POLL_MS,
    ) = ChannelModel(repo, scope, channel, pollIntervalMs)

    /** Sign in as the app does: open the wallet, which approves this device, and hand its redirect back. */
    suspend fun signIn() {
        client.signInWithCloud(android.content.ContextWrapper(null), CALLBACK)
        check(client.handleEnrolmentCallback(walletAnswer())) { "the wallet answer was not taken" }
    }

    /** What the wallet sends back: this device's keys, certified by the account root. */
    private fun walletAnswer(): String {
        val url = checkNotNull(walletUrl) { "the wallet was not opened" }.toHttpUrl()
        val nonce = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val device = DeviceCert.mintDeviceId(accountHex, nonce)
        val credential = DeviceCert.sign(root, device, url.queryParameter("enrol-device")!!, url.queryParameter("enrol-kem")!!)
        val state = URLEncoder.encode(url.queryParameter("state")!!, "UTF-8")
        return "$CALLBACK#credential=$credential&account=$accountHex&device=$device&state=$state"
    }

    override fun close() {
        runBlocking { runCatching { client.signOut() } }
        scope.cancel()
    }

    companion object {
        const val CALLBACK = "mero-chat://enrol"
    }
}

/** Poll [probe] until it returns non-null, or fail after [timeoutMs] with [what] and the last state. */
suspend fun <T : Any> eventually(
    what: String,
    timeoutMs: Long = 30_000,
    everyMs: Long = 250,
    state: () -> Any? = { null },
    probe: suspend () -> T?,
): T {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (true) {
        probe()?.let { return it }
        if (System.currentTimeMillis() > deadline) throw AssertionError("timed out after ${timeoutMs}ms waiting for $what; last state: ${state()}")
        delay(everyMs)
    }
}
