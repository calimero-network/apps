package network.calimero.models.core

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReportScope
import com.calimero.mero.confirmationCode
import com.calimero.mero.releaseConsent
import com.calimero.mero.upgradeConsent
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * One decision that waits for this account on Calimero 1.0: a node release to approve for a scope
 * (the account's own apps, or an organization), or an app instance to upgrade. The decision is made
 * on the node's consent page, in the system browser, never in the app. (Swift `ApprovalItem`.)
 */
sealed interface ApprovalItem {
    data class Release(
        val scope: ReportScope,
        val version: String,
        val deadline: String?,
    ) : ApprovalItem

    data class Upgrade(
        val app: String,
        val name: String?,
        val from: String,
        val to: String,
    ) : ApprovalItem

    val id: String
        get() =
            when (this) {
                is Release -> if (scope.kind == "org") "release:${scope.org}:$version" else "release:account:$version"
                is Upgrade -> "upgrade:$app:$to"
            }

    /** What the row says. */
    val title: String
        get() =
            when (this) {
                is Release -> "Approve node release $version"
                is Upgrade -> "Upgrade ${name ?: "an app"} to $to"
            }

    /** The line under it. */
    val detail: String
        get() =
            when (this) {
                is Release ->
                    if (deadline != null) {
                        "New work stops after $deadline until it is approved."
                    } else {
                        "Your cluster's nodes run a release you have not approved yet."
                    }
                is Upgrade -> "Runs $from now."
            }

    /** The consent request that asks for this decision, returning to [returnTo]. */
    fun request(returnTo: String): ConsentRequest =
        when (this) {
            is Release -> releaseConsent(scope, version, returnTo)
            is Upgrade -> upgradeConsent(app, to, returnTo)
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
 * wires [load] to `CalimeroClient.pendingApprovals(org)` and [consent] to
 * `MeroAppSession.requestConsent(context, request, confirm)`, which opens the page in a Custom Tab.
 * Before the page opens, [code] holds the request's confirmation code: the screen shows it, and the
 * person continues ([continueToPage]) or stops ([cancelCode]). The page shows the same code, so they
 * can check it is the request this app made. (Swift `ApprovalsModel`.)
 */
class ApprovalsModel(
    private val load: suspend (org: String?) -> PendingApprovals,
    private val consent: suspend (
        request: (String) -> ConsentRequest,
        confirm: suspend (ConsentStarted) -> Boolean,
    ) -> ConsentResult?,
) {
    private val _items = MutableStateFlow<List<ApprovalItem>>(emptyList())
    val items: StateFlow<List<ApprovalItem>> = _items.asStateFlow()

    private val _busy = MutableStateFlow<String?>(null)

    /** The item whose consent page is open. */
    val busy: StateFlow<String?> = _busy.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)

    /** The last decision or failure, in words. */
    val message: StateFlow<String?> = _message.asStateFlow()

    private val _code = MutableStateFlow<String?>(null)

    /** The confirmation code of the request about to open (`ABC-DEF`), shown before the page opens. */
    val code: StateFlow<String?> = _code.asStateFlow()

    private var orgs: List<String> = emptyList()
    private var answer: CompletableDeferred<Boolean>? = null
    private var opened = false

    /** Re-read the account's own approvals and those of [orgs]. A scope the account cannot read adds nothing. */
    suspend fun refresh(orgs: List<String>? = null) {
        if (orgs != null) this.orgs = orgs
        val found = mutableListOf<ApprovalItem>()
        for (scope in listOf<String?>(null) + this.orgs) {
            val pending = attempt { load(scope) }.getOrNull() ?: continue
            for (item in ApprovalItem.from(pending)) if (item !in found) found += item
        }
        _items.value = found
    }

    /** Ask the node for [item]'s consent request, show its code, open the page once the person continues, re-read. */
    suspend fun approve(item: ApprovalItem) {
        _busy.value = item.id
        _message.value = null
        opened = false
        attempt { consent({ item.request(it) }) { started -> ask(started) } }
            .onSuccess { result ->
                _message.value =
                    when {
                        !opened -> "Nothing was approved."
                        result == null -> "The consent page did not answer. Try again."
                        result.status == "approved" -> "Approved."
                        result.status == "declined" -> "Declined."
                        else -> "Not decided yet. You can come back to it."
                    }
            }.onFailure { _message.value = ModelsFormat.errorText(it) }
        _code.value = null
        _busy.value = null
        refresh()
    }

    /** The person checked the code: open the consent page. */
    fun continueToPage() = reply(true)

    /** The person stopped: the page is not opened. */
    fun cancelCode() = reply(false)

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
}
