package network.calimero.calendar.app

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentScope
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PendingApprovals
import com.calimero.mero.confirmationCode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import network.calimero.calendar.data.ErrorText

/** One thing that waits for the person's approval. */
data class ApprovalItem(
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
            is Kind.Upgrade -> ConsentRequest.Upgrade(kind.app, kind.version, returnTo)
            is Kind.Release -> ConsentRequest.Release(ConsentScope(kind.org), kind.version, returnTo)
        }
}

data class ApprovalsState(
    val items: List<ApprovalItem> = emptyList(),
    /** The item whose consent page is opening. */
    val approving: String? = null,
    val error: String? = null,
    /** The code the consent page is about to show (`ABC-DEF`), while the app asks the person to check it. */
    val confirmationCode: String? = null,
)

/**
 * What waits for the signed-in person's approval on a Calimero 1.0 cluster: a newer release of Mero
 * Calendar for one of their app instances, or a node release their org (or account) approves.
 * Approving opens the node's consent page in a Custom Tab; an app's own session can't approve
 * anything. Before the page opens, [ApprovalsState.confirmationCode] holds the code the page will
 * show, and the screen answers with [answerConfirmation]. (iOS `ApprovalsModel`.)
 *
 * The app hands it `CalimeroClient.pendingApprovals(org)` and `MeroAppSession.requestConsent`;
 * tests hand it fakes.
 */
class ApprovalsModel(
    private val packageName: String,
    private val appName: String,
    private val fetch: suspend (org: String?) -> PendingApprovals,
    /** Start [request] and open its page once `confirm` says so; answers whether it opened. */
    private val consent: suspend (request: ConsentRequest, confirm: suspend (ConsentStarted) -> Boolean) -> Boolean,
    private val returnTo: String,
) {
    private val _state = MutableStateFlow(ApprovalsState())
    val state: StateFlow<ApprovalsState> = _state.asStateFlow()

    private var confirmation: CompletableDeferred<Boolean>? = null

    /** Re-read what waits, for the account's own apps and each of [orgs]; a scope the person may not read is skipped. */
    suspend fun load(orgs: List<String>) {
        val found = mutableListOf<ApprovalItem>()
        for (org in listOf<String?>(null) + orgs) {
            val pending = runCatching { fetch(org) }.getOrNull() ?: continue
            found += items(pending, org, packageName, appName)
        }
        _state.update { it.copy(items = found.distinctBy { item -> item.id }) }
    }

    /** Open the consent page for [item] (after the person checked its code). Answers whether it opened. */
    suspend fun approve(item: ApprovalItem): Boolean {
        _state.update { it.copy(approving = item.id, error = null) }
        var declined = false
        return try {
            val opened =
                consent(item.request(returnTo)) { started ->
                    val ok = confirm(started)
                    if (!ok) declined = true
                    ok
                }
            if (!opened && !declined) _state.update { it.copy(error = "Couldn't open the approval page. Try again.") }
            opened && !declined
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            _state.update { it.copy(error = ErrorText.of(e, "open the approval page")) }
            false
        } finally {
            _state.update { it.copy(approving = null) }
        }
    }

    /** Show the code the page will show, and wait for the person. */
    internal suspend fun confirm(started: ConsentStarted): Boolean {
        confirmation?.complete(false)
        val answer = CompletableDeferred<Boolean>()
        confirmation = answer
        _state.update { it.copy(confirmationCode = started.code.ifEmpty { confirmationCode(started.requestId) }) }
        return answer.await()
    }

    /** The person's answer to [ApprovalsState.confirmationCode]: open the page, or not. */
    fun answerConfirmation(open: Boolean) {
        val pending = confirmation
        confirmation = null
        _state.update { it.copy(confirmationCode = null) }
        pending?.complete(open)
    }

    companion object {
        /** The actionable items in one scope: upgrades of this app's package, node releases the scope's side approves. */
        fun items(
            pending: PendingApprovals,
            org: String?,
            packageName: String,
            appName: String,
        ): List<ApprovalItem> {
            val upgrades =
                pending.upgrades
                    .filter { it.actionable && it.`package` == packageName }
                    .map {
                        ApprovalItem(
                            ApprovalItem.Kind.Upgrade(it.app, it.to),
                            "$appName ${it.to} is available",
                            "${it.name ?: "An app instance"} runs ${it.from}. Review the update to keep it current.",
                        )
                    }
            val releases =
                pending.releases
                    .filter { it.actionable }
                    .map {
                        ApprovalItem(
                            ApprovalItem.Kind.Release(org, it.version),
                            "Node release ${it.version} needs your approval",
                            it.deadline?.let { d -> "New work stops after ${d.after} until it's approved." }
                                ?: "Your cluster's nodes run a release you haven't approved yet.",
                        )
                    }
            return upgrades + releases
        }
    }
}
