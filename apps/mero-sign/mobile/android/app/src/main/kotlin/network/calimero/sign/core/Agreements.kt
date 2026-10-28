package network.calimero.sign.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.delay
import network.calimero.sign.generated.SignClient

/** An agreement: a subgroup of a workspace (namespace) with one context. (Swift `AgreementRef`.) */
data class AgreementRef(
    val namespaceId: String,
    val workspaceName: String,
    /** The subgroup id. */
    val agreementId: String,
    val name: String,
    val contextId: String,
)

/** How long and how often to wait on a freshly joined agreement. */
data class SyncTiming(
    val enterAttempts: Int = 45,
    val stateAttempts: Int = 12,
    val registerAttempts: Int = 5,
    val delayMs: Long = 2_000,
) {
    companion object {
        /** No waiting, for tests. */
        val IMMEDIATE = SyncTiming(3, 3, 3, 0)
    }
}

/**
 * Workspaces and the agreements in them, and entering one the way the web app's invitation flow
 * does (`enterAgreement` + `settleIntoAgreement`). (Swift `AgreementDirectory`.)
 */
class AgreementDirectory(
    val backend: MeroAppBackend,
    val store: PrivateStore,
    val timing: SyncTiming = SyncTiming(),
) {
    fun client(contextId: String): SignClient = signClient(backend.contract, contextId)

    /** The account's workspaces, without the personal namespace (`listWorkspaces`). */
    suspend fun workspaces(): List<AppNamespace> =
        backend
            .listNamespaces()
            .filterNot { store.isPersonal(it.id) }
            .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { nameOf(it) })

    /** The agreements in a workspace that have a context. */
    suspend fun agreements(workspace: AppNamespace): List<AgreementRef> =
        backend.listSubgroups(workspace.id).mapNotNull { subgroup ->
            val contextId = subgroup.contextIds.firstOrNull() ?: return@mapNotNull null
            AgreementRef(workspace.id, nameOf(workspace), subgroup.groupId, agreementName(subgroup.name, subgroup.groupId), contextId)
        }

    suspend fun allAgreements(): List<AgreementRef> = workspaces().flatMap { attempt { agreements(it) }.getOrDefault(emptyList()) }

    /** Enter an agreement's context, joining its open subgroup if needed, retried while it projects. */
    suspend fun enter(contextId: String) {
        repeat(maxOf(timing.enterAttempts, 1)) { attemptIndex ->
            if (attemptIndex > 0) delay(timing.delayMs)
            if (attempt { backend.isMember(contextId) }.getOrDefault(false)) return
            if (attempt { backend.joinContext(contextId) }.isSuccess) return
        }
        throw SignModelException(
            "Your account isn't in that agreement yet. If you were just invited, the workspace may still be syncing — try again shortly.",
        )
    }

    /**
     * Everything after entering, as the web's `settleIntoAgreement`: wait for state, register as a
     * participant, settle on the name, then record the agreement and the identity it was joined with
     * in the private context (`join_shared_context` → `IdentityMapping`). Returns the name.
     */
    suspend fun settle(
        contextId: String,
        nameHint: String?,
    ): String {
        val contractName = waitForState(contextId)
        registerSelf(contextId)
        val name = resolveName(contractName, nameHint, contextId)
        store.record(contextId, backend.account, name)
        return name
    }

    internal suspend fun waitForState(contextId: String): String? {
        repeat(maxOf(timing.stateAttempts, 1)) { attemptIndex ->
            if (attemptIndex > 0) delay(timing.delayMs)
            val result = attempt { client(contextId).getContextDetails(contextId).contextName }
            result.onSuccess { return it }
            if (!SignErrorText.isSyncing(result.exceptionOrNull()!!)) return null
        }
        return null
    }

    internal suspend fun registerSelf(contextId: String) {
        repeat(maxOf(timing.registerAttempts, 1)) { attemptIndex ->
            if (attemptIndex > 0) delay(timing.delayMs)
            val result = attempt { client(contextId).registerSelfAsParticipant() }
            if (result.isSuccess) return
            val text = SignErrorText.message(result.exceptionOrNull()!!)
            if (text.contains("already registered", ignoreCase = true)) return
            if (!SignErrorText.isSyncing(text)) return
        }
    }

    companion object {
        fun nameOf(workspace: AppNamespace): String = workspace.name?.trimmedOrNull() ?: "Workspace ${workspace.id.take(8)}…"

        internal fun agreementName(
            name: String?,
            id: String,
        ): String = name?.trimmedOrNull() ?: "Agreement ${id.take(8)}…"

        /** The contract's name wins; the invitation's stands in while the context syncs. */
        fun resolveName(
            fromContract: String?,
            fromInvitation: String?,
            contextId: String,
        ): String = fromContract?.trimmedOrNull() ?: fromInvitation?.trimmedOrNull() ?: "Agreement ${contextId.take(8)}…"
    }
}
