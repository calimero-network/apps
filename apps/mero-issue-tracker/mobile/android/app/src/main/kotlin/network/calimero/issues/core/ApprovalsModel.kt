package network.calimero.issues.core

import com.calimero.mero.ConsentRequest
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

/**
 * What waits for the signed-in person's approval on a Calimero 1.0 cluster: a newer release of Mero
 * Issue Tracker for one of their repos, or a node release their org (or account) has to approve.
 * Approving opens the node's consent page in a Custom Tab; an app's own session can't approve
 * anything. Before the page opens, the node's confirmation code is shown ([confirmationCode]) so the
 * person can check the page shows the same. (Swift `ApprovalsModel`.)
 *
 * The app hands it `CalimeroClient.pendingApprovals(org)` and `MeroAppSession.requestConsent`;
 * tests hand it fakes.
 */
class ApprovalsModel(
    private val packageName: String,
    private val appName: String,
    private val fetch: suspend (org: String?) -> PendingApprovals,
    private val consent: suspend (request: (returnTo: String) -> ConsentRequest, confirm: suspend (ConsentStarted) -> Boolean) -> ConsentStarted?,
) {
    /** One thing to approve. */
    data class Item(
        val kind: Kind,
        val title: String,
        val detail: String,
    ) {
        sealed interface Kind {
            /** Upgrade app instance [app] to [version]. */
            data class Upgrade(
                val app: String,
                val version: String,
            ) : Kind

            /** Approve node release [version] for [org] (null: the account's own apps). */
            data class Release(
                val org: String?,
                val version: String,
            ) : Kind
        }

        val id: String
            get() =
                when (kind) {
                    is Kind.Upgrade -> "upgrade:${kind.app}:${kind.version}"
                    is Kind.Release -> "release:${kind.org ?: "-"}:${kind.version}"
                }

        /** The consent request that approves it, returning to [returnTo]. */
        fun request(returnTo: String): ConsentRequest =
            when (kind) {
                is Kind.Upgrade -> upgradeConsent(kind.app, kind.version, returnTo)
                is Kind.Release -> releaseConsent(kind.org?.let { ReportScope.org(it) } ?: ReportScope.Account, kind.version, returnTo)
            }
    }

    private val _items = MutableStateFlow<List<Item>>(emptyList())
    val items: StateFlow<List<Item>> = _items.asStateFlow()

    private val _approving = MutableStateFlow<String?>(null)

    /** The item whose consent page is being opened. */
    val approving: StateFlow<String?> = _approving.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _confirmationCode = MutableStateFlow<String?>(null)

    /** The confirmation code to show before the consent page opens; answer with [answerConfirmation]. */
    val confirmationCode: StateFlow<String?> = _confirmationCode.asStateFlow()
    private var confirmation: CompletableDeferred<Boolean>? = null

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
                    @Suppress("TooGenericExceptionCaught") _: Exception,
                ) {
                    continue
                }
            found += items(pending, org, packageName, appName)
        }
        _items.value = found.distinctBy { it.id }
    }

    /** Show the code, then open the consent page for [item]; true when the page was opened. */
    suspend fun approve(item: Item): Boolean {
        _approving.value = item.id
        _error.value = null
        try {
            var declined = false
            val started =
                consent({ item.request(it) }) { answer ->
                    val go = askToConfirm(answer.code.ifEmpty { confirmationCode(answer.requestId) })
                    declined = !go
                    go
                }
            if (declined) return false
            if (started == null) _error.value = "Couldn't open the approval page. Try again."
            return started != null
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            _error.value = TrackerFormat.errorText(e)
            return false
        } finally {
            _approving.value = null
            _confirmationCode.value = null
        }
    }

    /** Show [code] and wait for [answerConfirmation]. */
    internal suspend fun askToConfirm(code: String): Boolean {
        confirmation?.complete(false)
        val waiting = CompletableDeferred<Boolean>()
        confirmation = waiting
        _confirmationCode.value = code
        return waiting.await()
    }

    /** The person read the code: true opens the consent page, false drops the request. */
    fun answerConfirmation(proceed: Boolean) {
        _confirmationCode.value = null
        val waiting = confirmation
        confirmation = null
        waiting?.complete(proceed)
    }

    companion object {
        /** The actionable items in one scope's pending list: upgrades of this app's package, and node releases the scope's side approves. */
        fun items(
            pending: PendingApprovals,
            org: String?,
            packageName: String,
            appName: String,
        ): List<Item> {
            val upgrades =
                pending.upgrades
                    .filter { it.actionable && it.`package` == packageName }
                    .map { u ->
                        Item(
                            Item.Kind.Upgrade(u.app, u.to),
                            "$appName ${u.to} is available",
                            "${u.name ?: "An app instance"} runs ${u.from}. Review the update to keep it current.",
                        )
                    }
            val releases =
                pending.releases
                    .filter { it.actionable }
                    .map { r ->
                        Item(
                            Item.Kind.Release(org, r.version),
                            "Node release ${r.version} needs your approval",
                            r.deadline?.let { "New work stops after ${it.after} until it's approved." }
                                ?: "Your cluster's nodes run a release you haven't approved yet.",
                        )
                    }
            return upgrades + releases
        }
    }
}
