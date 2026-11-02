package network.calimero.sign.core

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.ConsentScope
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReportScope
import com.calimero.mero.confirmationCode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * One decision that waits for this account on Calimero 1.0: a node release to approve for a scope
 * (the account's own apps, or an organization), or an app instance to upgrade. Made on the node's
 * consent page, in a Custom Tab, never in the app. (Swift `ApprovalItem`.)
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
            pending.releases.filter { it.actionable }.map { Release(pending.scope, it.version, it.deadline?.after) } +
                pending.upgrades.filter { it.actionable }.map { Upgrade(it.app, it.name, it.from, it.to) }
    }
}

/**
 * What waits for this account's approval, and asking for it on the node's consent page. [load] reads
 * one scope (`null`: the account's own apps); [consent] opens the page for a request, after [confirm]
 * showed the person the confirmation code the page will show. (Swift `ApprovalsModel`.)
 */
class ApprovalsModel(
    private val load: suspend (org: String?) -> PendingApprovals,
    private val consent: suspend (request: (String) -> ConsentRequest, confirm: suspend (ConsentStarted) -> Boolean) -> ConsentResult?,
) {
    private val _items = MutableStateFlow<List<ApprovalItem>>(emptyList())
    val items: StateFlow<List<ApprovalItem>> = _items.asStateFlow()

    private val _busy = MutableStateFlow<String?>(null)

    /** The item whose consent page is open. */
    val busy: StateFlow<String?> = _busy.asStateFlow()

    /** The last decision or failure, in words. */
    val message = MutableStateFlow<String?>(null)

    private val _confirmationCode = MutableStateFlow<String?>(null)

    /** The code the consent page will show, waiting for [answerCode]. The screen shows it first. */
    val confirmationCode: StateFlow<String?> = _confirmationCode.asStateFlow()
    private var codeAnswer: CompletableDeferred<Boolean>? = null
    private var orgs: List<String> = emptyList()

    /** Re-read the account's own approvals and those of [orgs]. A scope the account cannot read adds nothing. */
    suspend fun refresh(orgs: List<String>? = null) {
        if (orgs != null) this.orgs = orgs
        val found = mutableListOf<ApprovalItem>()
        for (scope in listOf<String?>(null) + this.orgs) {
            val pending = attempt { load(scope) }.getOrNull() ?: continue
            ApprovalItem.from(pending).forEach { if (found.none { f -> f.id == it.id }) found += it }
        }
        _items.value = found
    }

    /** Show the code, open the consent page for [item], and re-read once the person is back. */
    suspend fun approve(item: ApprovalItem) {
        _busy.value = item.id
        try {
            val result = consent({ item.request(it) }) { started -> confirm(started.code.ifEmpty { confirmationCode(started.requestId) }) }
            message.value =
                when {
                    result == null -> "The consent page did not answer. Try again."
                    result.isApproved -> "Approved."
                    result.isPending -> "Not decided yet. You can come back to it."
                    else -> "Declined."
                }
        } finally {
            _busy.value = null
        }
        refresh()
    }

    internal suspend fun confirm(code: String): Boolean {
        answerCode(false)
        val answer = CompletableDeferred<Boolean>()
        codeAnswer = answer
        _confirmationCode.value = code
        return answer.await()
    }

    /** The person opened the page (`true`) or cancelled. */
    fun answerCode(open: Boolean) {
        val answer = codeAnswer
        codeAnswer = null
        _confirmationCode.value = null
        answer?.complete(open)
    }
}
