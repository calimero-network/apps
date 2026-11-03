package network.calimero.kombat.app

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
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

/**
 * One decision that waits for this account on Calimero 1.0: a node release to approve for a scope
 * (the account's own apps, or an organization), or an app instance to upgrade. The decision is made
 * on the node's consent page, in the system browser, never in the app. (Swift `ApprovalItem`.)
 */
sealed class ApprovalItem {
    abstract val id: String

    /** What the row says. */
    abstract val title: String

    /** The line under it. */
    abstract val detail: String

    /** The consent request that asks for this decision, returning to [returnTo]. */
    abstract fun request(returnTo: String): ConsentRequest

    data class Release(
        val scope: ReportScope,
        val version: String,
        val deadline: String?,
    ) : ApprovalItem() {
        override val id: String get() = "release:${if (scope.kind == "org") scope.org else "account"}:$version"
        override val title: String get() = "Approve node release $version"
        override val detail: String
            get() =
                deadline?.takeIf { it.isNotEmpty() }?.let { "New work stops after $it until it is approved." }
                    ?: "Your cluster's nodes run a release you have not approved yet."

        override fun request(returnTo: String): ConsentRequest = releaseConsent(scope, version, returnTo)
    }

    data class Upgrade(
        val app: String,
        val name: String?,
        val from: String,
        val to: String,
    ) : ApprovalItem() {
        override val id: String get() = "upgrade:$app:$to"
        override val title: String get() = "Upgrade ${name ?: "an app"} to $to"
        override val detail: String get() = "Runs $from now."

        override fun request(returnTo: String): ConsentRequest = upgradeConsent(app, to, returnTo)
    }

    companion object {
        /** The decisions in [pending] that are this account's to make. */
        fun from(pending: PendingApprovals): List<ApprovalItem> =
            pending.releases.filter { it.actionable }.map { Release(pending.scope, it.version, it.deadline?.after) } +
                pending.upgrades.filter { it.actionable }.map { Upgrade(it.app, it.name, it.from, it.to) }
    }
}

data class ApprovalsState(
    val items: List<ApprovalItem> = emptyList(),
    /** The item whose consent page is open. */
    val busy: String? = null,
    /** The last decision or failure, in words. */
    val message: String? = null,
    /** The confirmation code to show before the consent page opens; "" when the node sent none. */
    val confirmationCode: String? = null,
)

/**
 * What waits for this account's approval, and asking for it on the node's consent page. The app
 * wires [load] to `MeroAppSession.client.pendingApprovals(org)` and [consent] to
 * `MeroAppSession.requestConsent`, which opens the page in a Custom Tab. (Swift `ApprovalsModel`.)
 */
class ApprovalsModel(
    private val load: suspend (org: String?) -> PendingApprovals,
    /**
     * Asks for the request on the node, runs `confirm` with the node's confirmation code before the
     * page opens (answer `false` and it is not opened), then answers the decision.
     */
    private val consent: suspend (
        request: (String) -> ConsentRequest,
        confirm: suspend (String?) -> Boolean,
    ) -> ConsentResult?,
) {
    private val _state = MutableStateFlow(ApprovalsState())
    val state: StateFlow<ApprovalsState> = _state.asStateFlow()
    private var orgs: List<String> = emptyList()
    private var confirmation: CompletableDeferred<Boolean>? = null

    /** Re-read the account's own approvals and those of [orgs]. A scope the account cannot read adds nothing. */
    suspend fun refresh(orgs: List<String>? = null) {
        if (orgs != null) this.orgs = orgs
        val found = mutableListOf<ApprovalItem>()
        for (scope in listOf<String?>(null) + this.orgs) {
            val pending =
                try {
                    load(scope)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    continue
                }
            ApprovalItem.from(pending).forEach { if (it !in found) found += it }
        }
        _state.update { it.copy(items = found) }
    }

    /** Open the consent page for [item] and re-read once the person is back. */
    suspend fun approve(item: ApprovalItem) {
        _state.update { it.copy(busy = item.id) }
        var cancelled = false
        val result =
            try {
                consent({ item.request(it) }) { code ->
                    confirm(code).also { cancelled = !it }
                }
            } finally {
                _state.update { it.copy(busy = null) }
            }
        val message =
            when {
                cancelled -> "Cancelled. Nothing was approved."
                result == null -> "The consent page did not answer. Try again."
                result.isApproved -> "Approved."
                result.status == "declined" -> "Declined."
                else -> "Not decided yet. You can come back to it."
            }
        _state.update { it.copy(message = message) }
        if (!cancelled) refresh()
    }

    /** Show [code] and wait for the person to continue to the consent page or cancel. */
    suspend fun confirm(code: String?): Boolean {
        confirmation?.complete(false)
        val waiting = CompletableDeferred<Boolean>()
        confirmation = waiting
        _state.update { it.copy(confirmationCode = code.orEmpty()) }
        return waiting.await()
    }

    /** The person's answer to [ApprovalsState.confirmationCode]: `true` opens the consent page. */
    fun answerConfirmation(go: Boolean) {
        _state.update { it.copy(confirmationCode = null) }
        confirmation?.complete(go)
        confirmation = null
    }
}
