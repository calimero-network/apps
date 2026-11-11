package network.calimero.sign.core

import com.calimero.mero.CalimeroClient
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.crypto.Hex

/** One app instance of Mero Sign the account reaches. (Swift `SignInstance`.) */
data class SignInstance(
    val appId: String,
    val name: String,
    /** The account that created it. */
    val owner: String,
    /** The organization it is in; null for an instance the account owns outright. */
    val org: String?,
)

/**
 * What Mero Sign needs beyond `MeroAppBackend`, from the signed-in `CalimeroClient`, the same calls
 * the web makes (`app/src/lib/agreements.ts`): blobs with their content type (the contract stores
 * the 64-hex id), this app's instances, creating the library, and member names. The app uses
 * [ClientSignAdmin]; tests use a fake. (Swift `SignAdmin`.)
 */
interface SignAdmin {
    /** Store bytes as a blob of an app instance. Returns its id as 64 lowercase hex. */
    suspend fun uploadBlob(
        data: ByteArray,
        contentType: String,
        contextId: String,
    ): String

    /** A blob's bytes, read through the instance that holds it. */
    suspend fun getBlob(
        blobId: String,
        contextId: String,
    ): ByteArray

    /** Mero Sign's instances the account reaches. */
    suspend fun instances(): List<SignInstance>

    /** Create an instance named [name] in [org] (or the account's own, in none). Returns its app id. */
    suspend fun createInstance(
        name: String,
        org: String?,
    ): String

    /** The name a member set for themselves in an organization. */
    suspend fun memberName(
        namespaceId: String,
        account: String,
    ): String?
}

/** [SignAdmin] over the signed-in [CalimeroClient] and the account's backend. (Swift `ClientSignAdmin`.) */
class ClientSignAdmin(
    private val backend: MeroAppBackend,
    private val client: CalimeroClient?,
    /** The app's package, or a bundle hash on a development cluster. */
    private val applicationId: String = SignConstants.PACKAGE_NAME,
) : SignAdmin {
    private fun signedIn(): CalimeroClient = client ?: throw SignModelException("You're signed out. Sign in again and retry.")

    private val isBundle: Boolean get() = Hex.isHex32(applicationId)

    override suspend fun uploadBlob(
        data: ByteArray,
        contentType: String,
        contextId: String,
    ): String {
        val id = SignIds.blobHex(signedIn().uploadBlob(contextId, data, contentType).id)
        if (id.isEmpty()) throw SignModelException("Your cluster returned a blob id this app can't use.")
        return id
    }

    override suspend fun getBlob(
        blobId: String,
        contextId: String,
    ): ByteArray = signedIn().blobContent(contextId, blobId).data

    override suspend fun instances(): List<SignInstance> {
        val apps = if (isBundle) signedIn().apps.list(bundle = applicationId) else signedIn().apps.list(`package` = applicationId)
        return apps.apps.map { SignInstance(it.appId, it.name, it.owner, it.org) }
    }

    override suspend fun createInstance(
        name: String,
        org: String?,
    ): String =
        signedIn()
            .apps
            .create(name = name, bundle = applicationId.takeIf { isBundle }, `package` = applicationId.takeUnless { isBundle }, org = org)
            .appId

    override suspend fun memberName(
        namespaceId: String,
        account: String,
    ): String? = backend.listMembers(namespaceId).firstOrNull { SignIds.same(it.identity, account) }?.name
}
