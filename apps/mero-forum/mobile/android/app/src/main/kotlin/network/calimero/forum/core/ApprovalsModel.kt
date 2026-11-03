package network.calimero.forum.core

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReportScope
import com.calimero.mero.releaseConsent
import com.calimero.mero.upgradeConsent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** What the approvals card shows. */
data class ApprovalsState(
    val items: List<ApprovalsModel.Item> = emptyList(),
    /** The item whose consent page is being opened. */
    val approving: String? = null,
    val error: String? = null,
    /** The code to show before the consent page opens; answer it with [ApprovalsModel.answer]. */
    val confirmation: ApprovalsModel.Confirmation? = null,
)

/**
 * What waits for the signed-in person's approval on a Calimero 1.0 cluster: a newer release of Mero
 * Forum for one of their app instances, or a node release their org (or account) has to approve.
 * Approving opens the node's consent page in a Custom Tab; an app's own session can't approve
 * anything. (Swift `ApprovalsModel`.)
 *
 * Before the page opens, the node's confirmation code is shown in the app ([ApprovalsState.confirmation]):
 * the page shows the same code, so the person can check it is the request the app made. Continuing
 * opens the page; cancelling doesn't.
 *
 * The app hands it `MeroAppSession.client.pendingApprovals(org)` and
 * `MeroAppSession.requestConsent(context, request, confirm)`; tests hand it fakes.
 */
class ApprovalsModel(
    private val packageName: String,
    private val appName: String,
    private val returnTo: String,
    private val fetch: suspend (org: String?) -> PendingApprovals,
    private val consent: suspend (request: ConsentRequest, confirm: suspend (ConsentStarted) -> Boolean) -> ConsentStarted,
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

    /** A confirmation code waiting for the person to continue to the consent page. */
    data class Confirmation(
        val id: String,
        /** What is being approved (the item's title). */
        val title: String,
        /** The code the consent page shows too (`ABC-123`), or null from a node that predates it. */
        val code: String?,
    )

    private val _state = MutableStateFlow(ApprovalsState())
    val state: StateFlow<ApprovalsState> = _state.asStateFlow()

    private var pendingAnswer: CompletableDeferred<Boolean>? = null

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
        _state.update { it.copy(items = found.distinctBy(Item::id)) }
    }

    /**
     * Show [item]'s confirmation code, then open its consent page; true when the page opened. The
     * page sends the person back to the app, which re-reads ([load]) then.
     */
    suspend fun approve(item: Item): Boolean {
        _state.update { it.copy(approving = item.id, error = null) }
        var proceeded = false
        try {
            consent(item.request(returnTo)) { started ->
                proceeded = ask(Confirmation(started.requestId, item.title, started.code.ifEmpty { null }))
                proceeded
            }
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            _state.update { it.copy(error = "Couldn't open the approval page. ${ForumErrorText.describe(e)}") }
            return false
        } finally {
            _state.update { it.copy(approving = null, confirmation = null) }
        }
        return proceeded
    }

    /** The person's answer to [ApprovalsState.confirmation]: true opens the consent page. */
    fun answer(proceed: Boolean) {
        _state.update { it.copy(confirmation = null) }
        val waiting = pendingAnswer
        pendingAnswer = null
        waiting?.complete(proceed)
    }

    fun dismissError() {
        _state.update { it.copy(error = null) }
    }

    private suspend fun ask(confirmation: Confirmation): Boolean {
        pendingAnswer?.complete(false)
        val answer = CompletableDeferred<Boolean>()
        pendingAnswer = answer
        _state.update { it.copy(confirmation = confirmation) }
        return answer.await()
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
