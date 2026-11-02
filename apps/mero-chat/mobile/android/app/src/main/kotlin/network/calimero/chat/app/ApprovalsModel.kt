package network.calimero.chat.app

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReportScope
import com.calimero.mero.confirmationCode
import com.calimero.mero.releaseConsent
import com.calimero.mero.upgradeConsent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.chat.data.describeChatError

/**
 * What waits for the signed-in person's approval on a Calimero 1.0 cluster: a newer release of Mero
 * Chat for one of their app instances, or a node release their org (or account) has to approve.
 * Approving opens the node's consent page in a Custom Tab; the app never approves by itself.
 * Before the page opens, [code] holds the request's confirmation code: the screen shows it, and the
 * person continues ([continueToPage]) or stops ([cancelCode]). The page shows the same code.
 * (Swift `ApprovalsModel`.)
 */
class ApprovalsModel(
    private val packageName: String,
    private val appName: String,
    private val fetch: suspend (org: String?) -> PendingApprovals,
    private val consent: suspend (
        request: (String) -> ConsentRequest,
        confirm: suspend (ConsentStarted) -> Boolean,
    ) -> ConsentResult?,
) {
    /** One thing to approve. */
    data class Item(
        val id: String,
        val title: String,
        val detail: String,
        val request: (String) -> ConsentRequest,
    ) {
        override fun equals(other: Any?): Boolean = other is Item && other.id == id

        override fun hashCode(): Int = id.hashCode()
    }

    private val _items = MutableStateFlow<List<Item>>(emptyList())
    val items: StateFlow<List<Item>> = _items.asStateFlow()

    private val _approving = MutableStateFlow<String?>(null)

    /** The item whose consent page is open. */
    val approving: StateFlow<String?> = _approving.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _code = MutableStateFlow<String?>(null)

    /** The confirmation code of the request about to open (`ABC-DEF`); null otherwise. */
    val code: StateFlow<String?> = _code.asStateFlow()

    private var answer: CompletableDeferred<Boolean>? = null
    private var opened = false

    /** Re-read what waits, for the account's own apps and each of [orgs]. A scope the person may not read is skipped. */
    suspend fun load(orgs: List<String>) {
        val found = mutableListOf<Item>()
        for (org in listOf<String?>(null) + orgs) {
            val pending =
                try {
                    fetch(org)
                } catch (e: CancellationException) {
                    throw e
                } catch (
                    @Suppress("TooGenericExceptionCaught") e: Exception,
                ) {
                    continue
                }
            found += items(pending, org, packageName, appName)
        }
        _items.value = found.distinctBy { it.id }
    }

    /** Show [item]'s code, open its consent page once the person continues; true when it came back approved. */
    suspend fun approve(
        item: Item,
        orgs: List<String>,
    ): Boolean {
        _approving.value = item.id
        _error.value = null
        opened = false
        try {
            val result = consent(item.request) { started -> ask(started) }
            if (!opened) return false
            if (result == null) {
                _error.value = "Couldn't open the approval page. Try again."
                return false
            }
            load(orgs)
            return result.isApproved
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            _error.value = describeChatError(e)
            return false
        } finally {
            _code.value = null
            _approving.value = null
        }
    }

    /** The person checked the code: open the consent page. */
    fun continueToPage() = reply(true)

    /** The person stopped: the page is not opened. */
    fun cancelCode() = reply(false)

    fun clearError() {
        _error.value = null
    }

    private suspend fun ask(started: ConsentStarted): Boolean {
        val deferred = CompletableDeferred<Boolean>()
        answer = deferred
        _code.value = started.code.ifEmpty { confirmationCode(started.requestId) }
        val go = deferred.await()
        _code.value = null
        opened = go
        return go
    }

    private fun reply(go: Boolean) {
        answer?.complete(go)
        answer = null
    }

    companion object {
        /** The actionable items in one scope's pending list: upgrades of this app's package, and node releases. */
        fun items(
            pending: PendingApprovals,
            org: String?,
            packageName: String,
            appName: String,
        ): List<Item> {
            val scope = org?.let { ReportScope.org(it) } ?: ReportScope.Account
            val upgrades =
                pending.upgrades.filter { it.actionable && it.`package` == packageName }.map { u ->
                    Item(
                        id = "upgrade:${u.app}:${u.to}",
                        title = "$appName ${u.to} is available",
                        detail = "${u.name ?: "An app instance"} runs ${u.from}. Review the update to keep it current.",
                        request = { returnTo -> upgradeConsent(u.app, u.to, returnTo) },
                    )
                }
            val releases =
                pending.releases.filter { it.actionable }.map { r ->
                    Item(
                        id = "release:${org ?: "-"}:${r.version}",
                        title = "Node release ${r.version} needs your approval",
                        detail =
                            r.deadline
                                ?.after
                                ?.ifEmpty { null }
                                ?.let { "New work stops after $it until it's approved." }
                                ?: "Your cluster's nodes run a release you haven't approved yet.",
                        request = { returnTo -> releaseConsent(scope, r.version, returnTo) },
                    )
                }
            return upgrades + releases
        }
    }
}
