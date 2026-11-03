package network.calimero.blocks.app

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.ConsentScope
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReportScope
import com.calimero.mero.confirmationCode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * One decision that waits for this account on Calimero 1.0: a node release to approve for a scope
 * (the account's own apps, or an organization), or an app instance to upgrade. The decision is made
 * on the node's consent page, in the system browser, never in the app. (Identical to the iOS
 * `ApprovalItem`.)
 */
sealed interface ApprovalItem {
    val id: String
    val title: String
    val detail: String

    /** The consent request that asks for this decision, returning to [returnTo]. */
    fun request(returnTo: String): ConsentRequest

    data class Release(
        val scope: ReportScope,
        val version: String,
        val deadline: String?,
    ) : ApprovalItem {
        override val id: String get() = "release:${scope.org ?: "account"}:$version"
        override val title: String get() = "Approve node release $version"
        override val detail: String
            get() = deadline?.let { "New work stops after $it until it is approved." } ?: "Your cluster's nodes run a release you have not approved yet."

        override fun request(returnTo: String): ConsentRequest = ConsentRequest.Release(ConsentScope(scope.org), version, returnTo)
    }

    data class Upgrade(
        val app: String,
        val name: String?,
        val from: String,
        val to: String,
    ) : ApprovalItem {
        override val id: String get() = "upgrade:$app:$to"
        override val title: String get() = "Upgrade ${name ?: "an app"} to $to"
        override val detail: String get() = "Runs $from now."

        override fun request(returnTo: String): ConsentRequest = ConsentRequest.Upgrade(app, to, returnTo)
    }

    companion object {
        /** The decisions in [pending] that are this account's to make. */
        fun from(pending: PendingApprovals): List<ApprovalItem> =
            pending.releases.filter { it.actionable }.map { Release(pending.scope, it.version, it.deadline?.after?.takeIf(String::isNotEmpty)) } +
                pending.upgrades.filter { it.actionable }.map { Upgrade(it.app, it.name, it.from, it.to) }
    }
}

/** The confirmation code of a consent request the node accepted: shown before the page opens; the page shows the same. */
data class ConsentConfirmation(
    val id: String,
    val code: String,
    val title: String,
)

/**
 * What waits for this account's approval, and asking for it on the node's consent page. The app
 * wires [load] to `CalimeroClient.pendingApprovals(org)` and [consent] to
 * `MeroAppSession.requestConsent(context, request, confirm)`, which opens the page in a Custom Tab
 * once [confirm] said yes. (Identical to the iOS `ApprovalsModel`.)
 */
class ApprovalsModel(
    private val load: suspend (org: String?) -> PendingApprovals,
    /** Ask for `request(returnTo)`, call `confirm` with the node's answer (open only on true), answer the decision. */
    private val consent: suspend (
        request: (String) -> ConsentRequest,
        confirm: suspend (ConsentStarted) -> Boolean,
    ) -> ConsentResult?,
) {
    private val _items = MutableStateFlow<List<ApprovalItem>>(emptyList())
    val items: StateFlow<List<ApprovalItem>> = _items.asStateFlow()

    /** The item whose consent page is open. */
    private val _busy = MutableStateFlow<String?>(null)
    val busy: StateFlow<String?> = _busy.asStateFlow()

    /** The last decision or failure, in words. */
    val message = MutableStateFlow<String?>(null)

    /** The confirmation code on screen, before the consent page opens. */
    private val _confirmation = MutableStateFlow<ConsentConfirmation?>(null)
    val confirmation: StateFlow<ConsentConfirmation?> = _confirmation.asStateFlow()

    private var orgs: List<String> = emptyList()
    private var answer: CompletableDeferred<Boolean>? = null
    private var declined = false

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
            for (item in ApprovalItem.from(pending)) if (item !in found) found += item
        }
        _items.value = found
    }

    /** Show the request's confirmation code, then open the consent page for [item] if the person goes on, and re-read. */
    suspend fun approve(item: ApprovalItem) {
        _busy.value = item.id
        declined = false
        try {
            val result = consent({ item.request(it) }) { started -> confirm(started, item.title) }
            message.value =
                when {
                    result == null && declined -> "Not opened. Nothing changed."
                    result?.status == "approved" -> "Approved."
                    result?.status == "declined" -> "Declined."
                    result?.status == "pending" -> "Not decided yet. You can come back to it."
                    else -> "The consent page did not answer. Try again."
                }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            message.value = BlocksText.error(e)
        } finally {
            _busy.value = null
        }
        refresh()
    }

    /** Hold the consent page until the person has seen the code and chosen. */
    suspend fun confirm(
        started: ConsentStarted,
        title: String,
    ): Boolean {
        answer?.complete(false)
        val waiting = CompletableDeferred<Boolean>()
        answer = waiting
        _confirmation.value = ConsentConfirmation(started.requestId, started.code.ifEmpty { confirmationCode(started.requestId) }, title)
        return waiting.await()
    }

    /** The person's choice on the code screen: open the page, or not. */
    fun answerConfirmation(open: Boolean) {
        _confirmation.value = null
        answer?.complete(open)
        answer = null
        declined = !open
    }
}
