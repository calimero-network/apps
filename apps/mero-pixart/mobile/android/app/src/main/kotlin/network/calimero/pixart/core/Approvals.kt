package network.calimero.pixart.core

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReportScope
import com.calimero.mero.releaseConsent
import com.calimero.mero.upgradeConsent
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.coroutines.cancellation.CancellationException

/**
 * One decision that waits for this account on Calimero 1.0: a node release to approve for a scope
 * (the account's own apps, or an organization), or an app instance to upgrade. The decision is made
 * on the node's consent page, in a Custom Tab, never in the app. (Swift `ApprovalItem`.)
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
        override val id: String get() = "release:${if (scope.kind == "org") scope.org else "account"}:$version"
        override val title: String get() = "Approve node release $version"
        override val detail: String
            get() = deadline?.let { "New work stops after $it until it is approved." } ?: "Your cluster's nodes run a release you have not approved yet."

        override fun request(returnTo: String): ConsentRequest = releaseConsent(scope, version, returnTo)
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

        override fun request(returnTo: String): ConsentRequest = upgradeConsent(app, to, returnTo)
    }

    companion object {
        /** The decisions in [pending] that are this account's to make. */
        fun from(pending: PendingApprovals): List<ApprovalItem> =
            pending.releases.filter { it.actionable }.map { Release(pending.scope, it.version, it.deadline?.after?.ifEmpty { null }) } +
                pending.upgrades.filter { it.actionable }.map { Upgrade(it.app, it.name, it.from, it.to) }
    }
}

/**
 * What waits for this account's approval, and asking for it on the node's consent page. The app
 * wires [load] to the client's `pendingApprovals(org)` and [consent] to
 * `MeroAppSession.requestConsent(context, request, confirm)`, which opens the page in a Custom Tab.
 * Before it opens, the request's confirmation code waits in [confirmationCode] for the person to
 * continue ([answerCode]); the page shows the same code. (Swift `ApprovalsModel`.)
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

    private val _message = MutableStateFlow<String?>(null)

    /** The last decision or failure, in words. */
    val message: StateFlow<String?> = _message.asStateFlow()

    private val _confirmationCode = MutableStateFlow<String?>(null)

    /** The confirmation code of the request about to open, waiting for [answerCode]. */
    val confirmationCode: StateFlow<String?> = _confirmationCode.asStateFlow()

    private var codeAnswer: CompletableDeferred<Boolean>? = null
    private var orgs: List<String> = emptyList()

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
                } catch (
                    @Suppress("TooGenericExceptionCaught") e: Exception,
                ) {
                    continue
                }
            ApprovalItem.from(pending).forEach { if (it !in found) found += it }
        }
        _items.value = found
    }

    /** Open the consent page for [item] and re-read once the person is back. */
    suspend fun approve(item: ApprovalItem) {
        _busy.value = item.id
        var declined = false
        try {
            val result =
                consent({ item.request(it) }) { started ->
                    if (started.code.isEmpty()) {
                        true
                    } else {
                        askCode(started.code).also { declined = !it }
                    }
                }
            _message.value =
                when {
                    declined -> null
                    result == null -> "The consent page did not answer. Try again."
                    result.isApproved -> "Approved."
                    result.status == "declined" -> "Declined."
                    else -> "Not decided yet. You can come back to it."
                }
        } finally {
            _busy.value = null
        }
        if (!declined) refresh()
    }

    /** Continue to the consent page (true) or stop (false) after seeing [confirmationCode]. */
    fun answerCode(proceed: Boolean) {
        _confirmationCode.value = null
        codeAnswer?.complete(proceed)
        codeAnswer = null
    }

    private suspend fun askCode(code: String): Boolean {
        codeAnswer?.complete(false)
        val answer = CompletableDeferred<Boolean>()
        codeAnswer = answer
        _confirmationCode.value = code
        return answer.await()
    }
}
